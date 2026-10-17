'use client';

import { useState } from 'react';
import { Copy } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import type { LeadDetail } from '@/lib/leads/application/queries';
import { Confirmation, EditDialog, Field, SaveForm, SelectField, textValue } from './form';
import { labels, displayTime, type Mutation } from './client';
import { useReminderActions } from '@/components/views/today/use-reminder-actions';

/**
 * Нагадування одного уроку: надсилаються вручну, оператор лише позначає результат. «Надіслано» — та сама дія, що «Готово» в
 * «Сьогодні» (`useReminderActions`): нагадування одразу зникає і там, і тут, 8 с його можна скасувати з будь-якого місця.
 */
export function Reminders({ lesson, leadId, leadVersion, disabled, mutate }: { lesson: LeadDetail['lessons'][number]; leadId: string; leadVersion: number; disabled: boolean; mutate: Mutation }) {
  const toast = useToast();
  const actions = useReminderActions();
  const [editing, setEditing] = useState<number | null>(null);
  const [mark, setMark] = useState<{ id: string; state: string } | null>(null);
  const current = lesson.reminders.find((reminder) => reminder.slot === editing);
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-xs text-ink-2">Надсилання вручну. Позначай після відправки в месенджері.</p>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {lesson.reminders.map((reminder) => { const pending = actions.isPending(leadId, reminder.id); return (
          <li key={reminder.id} className="flex flex-col gap-2 rounded-inner border border-line bg-sunken px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <p className="m-0 text-sm font-medium">№{reminder.slot} · за {reminder.offsetMinutes} хв</p>
              <span className={`flex items-center gap-1.5 text-xs ${reminder.state === 'needs-data' && !pending ? 'text-warn' : 'text-ink-2'}`}>
                {reminder.state === 'needs-data' && !pending ? <i aria-hidden="true" className="size-1.5 rounded-full bg-warn" /> : null}
                {pending ? labels.sent || 'Надіслано' : labels[reminder.state]}
              </span>
            </div>
            <p className="m-0 font-mono text-xs text-ink-2">{displayTime(reminder.dueAt)}</p>
            {reminder.state === 'needs-data' && !pending ? <p className="m-0 text-xs text-hot">Додай: {reminder.missing.join(', ')}.</p> : null}
            {pending ? <p className="m-0 text-xs text-ink-2">Позначено як надіслане. Ще можна скасувати.</p> : null}
            {reminder.sentAt !== null ? <p className="m-0 text-xs text-ink-2">Надіслано: {displayTime(reminder.sentAt)}</p> : null}
            {reminder.skippedAt !== null ? <p className="m-0 text-xs text-ink-2">Пропущено: {displayTime(reminder.skippedAt)}</p> : null}
            {reminder.text ? (
              <details className="text-sm">
                <summary className="cursor-pointer text-xs text-ink-2">Текст нагадування</summary>
                <p className="m-0 mt-2 whitespace-pre-wrap">{reminder.text}</p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  aria-label={`Копіювати текст нагадування №${reminder.slot}`}
                  onClick={() => {
                    void navigator.clipboard.writeText(reminder.text!)
                      .then(() => toast.push({ message: 'Текст скопійовано.' }))
                      .catch(() => toast.push({ message: 'Не вдалося скопіювати. Виділи текст вручну.', tone: 'hot' }));
                  }}
                ><Copy aria-hidden="true" strokeWidth={1.5} />Копіювати</Button>
              </details>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" disabled={disabled} aria-label={`Налаштувати нагадування №${reminder.slot}`} onClick={() => setEditing(reminder.slot)}>Налаштувати</Button>
              {pending ? (
                <Button variant="outline" size="sm" aria-label={`Скасувати позначку нагадування №${reminder.slot}`} onClick={() => actions.undo(`reminder:${leadId}:${reminder.id}`)}>Скасувати</Button>
              ) : (
                <Button variant="outline" size="sm" disabled={disabled || !reminder.text} aria-label={`Позначити нагадування №${reminder.slot} як надіслане`} onClick={() => actions.markSent({ leadId, reminderId: reminder.id, leadVersion })}>Надіслано</Button>
              )}
              <Button variant="ghost" size="sm" disabled={disabled || !reminder.enabled || reminder.sentAt !== null || reminder.skippedAt !== null} aria-label={`Пропустити нагадування №${reminder.slot}`} onClick={() => setMark({ id: reminder.id, state: 'skipped' })}>Пропустити</Button>
            </div>
          </li>
        ); })}
      </ul>
      {current ? (
        <EditDialog title={`Нагадування №${current.slot}`} close={() => setEditing(null)}>
          <SaveForm
            cancel={() => setEditing(null)}
            save={async (f) => {
              await mutate('reminder_update', { enabled: textValue(f, 'enabled') === 'true', offsetMinutes: Number(textValue(f, 'offsetMinutes')) }, current.id);
              setEditing(null);
            }}
          >
            <SelectField label="Увімкнено" name="enabled" value={String(current.enabled)} options={[{ value: 'true', label: 'Так' }, { value: 'false', label: 'Ні' }]} />
            <Field label="За скільки хвилин (0–43200)" name="offsetMinutes" type="number" min={0} max={43200} value={current.offsetMinutes} required />
          </SaveForm>
        </EditDialog>
      ) : null}
      {mark ? (
        <Confirmation
          title="Пропустити нагадування?"
          description="Ця позначка стосується лише вибраного нагадування."
          close={() => setMark(null)}
          run={() => mutate('reminder_mark', { state: mark.state }, mark.id)}
        />
      ) : null}
    </div>
  );
}
