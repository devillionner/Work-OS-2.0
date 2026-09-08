'use client';
import { useState } from 'react';
import type { LeadDetail } from '@/lib/leads/application/queries';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { safeUrl } from '@/lib/leads/domain/validation';
import { EditDialog, Field, SaveForm, SelectField, textValue } from './form';
import { labels, type Mutation } from './client';
import { LessonEditor } from './lesson-editor';
import { Reminders } from './reminders';
export function Lessons({
  detail,
  mutate,
}: {
  detail: LeadDetail;
  mutate: Mutation;
}) {
  const [editor, setEditor] = useState<{
    mode: 'book' | 'update' | 'reschedule';
    id?: string;
  } | null>(null);
  const [statusId, setStatusId] = useState<string | null>(null);
  const [cancelRequest, setCancelRequest] = useState<string | null>(null);
  const archived = detail.lead.archivedAt !== null;
  return (
    <section className="lead-panel" aria-labelledby="lessons-title">
      <div className="lead-section-head">
        <div>
          <h3 id="lessons-title">
            Уроки <small>{detail.lessons.length}</small>
          </h3>
          <p className="muted-note">
            Повторний запис зберігається в цього самого ліда.
          </p>
        </div>
        <Button onClick={() => setEditor({ mode: 'book' })} disabled={archived}>
          Записати на урок
        </Button>
      </div>
      {detail.curatorRequests.length > 0 && (
        <div className="lead-follow-up">
          <h4>Очікують відповіді куратора</h4>
          <ul className="lead-simple-list">
            {detail.curatorRequests.map((request) => (
              <li key={request.id}>
                <span>Запит від {request.submittedDate}</span>
                <Button
                  variant="ghost"
                  disabled={archived}
                  onClick={() => setCancelRequest(request.id)}
                >
                  Скасувати запит
                </Button>
              </li>
            ))}
          </ul>
          <p>
            Підтвердіть запит під час запису на урок або скасуйте його з
            причиною.
          </p>
        </div>
      )}
      {cancelRequest && (
        <EditDialog
          title="Скасувати запит куратору"
          description="Запит залишиться в історії, його попередній booking-показник буде скасовано."
          close={() => setCancelRequest(null)}
        >
          <SaveForm
            label="Підтвердити скасування"
            cancel={() => setCancelRequest(null)}
            save={async (form) => {
              await mutate(
                'curator_cancel',
                { reason: textValue(form, 'reason') },
                cancelRequest,
              );
              setCancelRequest(null);
            }}
          >
            <Field label="Причина скасування *" name="reason" required />
          </SaveForm>
        </EditDialog>
      )}
      {!detail.lessons.length && (
        <p className="lead-empty">Уроків поки немає.</p>
      )}
      <div className="lead-lessons">
        {detail.lessons.map((l) => (
          <article className="lead-lesson" key={l.id} id={`lesson-${l.id}`}>
            <div className="lead-section-head">
              <div>
                <h4>{l.subject}</h4>
                <p>
                  {l.studentName} · {l.lessonDate}{' '}
                  {l.lessonTime || 'Час не вказано'} (Київ)
                </p>
              </div>
              <Badge variant="outline">{labels[l.status] ?? l.status}</Badge>
            </div>
            <p>
              {l.teacherName || 'Викладача не вказано'} ·{' '}
              {l.lessonPlatform || 'Платформу не вказано'}
            </p>
            <p className="muted-note">
              Дата запису: {l.bookingDate || 'Не вказано'}
            </p>
            {safeUrl(l.meetingLink) && (
              <a href={l.meetingLink} target="_blank" rel="noreferrer">
                Відкрити зустріч
              </a>
            )}
            {l.statusReason && <p>Причина: {l.statusReason}</p>}
            {l.rescheduledFromId && (
              <p>
                <a href={`#lesson-${l.rescheduledFromId}`}>Попередній урок</a> ·
                перенесення
              </p>
            )}
            {l.replacementId && (
              <p>
                <a href={`#lesson-${l.replacementId}`}>Перейти до нової дати</a>
              </p>
            )}
            {l.status === 'booked' && (
              <>
                <div className="lead-actions">
                  <Button
                    variant="outline"
                    disabled={archived}
                    onClick={() => setEditor({ mode: 'update', id: l.id })}
                  >
                    Дані уроку
                  </Button>
                  <Button
                    variant="outline"
                    disabled={archived}
                    onClick={() => setEditor({ mode: 'reschedule', id: l.id })}
                  >
                    Перенести
                  </Button>
                  <Button
                    variant="outline"
                    disabled={archived}
                    onClick={() => setStatusId(l.id)}
                  >
                    Результат / скасування
                  </Button>
                </div>
                <Reminders lesson={l} mutate={mutate} disabled={archived} />
              </>
            )}
          </article>
        ))}
      </div>
      {editor && (
        <LessonEditor
          detail={detail}
          lesson={detail.lessons.find((l) => l.id === editor.id)}
          mode={editor.mode}
          mutate={mutate}
          close={() => setEditor(null)}
        />
      )}
      {statusId && (
        <EditDialog
          title="Завершити або скасувати урок"
          description="Це збереже результат уроку в історії. Для нового запису створіть ще один урок у цьому ліді."
          close={() => setStatusId(null)}
        >
          <SaveForm
            label="Підтвердити результат"
            cancel={() => setStatusId(null)}
            save={async (f) => {
              await mutate(
                'lesson_status',
                {
                  status: textValue(f, 'status'),
                  reason: textValue(f, 'reason'),
                },
                statusId,
              );
              setStatusId(null);
            }}
          >
            <SelectField
              label="Статус"
              name="status"
              value="completed"
              options={['completed', 'cancelled', 'no-show']}
            />
            <Field
              label="Причина (обов’язкова для скасування / неявки)"
              name="reason"
            />
          </SaveForm>
        </EditDialog>
      )}
    </section>
  );
}
