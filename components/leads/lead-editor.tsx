'use client';
import { useState } from 'react';
import type { LeadDetail } from '@/lib/leads/application/queries';
import { PLATFORMS, LEAD_STATUSES } from '@/lib/leads/domain/validation';
import { businessDate } from '@/lib/leads/domain/time';
import { SUBJECT_OPTIONS } from '@/lib/subjects';
import {
  EditDialog,
  Field,
  NoteField,
  SaveForm,
  SelectField,
  textValue,
  epochValue,
  datetimeValue,
} from './form';
export function LeadEditor({
  lead,
  defaultResponseDate,
  save,
  close,
}: {
  lead?: LeadDetail['lead'];
  defaultResponseDate?: string;
  save: (data: Record<string, unknown>) => Promise<void>;
  close: () => void;
}) {
  const [now] = useState(() => Math.floor(Date.now() / 1000));
  return (
    <EditDialog
      title={lead ? 'Редагувати ліда' : 'Новий лід'}
      close={close}
      description="Один контакт може мати кількох учнів і багато уроків."
    >
      <SaveForm
        cancel={close}
        save={async (f) => {
          await save({
            name: textValue(f, 'name'),
            platform: textValue(f, 'platform'),
            phone: textValue(f, 'phone'),
            telegramUsername: textValue(f, 'telegramUsername'),
            sourceChatLink: textValue(f, 'sourceChatLink'),
            subject: textValue(f, 'subject'),
            note: textValue(f, 'note'),
            ...(lead?.responseDate === null && !textValue(f, 'responseDate')
              ? {}
              : { responseDate: textValue(f, 'responseDate') }),
            responseAt: epochValue(f, 'responseAt', lead?.responseAt),
            status: textValue(f, 'status'),
            duplicateState: textValue(f, 'duplicateState'),
            isStudent: textValue(f, 'isStudent') === '1' ? 1 : 0,
          });
          close();
        }}
      >
        <Field label="Ім’я *" name="name" value={lead?.name} required />
        <SelectField
          label="Платформа"
          name="platform"
          value={lead?.platform ?? 'telegram'}
          options={
            lead &&
            !PLATFORMS.includes(lead.platform as (typeof PLATFORMS)[number])
              ? [...PLATFORMS, lead.platform]
              : PLATFORMS
          }
        />
        <Field label="Телефон" name="phone" type="tel" value={lead?.phone} />
        <Field
          label="Telegram username"
          name="telegramUsername"
          value={lead?.telegramUsername}
        />
        <Field
          label="Джерело / посилання на чат"
          name="sourceChatLink"
          type="url"
          value={lead?.sourceChatLink}
        />
        <Field
          label="Предмет *"
          name="subject"
          value={lead?.subject}
          required
          suggestions={SUBJECT_OPTIONS}
        />
        <Field
          label="Дата відгуку *"
          name="responseDate"
          type="date"
          value={lead ? (lead.responseDate ?? '') : (defaultResponseDate ?? businessDate(now))}
          required={!lead || lead.responseDate !== null}
        />
        <Field
          label="Час відгуку (Київ, якщо відомий)"
          name="responseAt"
          type="datetime-local"
          value={datetimeValue(lead?.responseAt)}
        />
        <SelectField
          label="Статус"
          name="status"
          value={lead?.status ?? 'new'}
          options={
            lead &&
            !LEAD_STATUSES.includes(
              lead.status as (typeof LEAD_STATUSES)[number],
            )
              ? [...LEAD_STATUSES, lead.status]
              : LEAD_STATUSES
          }
        />
        <SelectField
          label="Контакт навчається"
          name="isStudent"
          value={String(lead?.isStudent ?? 1)}
          options={[{ value: '1', label: 'Так' }, { value: '0', label: 'Ні, навчається лише доданий учень' }]}
        />
        <SelectField
          label="Дублікат контакту"
          name="duplicateState"
          value={lead?.duplicateState ?? 'none'}
          options={['none', 'possible', 'confirmed']}
        />
        <NoteField label="Нотатка" name="note" value={lead?.note} />
      </SaveForm>
    </EditDialog>
  );
}
