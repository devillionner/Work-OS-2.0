import { canonicalDirections, focusDirectionForTag, sameDirections } from '../directions.ts';
import { profilePublicationRule, PROFILE_CADENCES, type ProfileCadence } from './profile.ts';

export type PublicationAdvertisementRow = {
  id: string;
  title: string;
  uk_text: string;
  ru_text: string;
  notes: string;
  tags_json: string;
  platforms_json: string;
  updated_at: number;
};

export type PublicationAdvertisement = {
  id: string;
  title: string;
  ukText: string;
  ruText: string;
  notes: string;
  tags: string[];
  platforms: string[];
  suggestedLanguage: 'uk' | 'ru' | null;
  usedToday: boolean;
  selectable: boolean;
  recommended: boolean;
  directionMatch: 'matched' | 'generic' | 'other';
  note: string | null;
};

export type PublicationFocusPlan = {
  currentDirections: string[];
  planDirections: string[];
  planCreatedAt: number;
  currentFocusUpdatedAt: number;
  stale: boolean;
  addedDirections: string[];
  removedDirections: string[];
  source: 'workday' | 'current-focus';
  workday: { id: string; workDate: string; version: number } | null;
};

export type PublicationAdvertisementSelection = {
  platform: string;
  profileLanguage: 'uk' | 'ru' | null;
  profileDirections: string[];
  profileConfirmed: boolean;
  publicationAllowed: boolean;
  publicationReason: string | null;
  focusPlan: PublicationFocusPlan;
  items: PublicationAdvertisement[];
};

type SelectionChatRow = {
  platform: string;
  language: string | null;
  directions_json: string | null;
  review_status: string | null;
  cadence: string | null;
  weekdays_json: string | null;
  custom_interval_days: number | null;
  next_allowed_on: string | null;
};

type FocusSettingRow = { value_json: string; updated_at: number };
type WorkdayFocusRow = {
  id: string;
  work_date: string;
  status: string;
  version: number;
  plan_json: string | null;
};
type RankedAdvertisement = PublicationAdvertisement & { updatedAt: number };

export async function readPublicationAdvertisementSelection(
  db: D1Database,
  input: { userId: string; chatId: string; date: string },
): Promise<PublicationAdvertisementSelection | null> {
  const chat = await db.prepare(`SELECT c.platform,p.language,p.directions_json,p.review_status,p.cadence,p.weekdays_json,p.custom_interval_days,p.next_allowed_on
    FROM chats c LEFT JOIN chat_profiles p ON p.chat_id=c.id
    WHERE c.id=?1 AND c.user_id=?2 AND c.workflow_status='ready' LIMIT 1`).bind(input.chatId, input.userId).first<SelectionChatRow>();
  if (!chat) return null;

  const [advertisementsResult, usedResult, focusResult, workdayResult] = await db.batch([
    db.prepare(`SELECT id,title,uk_text,ru_text,notes,tags_json,platforms_json,updated_at
      FROM library_items
      WHERE user_id=?1 AND kind='advertisement' AND archived_at IS NULL
      ORDER BY updated_at DESC,title LIMIT 500`).bind(input.userId),
    db.prepare(`SELECT DISTINCT p.advertisement_id
      FROM chat_publications p JOIN chats c ON c.id=p.chat_id AND c.user_id=p.user_id
      WHERE p.user_id=?1 AND c.platform=?2 AND p.published_on=?3 AND p.advertisement_id IS NOT NULL`)
      .bind(input.userId, chat.platform, input.date),
    db.prepare(`SELECT value_json,updated_at FROM user_settings
      WHERE user_id=?1 AND setting_key='focus_directions' LIMIT 1`).bind(input.userId),
    db.prepare(`SELECT w.id,w.work_date,w.status,w.version,p.value_json AS plan_json
      FROM workdays w
      LEFT JOIN user_settings p ON p.user_id=w.user_id AND p.setting_key=('workday_plan:' || w.id)
      WHERE w.user_id=?1 AND (w.status!='ended' OR w.work_date=?2)
      ORDER BY CASE WHEN w.status!='ended' THEN 0 ELSE 1 END,w.started_at DESC LIMIT 1`)
      .bind(input.userId, input.date),
  ]);

  const language = chat.language === 'uk' || chat.language === 'ru' ? chat.language : null;
  const directions = canonicalDirections(parseList(chat.directions_json));
  const focusRow = (focusResult.results as FocusSettingRow[])[0] || null;
  const workdayRow = (workdayResult.results as WorkdayFocusRow[])[0] || null;
  const focusPlan = projectPublicationFocusPlan(
    canonicalDirections(parseList(focusRow?.value_json || '[]')),
    Number(focusRow?.updated_at || 0),
    workdayRow ? {
      id: workdayRow.id,
      workDate: workdayRow.work_date,
      version: Number(workdayRow.version || 0),
      open: workdayRow.status !== 'ended',
      plan: readWorkdayFocusPlan(workdayRow.plan_json),
    } : null,
  );
  const cadence = typeof chat.cadence === 'string' && PROFILE_CADENCES.includes(chat.cadence as ProfileCadence)
    ? chat.cadence as ProfileCadence : 'any';
  const customIntervalDays = Number.isInteger(Number(chat.custom_interval_days)) && Number(chat.custom_interval_days) > 0
    ? Number(chat.custom_interval_days) : null;
  const publicationRule = profilePublicationRule({
    reviewStatus: chat.review_status === 'confirmed' ? 'confirmed' : 'draft',
    cadence,
    weekdays: parseWeekdays(chat.weekdays_json),
    customIntervalDays,
    nextAllowedOn: typeof chat.next_allowed_on === 'string' ? chat.next_allowed_on : null,
  }, input.date);
  const usedToday = new Set((usedResult.results as Array<{ advertisement_id: string | null }>)
    .map((row) => row.advertisement_id)
    .filter((value): value is string => typeof value === 'string' && Boolean(value)));
  return {
    platform: chat.platform,
    profileLanguage: language,
    profileDirections: directions,
    profileConfirmed: chat.review_status === 'confirmed',
    publicationAllowed: publicationRule.allowed,
    publicationReason: publicationRule.reason,
    focusPlan,
    items: rankPublicationAdvertisements(advertisementsResult.results as PublicationAdvertisementRow[], {
      platform: chat.platform,
      profileLanguage: language,
      profileDirections: directions,
      profileConfirmed: chat.review_status === 'confirmed',
      focusDirections: focusPlan.planDirections,
      usedToday,
    }),
  };
}

export function rankPublicationAdvertisements(
  rows: PublicationAdvertisementRow[],
  input: {
    platform: string;
    profileLanguage: 'uk' | 'ru' | null;
    profileDirections: string[];
    profileConfirmed: boolean;
    focusDirections?: string[];
    usedToday: ReadonlySet<string>;
  },
): PublicationAdvertisement[] {
  const directions = input.profileConfirmed ? canonicalDirections(input.profileDirections).map(normalize).filter(Boolean) : [];
  const focusDirections = new Set(canonicalDirections(input.focusDirections || []).map(normalize));
  const candidates = rows.flatMap((row) => {
    const platforms = parseList(row.platforms_json);
    if (platforms.length && !platforms.some((value) => normalize(value) === normalize(input.platform))) return [];
    const tags = parseList(row.tags_json);
    const normalizedTags = tags.map(normalize).filter(Boolean);
    const taggedFocusDirections = canonicalDirections(tags.flatMap((tag) => {
      const matched = focusDirectionForTag(tag);
      return matched ? [matched] : [];
    }));
    if (focusDirections.size && taggedFocusDirections.length && !taggedFocusDirections.some((value) => focusDirections.has(normalize(value)))) return [];
    const directionMatch: PublicationAdvertisement['directionMatch'] = !directions.length
      ? 'generic'
      : !normalizedTags.length
        ? 'generic'
        : normalizedTags.some((tag) => directions.some((direction) => relatedDirection(tag, direction)))
          ? 'matched'
          : 'other';
    return [{ row, tags, platforms, directionMatch, usedToday: input.usedToday.has(row.id) }];
  });

  const suitable = candidates.filter((candidate) => candidate.directionMatch !== 'other');
  const eligiblePool = suitable.length ? suitable : candidates;
  const eligibleIds = new Set(eligiblePool.map((candidate) => candidate.row.id));
  const hasUnusedEligible = eligiblePool.some((candidate) => !candidate.usedToday);

  const ranked: RankedAdvertisement[] = candidates.map((candidate) => {
    const inEligiblePool = eligibleIds.has(candidate.row.id);
    const repeatAllowed = candidate.usedToday && inEligiblePool && !hasUnusedEligible;
    const selectable = !candidate.usedToday || repeatAllowed;
    const suggestedLanguage = chooseLanguage(candidate.row, input.profileLanguage);
    const notes: string[] = [];
    if (candidate.directionMatch === 'other') notes.push('Інший напрямок — перевірте відповідність вручну.');
    if (candidate.usedToday && !selectable) notes.push('Вже використано сьогодні на цій платформі; спочатку оберіть невикористаний придатний варіант.');
    if (repeatAllowed) notes.push('Повтор дозволений: усі придатні варіанти вже використані сьогодні.');
    if (input.profileLanguage && suggestedLanguage && suggestedLanguage !== input.profileLanguage)
      notes.push(`У профілі мова ${input.profileLanguage.toUpperCase()}, але для цього матеріалу доступна лише ${suggestedLanguage.toUpperCase()}.`);
    return {
      id: candidate.row.id,
      title: candidate.row.title,
      ukText: candidate.row.uk_text,
      ruText: candidate.row.ru_text,
      notes: candidate.row.notes,
      tags: candidate.tags,
      platforms: candidate.platforms,
      suggestedLanguage,
      usedToday: candidate.usedToday,
      selectable,
      recommended: inEligiblePool && candidate.directionMatch !== 'other' && !candidate.usedToday,
      directionMatch: candidate.directionMatch,
      note: notes.length ? notes.join(' ') : null,
      updatedAt: Number(candidate.row.updated_at || 0),
    };
  });
  ranked.sort((a, b) => {
    const recommended = Number(b.recommended) - Number(a.recommended);
    if (recommended) return recommended;
    const selectable = Number(b.selectable) - Number(a.selectable);
    if (selectable) return selectable;
    const direction = directionScore(b.directionMatch) - directionScore(a.directionMatch);
    if (direction) return direction;
    const unused = Number(a.usedToday) - Number(b.usedToday);
    if (unused) return unused;
    const updated = b.updatedAt - a.updatedAt;
    return updated || a.title.localeCompare(b.title, 'uk');
  });
  return ranked.map((item) => ({
    id: item.id,
    title: item.title,
    ukText: item.ukText,
    ruText: item.ruText,
    notes: item.notes,
    tags: item.tags,
    platforms: item.platforms,
    suggestedLanguage: item.suggestedLanguage,
    usedToday: item.usedToday,
    selectable: item.selectable,
    recommended: item.recommended,
    directionMatch: item.directionMatch,
    note: item.note,
  }));
}

export async function validatePublicationAdvertisementChoice(
  db: D1Database,
  input: { userId: string; chatId: string; advertisementId: string; date: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const selection = await readPublicationAdvertisementSelection(db, input);
  if (!selection) return { ok: false, error: 'Чат не знайдено.' };
  const item = selection.items.find((candidate) => candidate.id === input.advertisementId);
  if (!item) return { ok: false, error: 'Це оголошення недоступне для цієї платформи або вже заархівоване.' };
  if (!item.selectable) return { ok: false, error: item.note || 'Оберіть інше оголошення.' };
  return { ok: true };
}

export function projectPublicationFocusPlan(
  currentDirections: string[],
  currentFocusUpdatedAt: number,
  workday: {
    id: string;
    workDate: string;
    version: number;
    open: boolean;
    plan: { focusDirections: string[]; createdAt: number } | null;
  } | null,
): PublicationFocusPlan {
  const current = canonicalDirections(currentDirections);
  const plan = workday?.plan ? canonicalDirections(workday.plan.focusDirections) : current;
  const planCreatedAt = workday?.plan?.createdAt || currentFocusUpdatedAt;
  const currentSet = new Set(current.map(normalize));
  const planSet = new Set(plan.map(normalize));
  const stale = Boolean(workday?.plan) && !sameDirections(current, plan);
  return {
    currentDirections: current,
    planDirections: plan,
    planCreatedAt,
    currentFocusUpdatedAt,
    stale,
    addedDirections: current.filter((item) => !planSet.has(normalize(item))),
    removedDirections: plan.filter((item) => !currentSet.has(normalize(item))),
    source: workday?.plan ? 'workday' : 'current-focus',
    workday: stale && workday?.open
      ? { id: workday.id, workDate: workday.workDate, version: workday.version }
      : null,
  };
}

function readWorkdayFocusPlan(value: string | null): { focusDirections: string[]; createdAt: number } | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (!Array.isArray(record.focusDirections) || !Number.isSafeInteger(record.createdAt) || Number(record.createdAt) < 0) return null;
    return {
      focusDirections: record.focusDirections.filter((item): item is string => typeof item === 'string'),
      createdAt: Number(record.createdAt),
    };
  } catch {
    return null;
  }
}

function chooseLanguage(row: Pick<PublicationAdvertisementRow, 'uk_text' | 'ru_text'>, preferred: 'uk' | 'ru' | null) {
  const hasUk = Boolean(row.uk_text.trim());
  const hasRu = Boolean(row.ru_text.trim());
  if (preferred === 'ru' && hasRu) return 'ru' as const;
  if (preferred === 'uk' && hasUk) return 'uk' as const;
  if (hasUk) return 'uk' as const;
  if (hasRu) return 'ru' as const;
  return null;
}

function parseList(value: string | null): string[] {
  try {
    const parsed: unknown = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function parseWeekdays(value: string | null): number[] {
  try {
    const parsed: unknown = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? [...new Set(parsed.filter((item): item is number => Number.isInteger(item) && item >= 1 && item <= 7))].sort((a, b) => a - b) : [];
  } catch {
    return [];
  }
}

function normalize(value: string) {
  return value.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('uk-UA');
}

function relatedDirection(left: string, right: string) {
  return left === right || (left.length >= 4 && right.length >= 4 && (left.includes(right) || right.includes(left)));
}

function directionScore(value: PublicationAdvertisement['directionMatch']) {
  return value === 'matched' ? 2 : value === 'generic' ? 1 : 0;
}
