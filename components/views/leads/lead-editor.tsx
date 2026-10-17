'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import type { LeadDetail } from '@/lib/leads/application/queries';
import { PLATFORMS, LEAD_STATUSES } from '@/lib/leads/domain/validation';
import { businessDate } from '@/lib/leads/domain/time';
import { SUBJECT_OPTIONS } from '@/lib/subjects';
import { Button } from '@/components/ui/button';
import { SearchSelect, type SearchOption } from '@/components/ui/combobox';
import { humanError } from '@/components/ui/human-error';
import { Select } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/toggle';
import { EditDialog, Field, NoteField, SaveForm, SelectField, textValue, epochValue, datetimeValue } from './form';
import { labels } from './client';
import { loadChatOptions, type ChatOptionRow } from './chat-options';

const NO_CHAT = '__none';
const STATUS_ORDER: Record<string, number> = { ready: 0, waiting: 1, to_join: 2, failed: 3, archived: 4 };
const STATUS_LABEL: Record<string, string> = { ready: 'приєднано', waiting: 'очікування', to_join: 'для приєднання', failed: 'не вдалося', archived: 'архів' };

/** Чати Work OS для поля: спершу вибрана платформа, потім приєднані, решта за станом і назвою. */
function chatOptions(rows: readonly ChatOptionRow[], platform: string, current: LeadDetail['sourceChat'] | undefined): SearchOption[] {
  const sorted = [...rows].sort((a, b) =>
    Number(b.platform === platform) - Number(a.platform === platform)
    || (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9)
    || a.name.localeCompare(b.name, 'uk'));
  const list: SearchOption[] = sorted.map((row) => ({
    value: row.id,
    label: row.name,
    hint: `${labels[row.platform] ?? row.platform} · ${STATUS_LABEL[row.status] ?? row.status}`,
    keywords: row.link,
  }));
  // Чат, збережений у ліді, видно, навіть якщо кеш списку старіший за нього.
  if (current && !list.some((option) => option.value === current.id)) list.unshift({ value: current.id, label: current.name, hint: labels[current.platform] ?? current.platform, keywords: current.link });
  return [{ value: NO_CHAT, label: 'Без чату у Work OS' }, ...list];
}

/** Новий лід або редагування контакту. */
export function LeadEditor({ lead, sourceChat, defaultResponseDate, save, close }: {
  lead?: LeadDetail['lead'];
  sourceChat?: LeadDetail['sourceChat'];
  defaultResponseDate?: string;
  save: (data: Record<string, unknown>) => Promise<void>;
  close: () => void;
}) {
  const [now] = useState(() => Math.floor(Date.now() / 1000));
  const chatFieldId = useId();
  const [platform, setPlatform] = useState(lead?.platform ?? 'telegram');
  const [chatId, setChatId] = useState<string | null>(lead?.sourceChatId ?? null);
  // Посилання вручну — лише коли чату немає в Work OS: показується в старих лідах із посиланням без чату.
  const [manual, setManual] = useState(Boolean(lead && !lead.sourceChatId && lead.sourceChatLink));
  const [contactUnknown, setContactUnknown] = useState(lead?.contactUnknown === 1);
  const [rows, setRows] = useState<ChatOptionRow[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    loadChatOptions(attempt > 0).then((chats) => { if (alive) { setRows(chats); setLoadError(''); } })
      .catch((reason: unknown) => { if (alive) setLoadError(humanError(reason, 'Не вдалося завантажити список чатів.')); });
    return () => { alive = false; };
  }, [attempt]);
  const options = useMemo(() => chatOptions(rows ?? [], platform, sourceChat), [rows, platform, sourceChat]);
  const platforms: readonly string[] = lead && !PLATFORMS.includes(lead.platform as (typeof PLATFORMS)[number]) ? [...PLATFORMS, lead.platform] : PLATFORMS;

  const choose = (value: string | null) => {
    const id = value && value !== NO_CHAT ? value : null;
    setChatId(id);
    const chat = rows?.find((row) => row.id === id);
    if (chat && PLATFORMS.includes(chat.platform as (typeof PLATFORMS)[number])) setPlatform(chat.platform);
  };

  return (
    <EditDialog title={lead ? 'Редагувати ліда' : 'Новий лід'} close={close} description="Один контакт може мати кількох учнів і багато уроків.">
      <SaveForm
        cancel={close}
        save={async (f) => {
          // Стан вибору читається з прихованих полів: SaveForm тримає функцію збереження з першого рендеру, замикання застаріло б.
          await save({
            name: textValue(f, 'name'),
            platform: textValue(f, 'platform'),
            phone: textValue(f, 'phone'),
            telegramUsername: textValue(f, 'telegramUsername'),
            contactUnknown: textValue(f, 'contactUnknown') === '1' ? 1 : 0,
            // Вибраний чат зв'язується за id; посилання вручну — лише коли чату немає в Work OS (тоді id визначається за посиланням).
            ...(textValue(f, 'manual') === '1' ? { sourceChatLink: textValue(f, 'sourceChatLink') } : { sourceChatId: textValue(f, 'sourceChatId') || null }),
            subject: textValue(f, 'subject'),
            note: textValue(f, 'note'),
            ...(lead?.responseDate === null && !textValue(f, 'responseDate') ? {} : { responseDate: textValue(f, 'responseDate') }),
            responseAt: epochValue(f, 'responseAt', lead?.responseAt),
            status: textValue(f, 'status'),
            duplicateState: textValue(f, 'duplicateState'),
            isStudent: textValue(f, 'isStudent') === '1' ? 1 : 0,
          });
          close();
        }}
      >
        <input type="hidden" name="platform" value={platform} />
        <input type="hidden" name="sourceChatId" value={chatId ?? ''} />
        <input type="hidden" name="manual" value={manual ? '1' : '0'} />
        <input type="hidden" name="contactUnknown" value={contactUnknown ? '1' : '0'} />
        <Field label="Ім’я *" name="name" value={lead?.name} required />
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={`${chatFieldId}-platform`} className="text-xs font-medium text-ink-2">Платформа</label>
          <Select id={`${chatFieldId}-platform`} value={platform} onChange={(event) => setPlatform(event.target.value)}>
            {platforms.map((item) => <option key={item} value={item}>{labels[item] ?? item}</option>)}
          </Select>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor={chatFieldId} className="text-xs font-medium text-ink-2">Чат-джерело</label>
            <Button type="button" variant="ghost" size="sm" onClick={() => setManual((value) => !value)}>{manual ? 'Вибрати зі списку' : 'Посилання вручну'}</Button>
          </div>
          {manual ? (
            <Field label="Посилання на чат" name="sourceChatLink" type="url" value={lead?.sourceChatLink} />
          ) : (
            <SearchSelect
              id={chatFieldId}
              options={options}
              value={chatId ?? NO_CHAT}
              onChange={choose}
              placeholder={rows ? 'Вибрати чат' : 'Завантажуємо чати…'}
              searchPlaceholder="Назва чату або посилання"
              emptyText="Чатів за цим запитом немає. Додай посилання вручну."
              disabled={!rows && !sourceChat}
            />
          )}
          {!manual && loadError ? (
            <p role="alert" className="m-0 flex items-center gap-2 text-[13px] text-hot">{loadError}<Button type="button" variant="ghost" size="sm" onClick={() => setAttempt((value) => value + 1)}>Спробувати ще раз</Button></p>
          ) : null}
        </div>
        <Field label="Телефон" name="phone" type="tel" value={lead?.phone} />
        <Field label="Telegram username" name="telegramUsername" value={lead?.telegramUsername} />
        <label className="flex min-h-9 cursor-pointer items-center gap-2.5 text-sm [@media(pointer:coarse)]:min-h-11">
          <Checkbox checked={contactUnknown} onCheckedChange={(checked) => setContactUnknown(checked === true)} aria-label="Контакт невідомий" />
          Контакт невідомий: номера чи Telegram ще немає
        </label>
        <Field label="Предмет *" name="subject" value={lead?.subject} required suggestions={SUBJECT_OPTIONS} />
        <Field label="Дата відгуку *" name="responseDate" type="date" value={lead ? (lead.responseDate ?? '') : (defaultResponseDate ?? businessDate(now))} required={!lead || lead.responseDate !== null} />
        <Field label="Час відгуку (Київ, якщо відомий)" name="responseAt" type="datetime-local" value={datetimeValue(lead?.responseAt)} />
        <SelectField label="Статус" name="status" value={lead?.status ?? 'new'} options={lead && !LEAD_STATUSES.includes(lead.status as (typeof LEAD_STATUSES)[number]) ? [...LEAD_STATUSES, lead.status] : LEAD_STATUSES} />
        <SelectField label="Контакт навчається" name="isStudent" value={String(lead?.isStudent ?? 1)} options={[{ value: '1', label: 'Так' }, { value: '0', label: 'Ні, навчається лише доданий учень' }]} />
        <SelectField label="Дублікат контакту" name="duplicateState" value={lead?.duplicateState ?? 'none'} options={['none', 'possible', 'confirmed']} />
        <NoteField label="Нотатка" name="note" value={lead?.note} />
      </SaveForm>
    </EditDialog>
  );
}
