import type { Lead, Student, Lesson } from '../domain/types.ts';
import * as v from '../domain/validation.ts';
import { businessDate, lessonEpoch } from '../domain/time.ts';
export function leadFields(
  input: Record<string, unknown>,
  current: Lead | null,
  now: number,
) {
  v.only(input, [
    'name',
    'phone',
    'telegramUsername',
    'platform',
    'sourceChatLink',
    'subject',
    'note',
    'responseDate',
    'responseAt',
    'status',
    'qualification',
    'familyQualification',
    'duplicateState',
    'funnelStage',
    'nextAction',
    'nextContactAt',
  ]);
  const merged = {
    name: '',
    phone: '',
    telegramUsername: '',
    platform: 'telegram',
    sourceChatLink: '',
    subject: '',
    note: '',
    responseDate: businessDate(now),
    responseAt: null,
    status: 'new',
    qualification: null,
    familyQualification: null,
    duplicateState: 'none',
    funnelStage: 'response',
    nextAction: '',
    nextContactAt: null,
    ...current,
    ...input,
  };
  const result = {
    name: v.string(merged.name, 'Ім’я', 200, true),
    phone:
      current && (!('phone' in input) || input.phone === current.phone)
        ? current.phone
        : v.phone(merged.phone),
    telegramUsername:
      current &&
      (!('telegramUsername' in input) ||
        input.telegramUsername === current.telegramUsername)
        ? current.telegramUsername
        : v.telegram(merged.telegramUsername),
    platform:
      current && (!('platform' in input) || input.platform === current.platform)
        ? current.platform
        : v.choice(merged.platform, v.PLATFORMS, 'Платформа'),
    sourceChatLink:
      current &&
      (!('sourceChatLink' in input) ||
        input.sourceChatLink === current.sourceChatLink)
        ? current.sourceChatLink
        : v.url(merged.sourceChatLink, 'Джерело'),
    subject: v.string(
      merged.subject,
      'Предмет',
      200,
      !current || 'subject' in input,
    ),
    note: v.string(merged.note, 'Нотатка', 20000),
    responseDate:
      merged.responseDate === null &&
      current?.responseDate === null &&
      !('responseDate' in input)
        ? null
        : v.date(merged.responseDate, 'Дата відгуку'),
    responseAt: v.nullableEpoch(merged.responseAt, 'Час відгуку'),
    status:
      current && (!('status' in input) || input.status === current.status)
        ? current.status
        : v.choice(merged.status, v.LEAD_STATUSES, 'Статус'),
    qualification:
      merged.qualification === null
        ? null
        : v.choice(merged.qualification, ['A', 'B', 'C'], 'Кваліфікація ліда'),
    familyQualification:
      merged.familyQualification === null
        ? null
        : v.choice(
            merged.familyQualification,
            ['A', 'B', 'C'],
            'Кваліфікація родини',
          ),
    duplicateState: v.choice(
      merged.duplicateState,
      ['none', 'possible', 'confirmed'],
      'Дублікат',
    ),
    funnelStage: v.choice(merged.funnelStage, v.FUNNEL_STAGES, 'Воронка'),
    nextAction: v.string(merged.nextAction, 'Наступна дія', 1000),
    nextContactAt: v.nullableEpoch(merged.nextContactAt, 'Наступний контакт'),
  };
  if (result.nextContactAt !== null && !result.nextAction)
    throw new v.LeadError('Додайте наступну дію або приберіть дату контакту.');
  if (
    result.responseAt !== null &&
    (result.responseAt > now ||
      businessDate(result.responseAt) !== result.responseDate)
  )
    throw new v.LeadError(
      'Час відгуку має відповідати даті відгуку й не бути в майбутньому.',
    );
  if (
    current?.firstReplyAt !== null &&
    current?.firstReplyAt !== undefined &&
    (result.responseAt === null || result.responseAt > current.firstReplyAt)
  )
    throw new v.LeadError('Відгук не може бути пізніше першої відповіді.');
  return {
    ...result,
    normalizedPhone: v.normalizePhone(result.phone),
    normalizedTelegram: v.normalizeTelegram(result.telegramUsername),
  };
}
export function studentFields(
  input: Record<string, unknown>,
  current?: Student,
) {
  v.only(input, ['name', 'grade', 'ageGroup', 'note']);
  const m = {
    name: '',
    grade: null,
    ageGroup: '',
    note: '',
    ...current,
    ...input,
  };
  const result = {
    name: v.string(m.name, 'Ім’я учня', 200, true),
    grade: v.grade(m.grade),
    ageGroup: v.string(m.ageGroup, 'Вікова категорія', 100),
    note: v.string(m.note, 'Примітка', 5000),
  };
  if (result.grade !== null && result.ageGroup)
    throw new v.LeadError('Оберіть клас або вікову категорію.');
  return result;
}
export function lessonFields(
  input: Record<string, unknown>,
  current: Lesson | undefined,
  now: number,
) {
  v.only(input, [
    'subject',
    'studentId',
    'teacherName',
    'lessonDate',
    'lessonTime',
    'lessonPlatform',
    'meetingLink',
    'bookingDate',
  ]);
  const m = {
    subject: '',
    studentId: null,
    teacherName: '',
    lessonDate: '',
    lessonTime: '',
    lessonPlatform: '',
    meetingLink: '',
    bookingDate: businessDate(now),
    ...current,
    ...input,
  };
  const result = {
    subject: v.string(m.subject, 'Предмет', 200, true),
    studentId:
      m.studentId === null ? null : v.string(m.studentId, 'Учень', 200, true),
    teacherName: v.string(m.teacherName, 'Викладач', 200),
    lessonDate: v.date(m.lessonDate, 'Дата уроку'),
    lessonTime: v.string(m.lessonTime, 'Час уроку', 5),
    lessonPlatform:
      m.lessonPlatform === null
        ? null
        : v.string(m.lessonPlatform, 'Платформа зустрічі', 100),
    meetingLink: v.url(m.meetingLink, 'Meeting URL'),
    bookingDate:
      current?.bookingDate === null && !('bookingDate' in input)
        ? null
        : v.date(m.bookingDate, 'Дата запису'),
  };
  if (
    result.lessonTime &&
    (!/^([01]\d|2[0-3]):[0-5]\d$/.test(result.lessonTime) ||
      lessonEpoch(result.lessonDate, result.lessonTime) === null)
  )
    throw new v.LeadError('Невірний або неоднозначний час уроку за Києвом.');
  return result;
}
