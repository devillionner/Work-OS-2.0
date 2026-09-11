import { applyLessonAction } from './lesson-actions.ts';
import { applyReminderAction } from './reminder-actions.ts';
import type {
  Changes,
  Lead,
  LeadRepository,
  Receipt,
} from '../domain/types.ts';
import * as v from '../domain/validation.ts';
import { businessDate } from '../domain/time.ts';

import { leadFields, studentFields } from './inputs.ts';

export async function executeLeadCommand(
  repo: LeadRepository,
  userId: string,
  raw: unknown,
  now = Math.floor(Date.now() / 1000),
): Promise<string> {
  const command = v.record(raw);
  v.only(command, [
    'commandId',
    'leadId',
    'version',
    'action',
    'entityId',
    'data',
  ]);
  const commandId = v.string(command.commandId, 'ID запиту', 100, true);
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(commandId))
    throw new v.LeadError('Некоректний ID запиту.');
  const requestJson = v.canonicalJson(command);
  const previous = await repo.receipt(userId, commandId);
  if (previous) {
    if (previous.requestJson !== requestJson)
      throw new v.LeadError('ID запиту вже використано для іншої дії.', 409);
    return previous.leadId;
  }
  const action = v.choice(
    command.action,
    [
      'create',
      'update',
      'archive',
      'restore',
      'first_reply',
      'curator_submit',
      'curator_cancel',
      'student_create',
      'student_update',
      'lesson_book',
      'lesson_update',
      'lesson_status',
      'lesson_reschedule',
      'reminder_update',
      'reminder_mark',
      'message_create',
      'message_update',
      'message_delete',
    ],
    'Дія',
  );
  const data = v.record(command.data ?? {});
  const id =
    action === 'create'
      ? crypto.randomUUID()
      : v.string(command.leadId, 'Лід', 200, true);
  const commandMessageId =
    action === 'message_update' || action === 'message_delete'
      ? v.string(command.entityId, 'ID повідомлення', 200, true)
      : undefined;
  const aggregate =
    action === 'create'
      ? null
      : await repo.load(
          userId,
          id,
          commandMessageId ? { messageId: commandMessageId } : { messageLimit: 0 },
        );
  if (action !== 'create' && !aggregate)
    throw new v.LeadError('Ліда не знайдено.', 404);
  const version = v.integer(command.version, 'Версія');
  if (version !== (aggregate?.lead.version ?? 0)) {
    const raced = await repo.receipt(userId, commandId);
    if (raced?.requestJson === requestJson) return raced.leadId;
    throw new v.LeadError('Запис уже змінено. Оновіть картку.', 409);
  }
  if (
    aggregate?.lead.archivedAt !== null &&
    aggregate?.lead.archivedAt !== undefined &&
    !['restore', 'archive'].includes(action)
  )
    throw new v.LeadError('Спочатку відновіть ліда з архіву.', 409);
  const lead: Lead = aggregate
    ? { ...aggregate.lead }
    : {
        id,
        userId,
        legacyId: null,
        ...leadFields(data, null, now),
        sourceChatId: null,
        needsDetails: 0,
        teacherName: '',
        lessonPlatform: null,
        meetingLink: '',
        isStudent: 0,
        ageGroup: '',
        bookingDate: null,
        bookedAt: null,
        firstReplyAt: null,
        responseCancelledAt: null,
        responseCancelledDate: null,
        archivedAt: null,
        legacyPayloadJson: null,
        sourceImportId: null,
        createdAt: now,
        updatedAt: now,
        managedAt: now,
        version: 0,
      };
  const changes: Changes = {
    lead,
    create: action === 'create',
    students: [],
    lessons: [],
    reminders: [],
    messages: [],
    events: [],
  };
  let source = await repo.source(userId, lead.sourceChatLink, lead.platform);
  const event = (
    type: string,
    eventDate = businessDate(now),
    lessonId: string | null = null,
    metadata: unknown = {},
  ) => {
    changes.events.push({
      id: crypto.randomUUID(),
      userId,
      leadId: id,
      lessonId,
      eventType: type,
      eventDate,
      occurredAt: now,
      platform: lead.platform,
      chatId: lead.sourceChatId,
      telegramAccountId: source?.telegramAccountId ?? null,
      metadataJson: JSON.stringify(metadata),
      sourceKey: `leads:${commandId}:${type}`,
      cancelledAt: null,
    });
  };
  if (action === 'create' || action === 'update') {
    if (action === 'update') Object.assign(lead, leadFields(data, lead, now));
    const contactsChanged =
      !aggregate ||
      lead.normalizedPhone !== v.normalizePhone(aggregate.lead.phone) ||
      lead.normalizedTelegram !==
        v.normalizeTelegram(aggregate.lead.telegramUsername);
    if (contactsChanged && lead.duplicateState === 'none') {
      const matches = (
        await repo.contacts(userId, {
          phone: lead.normalizedPhone,
          telegram: lead.normalizedTelegram,
        })
      ).filter(
        (c) =>
          c.id !== id &&
          ((lead.normalizedPhone &&
            lead.normalizedPhone === v.normalizePhone(c.phone)) ||
            (lead.normalizedTelegram &&
              lead.normalizedTelegram ===
                v.normalizeTelegram(c.telegramUsername))),
      );
      if (matches.length)
        throw new v.LeadError(
          'Знайдено збіг контакту. Відкрийте існуючого ліда або явно позначте можливий/підтверджений дублікат.',
          409,
          {
            duplicates: matches.map((c) => ({
              id: c.id,
              name: c.name,
              archived: c.archivedAt !== null,
            })),
          },
        );
    }
    if (
      action === 'update' &&
      lead.responseDate &&
      lead.responseDate !== aggregate!.lead.responseDate
    )
      changes.eventDateCorrections = [
        { type: 'lead_created', date: lead.responseDate },
      ];
    source = await repo.source(userId, lead.sourceChatLink, lead.platform);
    lead.sourceChatId = source?.id ?? null;
    event(
      action === 'create' ? 'lead_created' : 'lead_updated',
      action === 'create' ? lead.responseDate! : businessDate(now),
      null,
      action === 'create'
        ? { responseDate: lead.responseDate }
        : {
            fields: Object.keys(data),
            previousResponseDate: aggregate!.lead.responseDate,
            responseDate: lead.responseDate,
          },
    );
  } else if (action === 'archive' || action === 'restore') {
    v.only(data, []);
    if ((action === 'archive') !== (lead.archivedAt !== null)) {
      lead.archivedAt = action === 'archive' ? now : null;
      event(action === 'archive' ? 'lead_archived' : 'lead_restored');
    }
  } else if (action === 'first_reply') {
    v.only(data, ['at']);
    const at = v.integer(data.at, 'Перша відповідь', 0, now);
    if (lead.firstReplyAt !== null)
      throw new v.LeadError('Першу відповідь уже зафіксовано.', 409);
    if (lead.responseAt === null || at < lead.responseAt)
      throw new v.LeadError(
        'Спочатку вкажіть час відгуку; відповідь має бути після нього.',
      );
    lead.firstReplyAt = at;
    if (lead.funnelStage === 'response') lead.funnelStage = 'clarification';
    event('first_reply_recorded', businessDate(at), null, {
      firstReplyAt: at,
      responseAt: lead.responseAt,
    });
  } else if (action === 'curator_submit') {
    v.only(data, ['submittedDate']);
    if (aggregate!.curatorRequests.some((request) => request.status === 'pending'))
      throw new v.LeadError('Для цього ліда вже є активний запит куратору.', 409);
    const submittedDate = data.submittedDate === undefined
      ? businessDate(now)
      : v.date(data.submittedDate, 'Дата запиту');
    if (submittedDate > businessDate(now))
      throw new v.LeadError('Дата запиту не може бути в майбутньому.');
    const requestId = crypto.randomUUID();
    changes.createdCuratorRequest = {
      id: requestId,
      userId,
      leadId: id,
      legacyId: null,
      status: 'pending',
      submittedAt: now,
      submittedDate,
      resolvedAt: null,
      lessonId: null,
      createdAt: now,
      updatedAt: now,
      sourceImportId: null,
    };
    event('curator_booking_pending', submittedDate, null, {
      curatorRequestId: requestId,
      status: 'pending',
    });
  } else if (action === 'curator_cancel') {
    v.only(data, ['reason']);
    const request = aggregate!.curatorRequests.find(
      (r) => r.id === command.entityId && r.status === 'pending',
    );
    if (!request)
      throw new v.LeadError('Активний запит куратору не знайдено.', 409);
    const reason = v.string(data.reason, 'Причина скасування', 2000, true);
    changes.resolvedCuratorRequest = {
      id: request.id,
      lessonId: null,
      status: 'cancelled',
    };
    event('curator_request_cancelled', businessDate(now), null, {
      curatorRequestId: request.id,
      reason,
    });
  } else if (action.startsWith('student_')) {
    const current =
      action === 'student_update'
        ? aggregate!.students.find((s) => s.id === command.entityId)
        : undefined;
    if (action === 'student_update' && !current)
      throw new v.LeadError('Учня не знайдено.', 404);
    changes.students.push({
      id: current?.id ?? crypto.randomUUID(),
      userId,
      leadId: id,
      legacyId: current?.legacyId ?? null,
      surname: current?.surname ?? '',
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
      ...studentFields(data, current),
    });
  } else if (action.startsWith('lesson_')) {
    applyLessonAction({
      action,
      data,
      entityId: command.entityId,
      aggregate: aggregate!,
      changes,
      now,
      event,
    });
  } else if (action.startsWith('reminder_')) {
    applyReminderAction({
      action,
      data,
      entityId: command.entityId,
      aggregate: aggregate!,
      changes,
      now,
      event,
    });
  } else {
    const old =
      action === 'message_create'
        ? undefined
        : aggregate!.messages.find(
            (m) => m.id === commandMessageId && m.deletedAt === null,
          );
    if (action !== 'message_create' && !old)
      throw new v.LeadError('Повідомлення не знайдено.', 404);
    if (action === 'message_delete') {
      v.only(data, []);
      changes.messages.push({ ...old!, deletedAt: now, updatedAt: now });
    } else {
      v.only(data, ['sender', 'body', 'sentAt']);
      changes.messages.push({
        id: old?.id ?? crypto.randomUUID(),
        userId,
        leadId: id,
        sender: v.choice(data.sender, ['lead', 'me'], 'Автор'),
        body: v.string(data.body, 'Текст', 20000, true),
        sentAt: v.integer(data.sentAt, 'Час повідомлення', 0, now),
        createdAt: old?.createdAt ?? now,
        updatedAt: now,
        deletedAt: null,
      });
    }
  }
  lead.managedAt = now;
  lead.updatedAt = now;
  lead.version = version + 1;
  const receipt: Receipt = {
    id: commandId,
    userId,
    leadId: id,
    expectedVersion: version,
    requestJson,
    createdAt: now,
  };
  try {
    await repo.commit(changes, receipt);
  } catch (error) {
    // Another retry may have committed while this request was reading.
    const won = await repo.receipt(userId, commandId);
    if (won?.requestJson === requestJson) return won.leadId;
    throw error;
  }
  return id;
}
