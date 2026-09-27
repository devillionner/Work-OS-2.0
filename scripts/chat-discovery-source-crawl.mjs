const SEARCH_URL = 'https://search.brave.com/search';
const USER_AGENT = 'Mozilla/5.0 (compatible; WorkOSLocalDiscovery/1.0)';
const PLACES = ['Берлін','Гамбург','Мюнхен','Кельн','Франкфурт','Дюссельдорф','Бремен','Ганновер','Лейпциг','Прага','Варшава','Краків','Вроцлав','Гданськ','Відень','Братислава','Будапешт','Амстердам','Роттердам','Гаага','Брюссель','Антверпен','Лондон','Манчестер','Дублін','Барселона','Мадрид','Валенсія','Рим','Мілан','Неаполь','Лісабон','Порту','Париж','Ліон','Цюрих','Женева','Осло','Стокгольм','Копенгаген','Гельсінкі','Торонто','Ванкувер','Монреаль','Нью-Йорк','Чикаго','Філадельфія'];
const INTENTS = ['українці','допомога українцям','українці оголошення','українці батьки','українці житло','українці перевезення'];
const PLAN_SIZE = PLACES.length * INTENTS.length;
const UA = /(?:україн|украин|ukrain|🇺🇦)/iu;
const SPAM = /(?:crypto|bitcoin|forex|casino|казино|betting|dating|escort|onlyfans|nft|airdrop|signals?\b|قروبات|روابط\s+مجموعات|مجموعات\s+واتساب|technical\s+support)/iu;

export function localDiscoveryPlanSize() { return PLAN_SIZE; }

export async function crawlLocalDiscoverySource(cursor, { fetcher = fetch } = {}) {
  const index = Math.max(0, Number(cursor) || 0);
  if (index >= PLAN_SIZE) return { searched:0, nextCursor:index, done:true, query:'', sources:[] };
  const place = PLACES[index % PLACES.length];
  const intent = INTENTS[Math.floor(index / PLACES.length) % INTENTS.length];
  const query = 'site:t.me/s "' + place + '" ' + intent + ' chat.whatsapp.com';
  const search = new URL(SEARCH_URL);
  search.searchParams.set('q', query);
  search.searchParams.set('source', 'web');
  const html = await fetchText(search.toString(), fetcher, 12000, 350000);
  if (!html) return { searched:1, nextCursor:index+1, done:index+1>=PLAN_SIZE, query, sources:[] };
  const candidates = rankTelegramSources(html, place).slice(0, 3);
  const sources = [];
  for (const sourceUrl of candidates) {
    const page = await fetchText(sourceUrl, fetcher, 12000, 900000);
    if (!page) continue;
    const title = telegramTitle(page, sourceUrl);
    const snippets = extractRelevantInviteSnippets(page, title);
    if (!snippets.length) continue;
    sources.push({ sourceUrl, sourceTitle:title || telegramChannel(sourceUrl) || ('Telegram · ' + place), query, seedLabel:place, context:title || place, text:snippets.join('\n\n').slice(0,45000) });
  }
  return { searched:1, nextCursor:index+1, done:index+1>=PLAN_SIZE, query, sources };
}

function rankTelegramSources(html, place) {
  const decoded = decode(html).replaceAll('\\/', '/');
  const seen = new Set();
  const ranked = [];
  const re = /https:\/\/t\.me\/(?:s\/)?[A-Za-z0-9_]+(?:\?before=\d+)?/giu;
  for (const match of decoded.matchAll(re)) {
    const sourceUrl = normalizeTelegramPreview(match[0]);
    if (!sourceUrl || seen.has(sourceUrl)) continue;
    seen.add(sourceUrl);
    const i = match.index || 0;
    const context = strip(decoded.slice(Math.max(0,i-900), Math.min(decoded.length,i+1800)));
    const path = telegramChannel(sourceUrl) || '';
    if (SPAM.test(context) || SPAM.test(path)) continue;
    let score = 0;
    if (UA.test(context)) score += 12;
    if (new RegExp(escapeRegExp(place), 'iu').test(context)) score += 5;
    if (/(?:^|[_-])(?:ua|ukr|ukraine|ukrainian)(?:[_-]|$)/iu.test(path)) score += 7;
    if (/chat\.whatsapp\.com/iu.test(context)) score += 10;
    if (/(?:допомог|help|refuge|біжен|community|громад|diaspora)/iu.test(context)) score += 2;
    if (score < 7) continue;
    ranked.push({ sourceUrl, score });
  }
  return ranked.sort((a,b)=>b.score-a.score).map(item=>item.sourceUrl);
}

function extractRelevantInviteSnippets(html,title) {
  const decoded = decode(html).replaceAll('\\/', '/');
  const titleEvidence = strip(title || '');
  const result = [];
  const seen = new Set();
  const re = /(?:https?:\/\/)?chat\.whatsapp\.com\/[A-Za-z0-9_-]{8,128}(?:\?[^\s<>"']*)?/giu;
  for (const match of decoded.matchAll(re)) {
    const canonical = canonicalInvite(match[0]);
    if (!canonical || seen.has(canonical)) continue;
    const i = match.index || 0;
    const context = strip(decoded.slice(Math.max(0,i-1100), Math.min(decoded.length,i+match[0].length+1100)));
    const evidence = titleEvidence + ' · ' + context;
    if (!UA.test(evidence) || SPAM.test(context)) continue;
    const arabic = (context.match(/[\u0600-\u06ff]/gu) || []).length;
    const letters = (context.match(/\p{L}/gu) || []).length || 1;
    if (arabic / letters > 0.25) continue;
    seen.add(canonical);
    result.push(titleEvidence + '\n' + context + '\n' + canonical);
    if (result.length >= 12) break;
  }
  return result;
}

function canonicalInvite(value) {
  try {
    const raw = /^https?:\/\//i.test(value) ? value : ('https://' + value);
    const url = new URL(raw);
    if (url.hostname.toLowerCase() !== 'chat.whatsapp.com') return null;
    const code = url.pathname.split('/').filter(Boolean)[0] || '';
    return /^[A-Za-z0-9_-]{8,128}$/u.test(code) ? ('https://chat.whatsapp.com/' + code) : null;
  } catch { return null; }
}
function normalizeTelegramPreview(value) {
  try {
    const url = new URL(value);
    if (url.hostname !== 't.me' && url.hostname !== 'telegram.me') return null;
    const parts = url.pathname.split('/').filter(Boolean);
    const channel = parts[0] === 's' ? parts[1] : parts[0];
    if (!channel || !/[A-Za-z0-9_]{3,}/u.test(channel)) return null;
    const out = new URL('https://t.me/s/' + channel);
    const before = url.searchParams.get('before');
    if (before && /^\d+$/u.test(before)) out.searchParams.set('before', before);
    return out.toString();
  } catch { return null; }
}
function telegramChannel(value) { try { return new URL(value).pathname.split('/').filter(Boolean).filter(x=>x!=='s')[0] || ''; } catch { return ''; } }
function telegramTitle(html,sourceUrl) {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/iu)?.[1] || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/iu)?.[1];
  if (og) return strip(decode(og));
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/iu)?.[1];
  return strip(decode(title || telegramChannel(sourceUrl)));
}
async function fetchText(url,fetcher,timeout,limit) {
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(),timeout);
  try {
    const response = await fetcher(url,{signal:controller.signal,redirect:'follow',headers:{'User-Agent':USER_AGENT,Accept:'text/html,application/xhtml+xml,text/plain;q=0.8','Accept-Language':'uk,en;q=0.8'}});
    if (!response.ok) return '';
    const reader = response.body?.getReader();
    if (!reader) return (await response.text()).slice(0,limit);
    const decoder = new TextDecoder(); let bytes=0, text='';
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > limit) { await reader.cancel(); break; }
      text += decoder.decode(chunk.value,{stream:true});
    }
    return text + decoder.decode();
  } catch { return ''; } finally { clearTimeout(timer); }
}
function decode(value) {
  const named={amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '};
  return String(value||'').replace(/&(#x?[0-9a-f]+|[a-z]+);/giu,(_,key)=>{
    const lower=String(key).toLowerCase();
    if(lower[0]==='#'){const hex=lower[1]==='x';const n=parseInt(lower.slice(hex?2:1),hex?16:10);return Number.isFinite(n)?String.fromCodePoint(n):_;}
    return named[lower] ?? _;
  });
}
function strip(value) { return decode(value).replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/giu,' ').replace(/<[^>]+>/gu,' ').replace(/\s+/gu,' ').trim(); }
function escapeRegExp(value) { return String(value).replace(/[-/\\^$*+?.()|[\]{}]/g,'\\$&'); }
