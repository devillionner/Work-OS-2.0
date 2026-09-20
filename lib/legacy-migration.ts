import { FOCUS_DIRECTIONS, canonicalDirections } from './directions.ts';

type JsonRecord = Record<string, unknown>;

const PLATFORM_KEYS = {
  telegram: 'telegram-groups-checklist-v1',
  whatsapp: 'whatsapp-groups-checklist-v1',
  viber: 'viber-groups-checklist-v1',
  facebook: 'facebook-groups-checklist-v1',
} as const;

const DOMAIN_KEYS = new Set([
  ...Object.values(PLATFORM_KEYS),
  'deleted-groups-archive-v1',
  'shared-leads-v1',
  'daily-report-history-v1',
]);

export type MigrationTelegramAccount = {
  id: string; number: number; name: string; selected: number;
  createdAt: number; updatedAt: number;
};
export type MigrationChat = {
  id: string; platform: string; name: string; link: string; normalizedLink: string;
  workflowStatus: string; isPrivate: number; joinedAt: number | null;
  processedAt: number | null; snoozedUntil: number | null; archiveReason: string | null;
  archivedAt: number | null; note: string; legacyDate: string | null;
  payloadJson: string; createdAt: number; updatedAt: number;
  telegramAccountId: string | null; telegramAccountExplicit: number;
};
export type MigrationProfile = {
  chatId: string; language: string | null; cadence: string; weekdaysJson: string;
  directionsJson: string; note: string; reviewStatus: string; source: string; updatedAt: number;
};
export type MigrationPublication = {
  id: string; chatId: string; publishedOn: string; publishedAt: number | null;
  sourceKey: string; createdAt: number;
};
export type MigrationLead = {
  id: string; legacyId: string; name: string; phone: string; telegramUsername: string;
  normalizedPhone: string; normalizedTelegram: string; platform: string; subject: string;
  sourceChatId: string | null; sourceChatLink: string; note: string; needsDetails: number;
  status: string; teacherName: string; lessonPlatform: string | null; meetingLink: string;
  isStudent: number; ageGroup: string; responseDate: string; bookingDate: string | null;
  responseCancelledAt: number | null; responseCancelledDate: string | null;
  createdAt: number; bookedAt: number | null;
  archivedAt: number | null; payloadJson: string; updatedAt: number;
};
export type MigrationStudent = {
  id: string; leadId: string; legacyId: string; name: string; surname: string;
  ageGroup: string; note: string; createdAt: number; updatedAt: number;
};
export type MigrationLesson = {
  id: string; leadId: string; studentId: string | null; legacyId: string;
  studentName: string; subject: string; teacherName: string; lessonDate: string;
  lessonTime: string; lessonPlatform: string | null; meetingLink: string;
  status: string; bookingDate: string; createdAt: number; updatedAt: number;
};
export type MigrationCuratorRequest = {
  id: string; leadId: string; legacyId: string; status: string;
  submittedAt: number; submittedDate: string; resolvedAt: number | null;
  lessonId: string | null; createdAt: number; updatedAt: number;
};
export type MigrationReport = {
  id: string; reportDate: string; reportText: string; payloadJson: string;
  submittedAt: number | null; updatedAt: number;
};
export type MigrationSetting = { key: string; valueJson: string; updatedAt: number };
export type MigrationEvent = {
  id: string; eventType: string; platform: string | null; chatId: string | null;
  leadId: string | null; lessonId: string | null; occurredAt: number; eventDate: string;
  metadataJson: string; sourceKey: string;
  cancelledAt: number | null; telegramAccountId: string | null;
};

export type LegacyMigrationDataset = {
  accounts: MigrationTelegramAccount[];
  chats: MigrationChat[];
  profiles: MigrationProfile[];
  publications: MigrationPublication[];
  leads: MigrationLead[];
  students: MigrationStudent[];
  lessons: MigrationLesson[];
  curatorRequests: MigrationCuratorRequest[];
  reports: MigrationReport[];
  settings: MigrationSetting[];
  events: MigrationEvent[];
};

export const MIGRATION_PHASES = [
  'accounts', 'chats', 'profiles', 'publications', 'leads', 'students', 'lessons', 'curatorRequests', 'reports', 'settings', 'events',
] as const;
export type MigrationPhase = (typeof MIGRATION_PHASES)[number];

export function buildLegacyMigrationDataset(raw: string, userId: string): LegacyMigrationDataset {
  const backup = JSON.parse(raw) as { storage?: Record<string, string> };
  const storage = backup.storage || {};
  const now = Math.floor(Date.now() / 1000);
  const archive = parseRecord(storage['deleted-groups-archive-v1']);
  const accountState = parseRecord(storage['telegram-multi-account-v1']);
  const accountSeeds = new Map<string, { number: number; name: string }>();
  for (const item of array(accountState.accounts).filter(isRecord)) addAccountSeed(item);
  for (const item of array(archive.telegram).filter(isRecord)) {
    const group = isRecord(item.groupData) ? { ...item.groupData, ...item } : item;
    addAccountSeed({
      id: group.telegramAccountId,
      number: group.telegramAccountNumber,
      name: group.telegramAccountName,
    });
  }
  if (!accountSeeds.size) addAccountSeed({ id: 'tg1', number: 1, name: 'TG 1' });
  const selectedLegacyId = text(accountState.selected);
  const accounts: MigrationTelegramAccount[] = [...accountSeeds.entries()]
    .sort(([, left], [, right]) => left.number - right.number)
    .map(([legacyId, account], index) => ({
      id: `${userId}:tg${account.number}`,
      number: account.number,
      name: account.name,
      selected: selectedLegacyId ? Number(legacyId === selectedLegacyId) : Number(index === 0),
      createdAt: now,
      updatedAt: now,
    }))
    .sort((left, right) => left.selected - right.selected || left.number - right.number);
  const accountIdByLegacyId = new Map(
    [...accountSeeds.entries()].map(([legacyId, account]) => [legacyId, `${userId}:tg${account.number}`]),
  );
  const assignments = isRecord(accountState.assignments) ? accountState.assignments : {};
  const candidateAssignments = isRecord(accountState.candidateAssignments) ? accountState.candidateAssignments : {};
  const chats: MigrationChat[] = [];
  const profiles: MigrationProfile[] = [];
  const publications: MigrationPublication[] = [];
  const chatIdByLink = new Map<string, string>();

  for (const [platform, key] of Object.entries(PLATFORM_KEYS)) {
    const groups = parseArray(storage[key]);
    groups.forEach((group, index) => addChat(group, platform, `active:${platform}:${index}`, false));
  }
  for (const [platform, entries] of Object.entries(archive)) {
    if (!Array.isArray(entries)) continue;
    entries.filter(isRecord).forEach((entry, index) => {
      const group = isRecord(entry.groupData) ? { ...entry.groupData, ...entry } : entry;
      addChat(group, platform, `archive:${platform}:${index}`, true);
    });
  }

  function addChat(group: JsonRecord, platform: string, sourceKey: string, archived: boolean) {
    const link = text(group.link);
    const normalizedLink = normalizeLink(link) || `missing:${sourceKey}`;
    const id = stableId('chat', `${userId}:${platform}:${normalizedLink}`);
    const profile = isRecord(group.contentProfile)
      ? group.contentProfile
      : isRecord(group.groupData) && isRecord(group.groupData.contentProfile)
        ? group.groupData.contentProfile
        : null;
    const publicationDates = array(group.publicationDates);
    const createdAt = seconds(group.processedAt) || seconds(group.joinedAt) || seconds(group.archivedAt) || now;
    const updatedAt = Math.max(createdAt, seconds(group.lastPublicationAt) || 0, seconds(group.archivedAt) || 0);
    const groupKey = link ? normalizeLink(link) : `n:${Math.floor(Number(group.n) || 0)}`;
    const assignmentMap = group.status === '✅' || group.status === '⏳' ? assignments : candidateAssignments;
    const assignedLegacyId = platform === 'telegram'
      ? text(group.telegramAccountId)
        || text(assignmentMap[groupKey])
        || text(assignmentMap[groupKey.toLowerCase()])
      : '';
    const telegramAccountId = accountIdByLegacyId.get(assignedLegacyId) || null;
    chats.push({
      id, platform, name: text(group.name) || `Чат без назви`, link, normalizedLink,
      workflowStatus: archived ? 'archived' : workflowStatus(group.status),
      isPrivate: group.priv ? 1 : 0,
      joinedAt: seconds(group.joinedAt), processedAt: seconds(group.processedAt),
      snoozedUntil: seconds(group.approvalSnoozedUntil) || seconds(group.publicationSnoozedUntil),
      archiveReason: archived ? text(group.reason) || null : null,
      archivedAt: archived ? seconds(group.archivedAt) : null,
      note: text(group.note), legacyDate: text(group.date) || text(group.archivedDate) || null,
      payloadJson: JSON.stringify(group), createdAt, updatedAt: updatedAt || now,
      telegramAccountId, telegramAccountExplicit: telegramAccountId ? 1 : 0,
    });
    if (link) chatIdByLink.set(normalizeLink(link), id);
    if (profile) {
      profiles.push({
        chatId: id,
        language: profile.language === 'uk' || profile.language === 'ru' ? profile.language : null,
        cadence: text(profile.cadence) || 'any', weekdaysJson: JSON.stringify(array(profile.weekdays)),
        directionsJson: JSON.stringify(array(profile.directions)), note: text(profile.note),
        reviewStatus: profile.reviewStatus === 'confirmed' ? 'confirmed' : 'draft',
        source: text(profile.source) || 'legacy', updatedAt: seconds(profile.updatedAt) || updatedAt || now,
      });
    }
    publicationDates.forEach((date, index) => {
      const publishedOn = legacyDate(text(date));
      if (!publishedOn) return;
      const eventKey = `legacy:publication:${id}:${publishedOn}:${index}`;
      publications.push({
        id: stableId('pub', eventKey), chatId: id, publishedOn,
        publishedAt: index === publicationDates.length - 1 ? seconds(group.lastPublicationAt) : null,
        sourceKey: eventKey, createdAt: seconds(group.lastPublicationAt) || now,
      });
    });
  }

  const leads: MigrationLead[] = [];
  const students: MigrationStudent[] = [];
  const lessons: MigrationLesson[] = [];
  const curatorRequests: MigrationCuratorRequest[] = [];
  for (const [leadIndex, source] of parseArray(storage['shared-leads-v1']).entries()) {
    const legacyId = text(source.id) || `lead-${leadIndex}`;
    const id = stableId('lead', `${userId}:${legacyId}`);
    const sourceLink = text(source.sourceChatLink);
    const createdAt = seconds(source.createdAt) || now;
    const bookedAt = seconds(source.bookedAt);
    const responseDate = legacyDate(text(source.createdDate)) || dateForEpoch(createdAt);
    const bookingDate = legacyDate(text(source.bookedDate)) || (bookedAt ? dateForEpoch(bookedAt) : null);
    leads.push({
      id, legacyId, name: text(source.name) || 'Без імені', phone: text(source.phone),
      telegramUsername: text(source.telegramUsername), normalizedPhone: text(source.normalizedPhone),
      normalizedTelegram: text(source.normalizedTelegram), platform: text(source.platform) || 'unknown',
      subject: text(source.subject),
      sourceChatId: chatIdByLink.get(normalizeLink(sourceLink)) || null, sourceChatLink: sourceLink,
      note: text(source.note), needsDetails: source.needsDetails ? 1 : 0,
      status: text(source.status) || 'new', teacherName: text(source.teacherName),
      lessonPlatform: text(source.lessonPlatform) || null, meetingLink: text(source.meetingLink),
      isStudent: source.isStudent ? 1 : 0, ageGroup: text(source.ageGroup), responseDate, bookingDate,
      responseCancelledAt: seconds(source.responseCancelledAt), responseCancelledDate: legacyDate(text(source.responseCancelledDate)) || null,
      createdAt, bookedAt, archivedAt: seconds(source.archivedAt),
      payloadJson: JSON.stringify(source), updatedAt: Math.max(createdAt, seconds(source.bookedAt) || 0, seconds(source.archivedAt) || 0),
    });
    const studentIdByLegacy = new Map<string, string>();
    const lessonIdByLegacy = new Map<string, string>();
    array(source.students).filter(isRecord).forEach((student, index) => {
      const studentLegacyId = text(student.id) || `student-${index}`;
      const studentId = stableId('student', `${id}:${studentLegacyId}`);
      studentIdByLegacy.set(studentLegacyId, studentId);
      students.push({
        id: studentId, leadId: id, legacyId: studentLegacyId, name: text(student.name) || 'Без імені',
        surname: text(student.surname), ageGroup: text(student.ageGroup), note: text(student.note),
        createdAt, updatedAt: createdAt,
      });
    });
    array(source.lessons).filter(isRecord).forEach((lesson, index) => {
      const lessonLegacyId = text(lesson.id) || `lesson-${index}`;
      const lessonId = stableId('lesson', `${userId}:${lessonLegacyId}`);
      lessonIdByLegacy.set(lessonLegacyId, lessonId);
      const legacyStudentId = text(lesson.studentId);
      const lessonCreatedAt = seconds(lesson.createdAt) || createdAt;
      const lessonBookingDate = legacyDate(text(lesson.bookingAccountingDate))
        || legacyDate(text(lesson.createdDate))
        || bookingDate
        || dateForEpoch(lessonCreatedAt);
      lessons.push({
        id: lessonId, leadId: id,
        studentId: legacyStudentId && legacyStudentId !== 'lead' ? studentIdByLegacy.get(legacyStudentId) || null : null,
        legacyId: lessonLegacyId, studentName: text(lesson.studentName) || text(source.name) || 'Без імені',
        subject: text(lesson.subject) || 'Не вказано', teacherName: text(lesson.teacherName),
        lessonDate: text(lesson.lessonDate), lessonTime: text(lesson.lessonTime),
        lessonPlatform: text(lesson.lessonPlatform) || null, meetingLink: text(lesson.meetingLink),
        status: text(lesson.status) || 'scheduled', bookingDate: lessonBookingDate,
        createdAt: lessonCreatedAt, updatedAt: seconds(lesson.updatedAt) || lessonCreatedAt,
      });
    });
    array(source.curatorRequests).filter(isRecord).forEach((request, index) => {
      const requestLegacyId = text(request.id) || `curator-${index}`;
      const submittedAt = seconds(request.submittedAt) || createdAt;
      const submittedDate = legacyDate(text(request.submittedDate)) || dateForEpoch(submittedAt);
      const requestStatus = ['pending', 'confirmed', 'cancelled'].includes(text(request.status))
        ? text(request.status)
        : 'cancelled';
      const resolvedAt = seconds(request.resolvedAt);
      const linkedLessonId = lessonIdByLegacy.get(text(request.lessonId)) || null;
      curatorRequests.push({
        id: stableId('curator', `${userId}:${requestLegacyId}`), leadId: id,
        legacyId: requestLegacyId, status: requestStatus, submittedAt, submittedDate,
        resolvedAt, lessonId: linkedLessonId, createdAt: submittedAt,
        updatedAt: resolvedAt || submittedAt,
      });
    });
  }

  const reports: MigrationReport[] = [];
  const reportHistory = parseStored(storage['daily-report-history-v1']);
  const reportRecord: Record<string, unknown> = Array.isArray(reportHistory)
    ? Object.fromEntries(
        reportHistory
          .filter(isRecord)
          .map((entry, index) => [text(entry.date) || `legacy-${index}`, entry]),
      )
    : isRecord(reportHistory) ? { ...reportHistory } : {};
  const legacySubmission = parseRecord(storage['daily-report-submission-v1']);
  const legacySubmissionDate = text(legacySubmission.date);
  if (legacySubmissionDate && text(legacySubmission.reportText) && !reportRecord[legacySubmissionDate]) {
    reportRecord[legacySubmissionDate] = legacySubmission;
  }
  for (const [dateKey, value] of Object.entries(reportRecord)) {
    if (!isRecord(value)) continue;
    const reportDate = legacyDate(text(value.date) || dateKey) || dateKey;
    reports.push({
      id: stableId('report', `${userId}:${reportDate}`), reportDate,
      reportText: text(value.reportText), payloadJson: JSON.stringify(value),
      submittedAt: seconds(value.submittedAt), updatedAt: seconds(value.updatedAt) || now,
    });
  }

  const settings: MigrationSetting[] = Object.entries(storage)
    .filter(([key]) => !DOMAIN_KEYS.has(key))
    .map(([key, value]) => ({ key, valueJson: JSON.stringify({ legacyStorageValue: value }), updatedAt: now }));
  const settingKeys = new Set(settings.map((setting) => setting.key));
  const addSetting = (key: string, value: unknown, updatedAt = now) => {
    if (settingKeys.has(key)) return;
    settingKeys.add(key);
    settings.push({ key, valueJson: JSON.stringify(value), updatedAt });
  };

  if (typeof storage['content-direction-focus-v1'] === 'string') {
    const focus = parseRecord(storage['content-direction-focus-v1']);
    const disabled = new Set(canonicalDirections(
      array(focus.disabled).filter((value): value is string => typeof value === 'string'),
    ));
    addSetting(
      'focus_directions',
      FOCUS_DIRECTIONS.filter((direction) => !disabled.has(direction)),
      seconds(focus.updatedAt) || now,
    );
  }
  const operationalGoals = legacyOperationalBookingGoals(storage, now);
  if (operationalGoals.daily !== null) addSetting('daily_booking_goal', operationalGoals.daily);
  if (operationalGoals.monthly !== null) addSetting('monthly_booking_goal', operationalGoals.monthly);

  const chatPlatform = new Map(chats.map((chat) => [chat.id, chat.platform]));
  const chatAccount = new Map(chats.map((chat) => [chat.id, chat.telegramAccountId]));
  const leadById = new Map(leads.map((lead) => [lead.id, lead]));
  const events: MigrationEvent[] = [];
  for (const chat of chats) {
    if (!chat.joinedAt) continue;
    const sourceKey = `legacy:chat-joined:${chat.id}`;
    events.push({
      id: stableId('event', sourceKey), eventType: 'chat_joined', platform: chat.platform,
      chatId: chat.id, leadId: null, lessonId: null, occurredAt: chat.joinedAt,
      eventDate: dateForEpoch(chat.joinedAt), metadataJson: '{}', sourceKey,
      cancelledAt: null, telegramAccountId: chat.telegramAccountId,
    });
  }
  for (const publication of publications) {
    events.push({
      id: stableId('event', publication.sourceKey), eventType: 'publication',
      platform: chatPlatform.get(publication.chatId) || null, chatId: publication.chatId,
      leadId: null, lessonId: null, occurredAt: publication.publishedAt || epochForDate(publication.publishedOn) || now,
      eventDate: publication.publishedOn, metadataJson: '{}', sourceKey: publication.sourceKey,
      cancelledAt: null, telegramAccountId: chatAccount.get(publication.chatId) || null,
    });
  }
  for (const lead of leads) {
    const sourceKey = `legacy:lead:${lead.legacyId}`;
    const telegramAccountId = lead.sourceChatId ? chatAccount.get(lead.sourceChatId) || null : null;
    events.push({
      id: stableId('event', sourceKey), eventType: 'lead_created', platform: lead.platform,
      chatId: lead.sourceChatId, leadId: lead.id, lessonId: null, occurredAt: lead.createdAt,
      eventDate: lead.responseDate, metadataJson: JSON.stringify({ responseDate: lead.responseDate }), sourceKey,
      cancelledAt: lead.responseCancelledAt, telegramAccountId,
    });
  }
  for (const lesson of lessons) {
    const lead = leadById.get(lesson.leadId);
    const telegramAccountId = lead?.sourceChatId ? chatAccount.get(lead.sourceChatId) || null : null;
    const sourceKey = `legacy:lesson:${lesson.legacyId}`;
    events.push({
      id: stableId('event', sourceKey), eventType: 'lesson_booked', platform: lead?.platform || null,
      chatId: lead?.sourceChatId || null, leadId: lesson.leadId, lessonId: lesson.id, occurredAt: lesson.createdAt,
      eventDate: lesson.bookingDate,
      metadataJson: JSON.stringify({ bookingDate: lesson.bookingDate, lessonDate: lesson.lessonDate }), sourceKey,
      cancelledAt: null, telegramAccountId,
    });
  }

  for (const request of curatorRequests) {
    const lead = leadById.get(request.leadId);
    const telegramAccountId = lead?.sourceChatId ? chatAccount.get(lead.sourceChatId) || null : null;
    const sourceKey = `legacy:curator-request:${request.legacyId}`;
    const cancelledAt = request.status === 'pending' ? null : request.resolvedAt ?? request.updatedAt;
    events.push({
      id: stableId('event', sourceKey), eventType: 'curator_booking_pending',
      platform: lead?.platform || null, chatId: lead?.sourceChatId || null,
      leadId: request.leadId, lessonId: null, occurredAt: request.submittedAt,
      eventDate: request.submittedDate,
      metadataJson: JSON.stringify({ curatorRequestId: request.id, status: request.status }), sourceKey,
      cancelledAt, telegramAccountId,
    });
  }

  return { accounts, chats, profiles, publications, leads, students, lessons, curatorRequests, reports, settings, events };

  function addAccountSeed(value: JsonRecord) {
    const rawId = text(value.id);
    const idMatch = /^tg(\d+)$/i.exec(rawId);
    const number = Math.max(1, Math.floor(Number(value.number) || Number(idMatch?.[1]) || 0));
    if (!rawId || !number) return;
    accountSeeds.set(rawId, { number, name: text(value.name) || `TG ${number}` });
  }
}

export function migrationTotals(dataset: LegacyMigrationDataset): Record<MigrationPhase, number> {
  return Object.fromEntries(MIGRATION_PHASES.map((phase) => [phase, dataset[phase].length])) as Record<MigrationPhase, number>;
}

function legacyOperationalBookingGoals(
  storage: Record<string, string>,
  now: number,
): { daily: number | null; monthly: number | null } {
  const date = kyivDateForEpoch(now);
  const schedule = parseRecord(storage['analytics-daily-goal-schedule-v1']);
  const analytics = parseRecord(storage['analytics-goals-v1']);

  let daily: number | null = null;
  const overrides = isRecord(schedule.overrides) ? schedule.overrides : {};
  const override = overrides[date] ?? overrides[legacyShortDate(date)];
  daily = bookingGoal(isRecord(override) && 'goal' in override ? override.goal : override);

  if (daily === null) {
    const periods = array(schedule.periods)
      .filter(isRecord)
      .filter((period) => {
        const start = legacyDate(text(period.start));
        const end = legacyDate(text(period.end));
        return Boolean(start && end && start <= date && date <= end);
      })
      .sort((left, right) => {
        const updated = Number(left.updatedAt || 0) - Number(right.updatedAt || 0);
        return updated || text(left.id).localeCompare(text(right.id));
      });
    daily = bookingGoal(periods.at(-1)?.goal);
  }
  if (daily === null) daily = bookingGoal(schedule.defaultGoal);

  const dailyHistory = isRecord(analytics.daily) ? analytics.daily : {};
  if (daily === null) {
    const latest = Object.entries(dailyHistory)
      .map(([key, value]) => [legacyDate(key), value] as const)
      .filter((entry): entry is readonly [string, unknown] => Boolean(entry[0] && entry[0] <= date))
      .sort(([left], [right]) => left.localeCompare(right))
      .at(-1);
    daily = bookingGoal(latest?.[1]);
  }

  const monthlyGoals = isRecord(analytics.monthly) ? analytics.monthly : {};
  const month = date.slice(0, 7);
  let monthly = bookingGoal(monthlyGoals[month]);
  if (monthly === null) {
    const latest = Object.entries(monthlyGoals)
      .filter(([key]) => /^\d{4}-\d{2}$/.test(key) && key <= month)
      .sort(([left], [right]) => left.localeCompare(right))
      .at(-1);
    monthly = bookingGoal(latest?.[1]);
  }
  return { daily, monthly };
}

function bookingGoal(value: unknown): number | null {
  if (!isRecord(value)) return null;
  const parsed = Number(value.records);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100000) return null;
  return Math.round(parsed);
}

function kyivDateForEpoch(epochSeconds: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(epochSeconds * 1000));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function legacyShortDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}.${match[2]}.${match[1].slice(-2)}` : value;
}

function parseStored(value: string | undefined): unknown {
  if (typeof value !== 'string') return null;
  try { return JSON.parse(value) as unknown; }
  catch { return null; }
}
function parseArray(value: string | undefined): JsonRecord[] {
  const parsed = parseStored(value);
  return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
}
function parseRecord(value: string | undefined): JsonRecord {
  const parsed = parseStored(value);
  return isRecord(parsed) ? parsed : {};
}
function isRecord(value: unknown): value is JsonRecord { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function seconds(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return number > 10_000_000_000 ? Math.floor(number / 1000) : Math.floor(number);
}
function workflowStatus(value: unknown): string {
  if (value === '✅') return 'ready';
  if (value === '⏳') return 'waiting';
  if (value === '❌') return 'failed';
  return 'to_join';
}
function normalizeLink(value: string): string {
  if (!value) return '';
  try {
    const url = new URL(value);
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    url.hash = '';
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString();
  } catch { return value.replace(/\/+$/, ''); }
}
function legacyDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const match = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(value);
  if (!match) return '';
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
}
function epochForDate(value: string): number | null {
  const parsed = Date.parse(`${value}T12:00:00Z`);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}
function dateForEpoch(value: number): string { return new Date(value * 1000).toISOString().slice(0, 10); }
function stableId(prefix: string, value: string): string {
  return `${prefix}_${hash53(value, 0).toString(36)}${hash53(value, 1).toString(36)}`;
}
function hash53(value: string, seed: number): number {
  let first = 0xdeadbeef ^ seed;
  let second = 0x41c6ce57 ^ seed;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 2654435761);
    second = Math.imul(second ^ code, 1597334677);
  }
  first = Math.imul(first ^ (first >>> 16), 2246822507) ^ Math.imul(second ^ (second >>> 13), 3266489909);
  second = Math.imul(second ^ (second >>> 16), 2246822507) ^ Math.imul(first ^ (first >>> 13), 3266489909);
  return 4294967296 * (2097151 & second) + (first >>> 0);
}
