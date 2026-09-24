'use client';
import { useState } from 'react';
import type { LeadDetail } from '@/lib/leads/application/queries';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Confirmation,
  EditDialog,
  Field,
  SaveForm,
  SelectField,
  textValue,
} from './form';
import { labels, displayTime, type Mutation } from './client';
export function Reminders({
  lesson,
  disabled,
  mutate,
}: {
  lesson: LeadDetail['lessons'][number];
  disabled: boolean;
  mutate: Mutation;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [mark, setMark] = useState<{ id: string; state: string } | null>(null);
  const [notice, setNotice] = useState('');
  const current = lesson.reminders.find((r) => r.slot === editing);
  return (
    <div className="lead-reminders">
      <h4>Нагадування</h4>
      <p className="muted-note">
        Надсилання вручну. Позначте після відправки у месенджері.
      </p>
      <div className="lead-reminder-grid">
        {lesson.reminders.map((r) => (
          <div className="lead-reminder" key={r.id}>
            <div>
              <strong>
                №{r.slot} · за {r.offsetMinutes} хв
              </strong>{' '}
              <Badge
                variant={r.state === 'needs-data' ? 'outline' : 'secondary'}
              >
                {labels[r.state]}
              </Badge>
            </div>
            <p>{displayTime(r.dueAt)}</p>
            {r.state === 'needs-data' && (
              <p className="lead-error">Додайте: {r.missing.join(', ')}.</p>
            )}
            {r.sentAt !== null && <p>Надіслано: {displayTime(r.sentAt)}</p>}
            {r.skippedAt !== null && (
              <p>Пропущено: {displayTime(r.skippedAt)}</p>
            )}
            {r.text && (
              <details>
                <summary>Текст нагадування</summary>
                <p className="lead-preserve">{r.text}</p>
                <Button
                  variant="ghost"
                  aria-label={`Копіювати текст нагадування №${r.slot}`}
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(r.text!)
                      .then(() => setNotice('Текст скопійовано.'))
                      .catch(() =>
                        setNotice(
                          'Не вдалося скопіювати. Виділіть текст вручну.',
                        ),
                      );
                  }}
                >
                  Копіювати
                </Button>
              </details>
            )}
            <div className="lead-actions">
              <Button
                variant="ghost"
                disabled={disabled}
                aria-label={`Налаштувати нагадування №${r.slot}`}
                onClick={() => setEditing(r.slot)}
              >
                Налаштувати
              </Button>
              <Button
                variant="outline"
                disabled={disabled || !r.text}
                aria-label={`Позначити нагадування №${r.slot} як надіслане`}
                onClick={() => setMark({ id: r.id, state: 'sent' })}
              >
                Надіслано
              </Button>
              <Button
                variant="ghost"
                disabled={
                  disabled ||
                  !r.enabled ||
                  r.sentAt !== null ||
                  r.skippedAt !== null
                }
                aria-label={`Пропустити нагадування №${r.slot}`}
                onClick={() => setMark({ id: r.id, state: 'skipped' })}
              >
                Пропустити
              </Button>
            </div>
          </div>
        ))}
      </div>
      {notice && <output>{notice}</output>}
      {current && (
        <EditDialog
          title={`Нагадування №${current.slot}`}
          close={() => setEditing(null)}
        >
          <SaveForm
            cancel={() => setEditing(null)}
            save={async (f) => {
              await mutate(
                'reminder_update',
                {
                  enabled: textValue(f, 'enabled') === 'true',
                  offsetMinutes: Number(textValue(f, 'offsetMinutes')),
                },
                current.id,
              );
              setEditing(null);
            }}
          >
            <SelectField
              label="Увімкнено"
              name="enabled"
              value={String(current.enabled)}
              options={[
                { value: 'true', label: 'Так' },
                { value: 'false', label: 'Ні' },
              ]}
            />
            <Field
              label="За скільки хвилин (0–43200)"
              name="offsetMinutes"
              type="number"
              min={0}
              max={43200}
              value={current.offsetMinutes}
              required
            />
          </SaveForm>
        </EditDialog>
      )}
      {mark && (
        <Confirmation
          title={
            mark.state === 'sent'
              ? 'Нагадування надіслано?'
              : 'Пропустити нагадування?'
          }
          description="Ця позначка стосується лише вибраного нагадування."
          close={() => setMark(null)}
          run={() => mutate('reminder_mark', { state: mark.state }, mark.id)}
        />
      )}
    </div>
  );
}
