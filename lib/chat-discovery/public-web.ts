import seedData from './seeds.ts';
import { cleanChatName, normalizeGroupLink, type ChatPlatform } from '../chats/bulk-input.ts';

export type DiscoveryPlatform = Extract<ChatPlatform, 'whatsapp' | 'viber'>;
export type DiscoverySourceKind = 'public_web' | 'curated' | 'manual' | 'telegram_global' | 'telegram_scanned';

export type DiscoverySource = {
  kind: DiscoverySourceKind;
  sourceUrl: string;
  sourceTitle: string;
  query: string;
  seedLabel: string;
  seedKind: string;
  context: string;
};

export type DiscoveryRecord = {
  platform: DiscoveryPlatform;
  link: string;
  nameHint: string;
  source: DiscoverySource;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type SeedCity = {
  readonly country: string;
  readonly name: string;
  readonly uk?: string;
  readonly population?: number;
};
type SeedData = {
  readonly keywords: readonly string[];
  readonly cities: readonly SeedCity[];
};
type SearchTask = {
  kind: 'country' | 'city';
  label: string;
  country: string;
  platform: DiscoveryPlatform;
  query: string;
};

const SEEDS: SeedData = seedData;

export type TelegramSearchTask = {
  cursor: number;
  template: string;
  query: string;
  seedLabel: string;
  seedKind: 'country' | 'city';
  country: string;
  city: string;
  cityLatin: string;
};

export type TelegramSearchPlan = {
  cursor: number;
  nextCursor: number;
  totalTasks: number;
  done: boolean;
  tasks: TelegramSearchTask[];
};

export function buildTelegramSearchPlan(cursor = 0, limit = 6): TelegramSearchPlan {
  const countries = [...new Set(SEEDS.cities.map(city => String(city.country || '').trim()).filter(Boolean))];
  const cities = interleaveCitiesByCountry(uniqueTelegramCities(SEEDS.cities));
  const unsupported = /(назва села|назва селища|район міста|назва района|назва області|пункту пропуску|навчального закладу|назва жк|слово пошук)/iu;
  const staticTemplates = new Set(['Ukrainian in', 'Ukrainians', 'Ukraine chat']);
  const ranked = (templates: readonly string[]) => templates
    .map((template, index) => ({ template, index, priority: telegramTemplatePriority(template) }))
    .sort((left, right) => left.priority - right.priority || left.index - right.index)
    .map(item => item.template);
  const countryTemplates = ranked(SEEDS.keywords.filter(template =>
    (/назва країни/iu.test(template) || staticTemplates.has(template)) && !unsupported.test(template)));
  const cityTemplates = ranked(SEEDS.keywords.filter(template =>
    (/назва міста/iu.test(template) || staticTemplates.has(template)) && !unsupported.test(template)));
  const cityTotal = cities.length * cityTemplates.length;
  const countryTotal = countries.length * countryTemplates.length;
  const totalTasks = cityTotal + countryTotal;
  const start = clampInt(cursor, 0, totalTasks, 0);
  const count = clampInt(limit, 1, 20, 6);
  const tasks: TelegramSearchTask[] = [];

  for (let index = start; index < Math.min(totalTasks, start + count); index += 1) {
    if (index < cityTotal) {
      const pair = telegramCityPair(index, cities.length, cityTemplates.length);
      const city = cities[pair.cityIndex];
      const template = cityTemplates[pair.templateIndex];
      const cityLabel = String(city?.uk || city?.name || '').trim();
      const cityLatin = String(city?.name || '').trim();
      const country = String(city?.country || '').trim();
      const query = renderTelegramTemplate(template, cityLabel, country, 'city');
      if (query) tasks.push({ cursor:index, template, query, seedLabel:cityLabel, seedKind:'city', country, city:cityLabel, cityLatin });
      continue;
    }
    const local = index - cityTotal;
    const countryIndex = Math.floor(local / countryTemplates.length);
    const template = countryTemplates[local % countryTemplates.length];
    const country = countries[countryIndex];
    const query = renderTelegramTemplate(template, '', country, 'country');
    if (query) tasks.push({ cursor:index, template, query, seedLabel:country, seedKind:'country', country, city:'', cityLatin:'' });
  }

  const nextCursor = Math.min(totalTasks, start + count);
  return { cursor:start, nextCursor, totalTasks, done:nextCursor >= totalTasks, tasks };
}

function telegramCityPair(index: number, cityCount: number, templateCount: number) {
  const waveSize = 5;
  let offset = index;
  for (let templateStart = 0; templateStart < templateCount; templateStart += waveSize) {
    const width = Math.min(waveSize, templateCount - templateStart);
    const waveTotal = cityCount * width;
    if (offset >= waveTotal) {
      offset -= waveTotal;
      continue;
    }
    return {
      cityIndex: Math.floor(offset / width),
      templateIndex: templateStart + (offset % width),
    };
  }
  return { cityIndex: 0, templateIndex: 0 };
}

function uniqueTelegramCities(cities: readonly SeedCity[]): SeedCity[] {
  const seen = new Set<string>();
  const result: SeedCity[] = [];
  for (const city of cities) {
    const country = String(city.country || '').trim();
    const label = String(city.uk || city.name || '').trim();
    if (!country || !label) continue;
    const key = `${country.toLocaleLowerCase('uk-UA')}|${label.toLocaleLowerCase('uk-UA')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(city);
  }
  return result;
}

function interleaveCitiesByCountry(cities: readonly SeedCity[]): SeedCity[] {
  const buckets = new Map<string, SeedCity[]>();
  const order: string[] = [];
  for (const city of cities) {
    const country = String(city.country || '').trim();
    if (!country) continue;
    if (!buckets.has(country)) {
      buckets.set(country, []);
      order.push(country);
    }
    buckets.get(country)!.push(city);
  }
  for (const bucket of buckets.values()) bucket.sort((left, right) => Number(right.population || 0) - Number(left.population || 0));
  const result: SeedCity[] = [];
  for (let index = 0; ; index += 1) {
    let added = false;
    for (const country of order) {
      const city = buckets.get(country)?.[index];
      if (!city) continue;
      result.push(city);
      added = true;
    }
    if (!added) break;
  }
  return result;
}

function telegramTemplatePriority(template: string) {
  const text = template.toLocaleLowerCase('uk-UA');
  // Start with intent-rich Ukrainian-community queries. A bare city name has
  // much lower precision and previously dominated early batches with generic catalogues.
  if (/українці в (місті|країні)/u.test(text)) return 0;
  if (/допомога українцям|помощь украинцам|допомога біженцям/u.test(text)) return 1;
  if (/назва міста чат/u.test(text)) return 2;
  if (/мамоч|батьки/u.test(text)) return 3;
  if (/барахол|оголош|объявлен|віддам|обмін|продаж/u.test(text)) return 4;
  if (/перевіз|перевез|передач/u.test(text)) return 5;
  if (/оренд|зніму житло|ріелтор/u.test(text)) return 6;
  if (text === 'ukrainian in' || text === 'ukrainians' || text === 'ukraine chat') return 7;
  if (text === 'просто назва міста') return 12;
  return 20;
}

function renderTelegramTemplate(template: string, city: string, country: string, mode: 'country' | 'city') {
  const place = mode === 'city' ? city : country;
  if (template === 'Ukrainian in') return place ? `Ukrainian in ${place}` : '';
  if (template === 'Ukrainians') return place ? `Ukrainians ${place}` : '';
  if (template === 'Ukraine chat') return place ? `Ukraine chat ${place}` : '';
  if (template === 'Просто назва міста') return mode === 'city' ? city : '';

  let query = template;
  if (mode === 'city') {
    if (!city) return '';
    query = query
      .replace(/Українці в місті \(назва міста\)/giu, `Українці в ${city}`)
      .replace(/назва міста або країни/giu, city)
      .replace(/назва країни або міста/giu, city)
      .replace(/\(назва міста\)/giu, city)
      .replace(/назва міста/giu, city);
  } else {
    if (!country) return '';
    query = query
      .replace(/Українці в країні \(назва країни\)/giu, `Українці в ${country}`)
      .replace(/назва міста або країни/giu, country)
      .replace(/назва країни або міста/giu, country)
      .replace(/\(назва країни\)/giu, country)
      .replace(/назва країни/giu, country);
  }
  query = query.replace(/\s*\+\s*/g, ' ').replace(/\s+/g, ' ').trim();
  if (!query || /назва |\(назва| або країни| або міста/iu.test(query)) return '';
  return query;
}

export function buildPublicSearchTasks(platforms: DiscoveryPlatform[]): SearchTask[] {
  const buckets = new Map<string, SeedCity[]>();
  const countryOrder: string[] = [];
  for (const city of SEEDS.cities) {
    const country = String(city.country || '').trim();
    if (!country) continue;
    if (!buckets.has(country)) {
      buckets.set(country, []);
      countryOrder.push(country);
    }
    buckets.get(country)!.push(city);
  }
  for (const bucket of buckets.values()) bucket.sort((left, right) => Number(right.population || 0) - Number(left.population || 0));

  const interleaved: SeedCity[] = [];
  for (let index = 0; ; index += 1) {
    let added = false;
    for (const country of countryOrder) {
      const city = buckets.get(country)?.[index];
      if (!city) continue;
      interleaved.push(city);
      added = true;
    }
    if (!added) break;
  }

  const tasks: SearchTask[] = [];
  for (const country of countryOrder) {
    for (const platform of platforms) tasks.push({
      kind: 'country',
      label: country,
      country,
      platform,
      query: `"${country}" українці "${platformHost(platform)}"`,
    });
  }
  for (const city of interleaved) {
    const name = String(city.uk || city.name || '').trim();
    const latin = String(city.name || '').trim();
    const country = String(city.country || '').trim();
    if (!name) continue;
    const aliases = !latin || latin.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0 ? name : `${name} ${latin}`;
    for (const platform of platforms) tasks.push({
      kind: 'city',
      label: name,
      country,
      platform,
      query: `"${aliases}" "${country}" українці "${platformHost(platform)}"`,
    });
  }
  return tasks;
}

export function extractInviteRecords(
  text: string,
  platforms: DiscoveryPlatform[],
  source: Omit<DiscoverySource, 'kind'> & { kind?: DiscoverySourceKind },
): DiscoveryRecord[] {
  const raw=String(text||'');
  const hasRequestedInvite=
    (platforms.includes('whatsapp')&&/chat\.whatsapp\.com/iu.test(raw))
    ||(platforms.includes('viber')&&/(?:invite\.viber\.com|chats\.viber\.com|vb\.me)/iu.test(raw));
  if(!hasRequestedInvite)return [];
  const decoded = decodeHtml(raw).replaceAll('\\/', '/');
  const pattern = /(?:https?:\/\/)?(?:chat\.whatsapp\.com|invite\.viber\.com|chats\.viber\.com|vb\.me)\/?[^\s<>"'\\]*/gi;
  const records: DiscoveryRecord[] = [];
  for (const match of decoded.matchAll(pattern)) {
    const raw = trimInvite(match[0]);
    const parsed = normalizeGroupLink(raw);
    if (!parsed || (parsed.platform !== 'whatsapp' && parsed.platform !== 'viber') || !platforms.includes(parsed.platform)) continue;
    const context = pageContext(decoded, match.index || 0, raw.length);
    // Search query / seed labels are discovery instructions, not evidence about this exact invite.
    // Otherwise a query such as "Українці Горлівка" can make an unrelated Arabic/Russian
    // WhatsApp catalogue look Ukrainian. Only factual text adjacent to the invite counts;
    // hand-curated sources may additionally contribute their trusted directory context.
    // 'telegram_scanned' is the same kind of fact: the runner read this title directly off the
    // Telegram group it scanned, not off a search query, so a group named e.g. "Українці
    // Регенсбургу" counts even when the specific invite message itself says only "приєднуйтесь 👇".
    const factualEvidence = source.kind === 'curated' || source.kind === 'telegram_scanned'
      ? [source.context, source.sourceTitle, context].filter(Boolean).join(' · ')
      : context;
    if (!isLikelyUkrainianCommunity(factualEvidence)) continue;
    records.push({
      platform: parsed.platform,
      link: parsed.link,
      nameHint: inferInviteLabel(context, parsed.link),
      source: {
        kind: source.kind || 'public_web',
        sourceUrl: bound(source.sourceUrl, 1000),
        sourceTitle: bound(source.sourceTitle, 180),
        query: bound(source.query, 500),
        seedLabel: bound(source.seedLabel, 180),
        seedKind: bound(source.seedKind, 40),
        context: bound(source.kind === 'curated'
          ? [source.context, context].filter(Boolean).join(' · ')
          : context, 700),
      },
    });
  }
  return records;
}

export function isLikelyUkrainianCommunity(value: string): boolean {
  const text = value.toLocaleLowerCase('uk-UA').normalize('NFKC');
  const ukrainianSignal = /(україн|украин|ukrain|🇺🇦)/u.test(text);
  if (!ukrainianSignal) return false;
  const spamSignal = /(crypto|крипт|bitcoin|forex|casino|казино|betting|ставк[аи]|dating|знакомств|знайомств|escort|ескорт|onlyfans|adult|18\+|nft|airdrop|signals?\b|binary options)/u.test(text);
  return !spamSignal;
}

function inferInviteLabel(context: string, invite: string): string {
  const plain = stripHtml(context);
  const token = new URL(invite).pathname.split('/').filter(Boolean).at(-1) || '';
  const position = Math.max(plain.indexOf(invite), token ? plain.indexOf(token) : -1);
  const before = position >= 0 ? plain.slice(0, position) : plain;
  const after = position >= 0 ? plain.slice(position + (plain.includes(invite) ? invite.length : token.length)) : '';
  const candidates = [after, ...before.split(/\s[—–|]\s/).reverse()];
  for (const candidate of candidates) {
    const name = cleanChatName(candidate.replace(/https?:\/\/\S+.*/i, '').replace(/^[\s—–\-:|]+|[\s—–\-:|]+$/g, ''));
    if (name.length < 4 || name.length > 140 || /^\s*(?:whatsapp|viber|invite|community landing page|join whatsapp group)\s*$/i.test(name)) continue;
    if (/^(?:не рекоменду|не рекоменд|warning|увага|внимание)/iu.test(name)) continue;
    return name;
  }
  return '';
}

function pageContext(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 420);
  const end = Math.min(text.length, index + length + 420);
  return bound(stripHtml(text.slice(start, end)), 700);
}

function stripHtml(value: string): string {
  return decodeHtml(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtml(value: string): string {
  const named: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
  let result = value;
  for (let pass = 0; pass < 3; pass += 1) {
    result = result.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (_, entity: string) => {
      if (!entity.startsWith('#')) return named[entity.toLowerCase()] || '';
      const code = entity[1].toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : '';
    });
  }
  return result;
}

function trimInvite(value: string): string {
  return value.replace(/[.,);\]}>]+$/g, '');
}

function platformHost(platform: DiscoveryPlatform) {
  return platform === 'whatsapp' ? 'chat.whatsapp.com' : 'invite.viber.com';
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function bound(value: unknown, length: number) {
  const text = typeof value === 'string'
    ? value
    : typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint'
      ? String(value)
      : '';
  return text.replace(/\s+/g, ' ').trim().slice(0, length);
}
