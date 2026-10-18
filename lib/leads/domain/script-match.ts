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

/** Мітки аудиторії скрипту — звичайні теги: хто вчиться, дитина чи дорослий. */
export const AUDIENCE_TAGS = { child: 'Дитина', adult: 'Дорослий' } as const;
export type Learner = 'child' | 'adult';

/** Хто вчиться: є учні при ліді — дитина; лід сам учень і учнів немає — дорослий; інакше невідомо. */
export function learnerOf(isStudent: number, studentCount: number): Learner | null {
  return studentCount > 0 ? 'child' : isStudent === 1 ? 'adult' : null;
}

export type LeadScriptContext = {
  platform: string;
  subject: string;
  funnelStage: string;
  qualification: string | null;
  /** Інтерес ліда (гілка розмови). */
  interest?: string;
  /** Хто вчиться (див. learnerOf): скрипт для іншої аудиторії не рекомендується. */
  learner?: Learner | null;
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

// Напрями скриптів, яких немає серед стандартних предметів Work OS (їх не додаємо до списку предметів ліда й оголошень):
// ставляться тегом скрипту й порівнюються з предметом ліда за назвою чи псевдонімом.
const SCRIPT_DIRECTIONS: ReadonlyArray<{ name: string; aliases: readonly string[] }> = [
  { name: 'Дошкільна підготовка', aliases: ['дошкільна', 'підготовка до школи', 'дошкільна підготовка'] },
  { name: 'Soft Skills', aliases: ['soft skills', 'soft skill', 'софт скілс', 'софт скіл', 'софт скілл', 'софт-скіл', 'мʼякі навички'] },
];

/** Напрям за назвою: стандартний предмет Work OS або один із додаткових напрямів скриптів; інакше `null`. */
function directionOf(value: string): string | null {
  const known = canonicalKnownSubject(value);
  if (known) return known;
  const key = normalize(value);
  return SCRIPT_DIRECTIONS.find((direction) => normalize(direction.name) === key || direction.aliases.includes(key))?.name ?? null;
}
const tokens = (value: string) => normalize(value).split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 1);
const containsAny = (haystack: Set<string>, needles: string[]) => needles.some((needle) => haystack.has(needle));

/**
 * Скрипти для ліда: за етапом воронки, предметом (напрямком), гілкою й платформою. Невідповідний етап чи гілка не виключають скрипт,
 * а лише опускають його нижче; платформа, що не збігається, виключає. `recommended` — те, що варто показати вгорі.
 */
export function rankLeadScripts(items: LeadScriptItem[], context: LeadScriptContext, limit = 40): RankedLeadScript[] {
  const platform = normalize(context.platform);
  const subjectTokens = tokens(context.subject);
  const leadSubject = directionOf(context.subject);
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

      const directions = item.tags.map((tag) => directionOf(tag)).filter((tag): tag is string => tag !== null);
      let subjectMismatch = false;
      if (directions.length && leadSubject) {
        if (directions.includes(leadSubject)) { score += 10; match = true; } else { score -= 6; subjectMismatch = true; }
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
      let audienceMismatch = false;
      const itemTags = new Set(item.tags.map(normalize));
      const scriptLearner: Learner | null = itemTags.has(normalize(AUDIENCE_TAGS.child)) ? 'child' : itemTags.has(normalize(AUDIENCE_TAGS.adult)) ? 'adult' : null;
      if (scriptLearner && context.learner) {
        if (scriptLearner === context.learner) score += 4; else { score -= 10; audienceMismatch = true; }
      }
      if (hasPersonalCopy.has(item.id)) score -= 3;
      const used = context.used?.has(item.id) ?? false;
      if (used) score -= 4;

      const personalTags = new Set(['personal', 'особистий', 'особисте', 'особисті']);
      const audience = item.collection
        ? item.collection === 'personal_script' ? 'personal' : 'work'
        : item.tags.some((tag) => personalTags.has(normalize(tag))) ? 'personal' : 'work';
      return { ...item, score, audience, recommended: match && score >= 10 && !audienceMismatch && !subjectMismatch, used };
    })
    .filter((item): item is RankedLeadScript => item !== null)
    .sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt || a.title.localeCompare(b.title, 'uk'))
    .slice(0, Math.max(0, limit));
}
