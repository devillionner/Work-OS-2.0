import { canonicalKnownSubject } from '../../subjects.ts';

export type LeadScriptItem = {
  id: string;
  title: string;
  ukText: string;
  ruText: string;
  notes: string;
  tags: string[];
  platforms: string[];
  updatedAt: number;
  collection?: 'official_script' | 'personal_script';
  /** Розмітка для рекомендацій: етап воронки (null — будь-який), гілка (інтерес ліда), оригінал і ключ шаблону. */
  stage?: string | null;
  branch?: string;
  originId?: string | null;
  templateKey?: string | null;
};

export type LeadScriptContext = {
  platform: string;
  subject: string;
  funnelStage: string;
  qualification: string | null;
  /** Інтерес ліда (гілка розмови). */
  interest?: string;
  /** Найближчий урок ліда: за добу (`day`), за годину (`hour`) чи далі (`null`): обирає шаблон нагадування. */
  reminder?: 'day' | 'hour' | null;
  used?: ReadonlySet<string>;
};

export type RankedLeadScript = LeadScriptItem & {
  score: number;
  audience: 'personal' | 'work';
  /** Підходить саме зараз: збігається етап, гілка чи напрямок. */
  recommended: boolean;
  used: boolean;
};

const normalize = (value: string) => value.trim().toLocaleLowerCase('uk-UA');
const tokens = (value: string) => normalize(value).split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 1);
const containsAny = (haystack: Set<string>, needles: string[]) => needles.some((needle) => haystack.has(needle));

/**
 * Скрипти для ліда: за етапом воронки, предметом (напрямком), гілкою й платформою. Невідповідний етап чи гілка не виключають скрипт,
 * а лише опускають його нижче; платформа, що не збігається, виключає. `recommended` — те, що варто показати вгорі.
 */
export function rankLeadScripts(items: LeadScriptItem[], context: LeadScriptContext, limit = 40): RankedLeadScript[] {
  const platform = normalize(context.platform);
  const subjectTokens = tokens(context.subject);
  const leadSubject = canonicalKnownSubject(context.subject);
  const qualification = normalize(context.qualification ?? '');
  const interest = normalize(context.interest ?? '');
  const hasPersonalCopy = new Set(items.flatMap((item) => (item.originId ? [item.originId] : [])));

  return items
    .map((item): RankedLeadScript | null => {
      const itemPlatforms = item.platforms.map(normalize).filter(Boolean);
      if (itemPlatforms.length && !itemPlatforms.includes(platform)) return null;

      const searchable = new Set([...tokens(item.title), ...tokens(item.notes), ...item.tags.flatMap(tokens)]);
      let score = 1;
      let match = false;
      if (itemPlatforms.includes(platform)) score += 2;

      if (item.stage) {
        if (item.stage === context.funnelStage) { score += 12; match = true; } else score -= 6;
      }

      const directions = item.tags.map((tag) => canonicalKnownSubject(tag)).filter((tag): tag is NonNullable<typeof tag> => tag !== null);
      if (directions.length && leadSubject) {
        if (directions.includes(leadSubject)) { score += 10; match = true; } else score -= 6;
      } else if (subjectTokens.length && containsAny(searchable, subjectTokens)) score += 6;
      if (qualification && searchable.has(qualification)) score += 3;

      const branch = normalize(item.branch ?? '');
      if (branch) {
        if (interest && branch === interest) { score += 10; match = true; } else if (interest) score -= 8; else score -= 3;
      }

      if (item.templateKey === 'reminder_day' || item.templateKey === 'reminder_hour') {
        const wanted = item.templateKey === 'reminder_day' ? 'day' : 'hour';
        if (context.reminder === wanted) { score += 10; match = true; } else score -= context.reminder ? 8 : 6;
      }
      if (hasPersonalCopy.has(item.id)) score -= 3;
      const used = context.used?.has(item.id) ?? false;
      if (used) score -= 4;

      const personalTags = new Set(['personal', 'особистий', 'особисте', 'особисті']);
      const audience = item.collection
        ? item.collection === 'personal_script' ? 'personal' : 'work'
        : item.tags.some((tag) => personalTags.has(normalize(tag))) ? 'personal' : 'work';
      return { ...item, score, audience, recommended: match && score >= 10, used };
    })
    .filter((item): item is RankedLeadScript => item !== null)
    .sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt || a.title.localeCompare(b.title, 'uk'))
    .slice(0, Math.max(0, limit));
}
