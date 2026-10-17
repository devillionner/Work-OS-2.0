'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useShell } from '@/components/shell/shell-context';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { useToast } from '@/components/ui/toast';
import { customReminderKey, useReminderActions } from '@/components/views/today/use-reminder-actions';
import { announceDataChange } from '@/lib/client-sync';
import { shiftBusinessDate } from '@/lib/business-time';
import type { LeadDetail } from '@/lib/leads/application/queries';
import type { CustomReminder } from '@/lib/leads/domain/custom-reminders';
import { businessDate, lessonEpoch } from '@/lib/leads/domain/time';
import { displayTime } from './client';
import { Confirmation, EditDialog, Field, SaveForm, datetimeValue, epochValue, textValue } from './form';

type When = '2h' | 'tomorrow' | 'custom';
const WHEN: ReadonlyArray<readonly [When, string]> = [['2h', 'Через 2 год'], ['tomorrow', 'Завтра о 10:00'], ['custom', 'Свій час']];

async function send(body: Record<string, unknown>) {
  const response = await fetch('/api/leads/reminders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(result.error || 'Не вдалося зберегти нагадування.');
}

/** Крок-форма всередині Inspector: текст і час (через 2 год, завтра о 10:00 або свій). */
function ReminderForm({ reminder, save, close }: { reminder?: CustomReminder; save: (text: string, at: number) => Promise<void>; close: () => void }) {
  const [when, setWhen] = useState<When>(reminder ? 'custom' : '2h');
  const [defaultAt] = useState(() => Math.floor(Date.now() / 1000) + 3600);
  return (
    <EditDialog title={reminder ? 'Змінити нагадування' : 'Нове нагадування'} close={close} description="З’явиться в «Сьогодні» у вибраний час.">
      <SaveForm
        cancel={close}
        save={async (f) => {
          // Вибір часу читається з прихованого поля: SaveForm тримає функцію збереження з першого рендеру.
          const choice = textValue(f, 'when');
          const now = Math.floor(Date.now() / 1000);
          let at: number | null;
          if (choice === '2h') at = now + 2 * 3600;
          else if (choice === 'tomorrow') at = lessonEpoch(shiftBusinessDate(businessDate(now), 1), '10:00');
          else at = epochValue(f, 'at', reminder?.at);
          if (at === null) throw new Error('Вкажіть час нагадування.');
          await save(textValue(f, 'text'), at);
          close();
        }}
      >
        <input type="hidden" name="when" value={when} />
        <Field label="Що нагадати *" name="text" value={reminder?.text} required />
        <fieldset className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0">
          <legend className="mb-1.5 p-0 text-xs font-medium text-ink-2">Коли</legend>
          <div className="flex flex-wrap gap-2">
            {WHEN.map(([key, label]) => <Chip key={key} pressed={when === key} onClick={() => setWhen(key)}>{label}</Chip>)}
          </div>
        </fieldset>
        {when === 'custom' ? <Field label="Час за Києвом *" name="at" type="datetime-local" value={datetimeValue(reminder?.at ?? defaultAt)} required /> : null}
      </SaveForm>
    </EditDialog>
  );
}

/**
 * Свої нагадування ліда: текст і час. «Готово» — та сама дія, що у шкалі «Сьогодні» (`useReminderActions`): нагадування одразу
 * зникає в обох місцях, 8 с його можна скасувати з будь-якого. Змінювати й видаляти можна тут.
 */
export function CustomReminders({ detail, reload }: { detail: LeadDetail; reload: () => void }) {
  const leadId = detail.lead.id;
  const archived = detail.lead.archivedAt !== null;
  const { refreshSnapshot } = useShell();
  const toast = useToast();
  const actions = useReminderActions();
  const [editor, setEditor] = useState<{ reminder?: CustomReminder } | null>(null);
  const [removing, setRemoving] = useState<CustomReminder | null>(null);
  const open = detail.customReminders.filter((item) => item.doneAt === null);
  const done = detail.customReminders.filter((item) => item.doneAt !== null);

  const apply = async (body: Record<string, unknown>) => {
    await send({ leadId, ...body });
    announceDataChange('leads');
    refreshSnapshot();
    reload();
  };
  const run = (body: Record<string, unknown>) => { void apply(body).catch((reason: unknown) => toast.push({ message: reason instanceof Error ? reason.message : 'Не вдалося зберегти нагадування.', tone: 'hot' })); };

  return (
    <section className="flex flex-col gap-3" aria-label="Свої нагадування">
      <div className="flex items-center justify-between gap-3">
        <h3 className="m-0 text-[15px] font-medium">Свої нагадування</h3>
        <Button variant="outline" size="sm" disabled={archived} onClick={() => setEditor({})}><Plus aria-hidden="true" strokeWidth={1.5} />Нагадування</Button>
      </div>
      {open.length === 0 ? <p className="m-0 text-[13px] text-ink-2">Власних нагадувань немає. Додай, наприклад, «перевірити відповідь щодо днів уроку».</p> : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {open.map((item) => {
            const pending = actions.isCustomPending(leadId, item.id);
            const late = item.at < detail.serverNow;
            return (
              <li key={item.id} className="flex flex-col gap-2 rounded-inner border border-line bg-sunken px-4 py-3">
                <p className="m-0 text-sm font-medium">{item.text}</p>
                <p className={`m-0 flex items-center gap-1.5 font-mono text-xs ${late && !pending ? 'text-hot' : 'text-ink-2'}`}>
                  {late && !pending ? <i aria-label="Прострочено" className="size-1.5 rounded-full bg-hot" /> : null}
                  {displayTime(item.at)}
                </p>
                {pending ? <p className="m-0 text-xs text-ink-2">Позначено виконаним. Ще можна скасувати.</p> : null}
                <div className="flex flex-wrap gap-2">
                  {pending ? (
                    <Button variant="outline" size="sm" aria-label={`Скасувати позначку нагадування «${item.text}»`} onClick={() => actions.undo(customReminderKey(leadId, item.id))}>Скасувати</Button>
                  ) : (
                    <>
                      <Button variant="outline" size="sm" aria-label={`Нагадування «${item.text}» виконано`} onClick={() => actions.doneCustom({ leadId, reminderId: item.id })}>Готово</Button>
                      <Button variant="ghost" size="sm" disabled={archived} aria-label={`Змінити нагадування «${item.text}»`} onClick={() => setEditor({ reminder: item })}>Змінити</Button>
                      <Button variant="ghost" size="sm" aria-label={`Видалити нагадування «${item.text}»`} onClick={() => setRemoving(item)}>Видалити</Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {done.length ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-ink-2">Виконані ({done.length})</summary>
          <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
            {done.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 rounded-inner border border-line px-4 py-2.5">
                <span className="min-w-0"><span className="block truncate text-sm text-ink-2">{item.text}</span><span className="block font-mono text-xs text-ink-3">{displayTime(item.doneAt)}</span></span>
                <Button variant="ghost" size="sm" disabled={archived} aria-label={`Повернути нагадування «${item.text}»`} onClick={() => run({ op: 'reopen', reminderId: item.id })}>Повернути</Button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {editor ? (
        <ReminderForm
          reminder={editor.reminder}
          close={() => setEditor(null)}
          save={(text, at) => apply(editor.reminder ? { op: 'update', reminderId: editor.reminder.id, text, at } : { op: 'add', text, at })}
        />
      ) : null}
      {removing ? (
        <Confirmation
          title="Видалити нагадування?"
          description={`«${removing.text}» зникне зі списку й зі шкали «Сьогодні».`}
          close={() => setRemoving(null)}
          run={() => apply({ op: 'delete', reminderId: removing.id })}
        />
      ) : null}
    </section>
  );
}
