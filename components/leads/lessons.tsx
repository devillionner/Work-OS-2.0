'use client';
import { useRef, useState } from 'react';
import { History as HistoryIcon } from 'lucide-react';
import type { LeadDetail } from '@/lib/leads/application/queries';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { safeUrl } from '@/lib/leads/domain/validation';
import { EditDialog, Field, SaveForm, textValue } from './form';
import { labels, type Mutation } from './client';
import { LessonEditor } from './lesson-editor';
import { LessonHistoryDialog } from './lesson-history';
import { Reminders } from './reminders';
import { businessDate } from '@/lib/leads/domain/time';
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
  const [statusAction, setStatusAction] = useState<{
    id: string;
    status: 'completed' | 'no-show';
  } | null>(null);
  const [cancelRequest, setCancelRequest] = useState<string | null>(null);
  const [submitRequest, setSubmitRequest] = useState(false);
  const [today] = useState(() => businessDate(Math.floor(Date.now() / 1000)));
  const [historyLesson, setHistoryLesson] = useState<{ id: string; leadId: string; subject: string; date: string } | null>(null);
  const historyTrigger = useRef<HTMLButtonElement | null>(null);
  const archived = detail.lead.archivedAt !== null;
  const attendanceCount = detail.lessons.filter((lesson) => lesson.status === 'completed').length;
  return (
    <section className="lead-panel" aria-labelledby="lessons-title">
      <div className="lead-section-head">
        <div>
          <h3 id="lessons-title">
            Уроки <small>{detail.lessons.length}</small>
          </h3>
          <p className="muted-note">
            Відвідувань: <strong>{attendanceCount}</strong>. Проведений урок зараховується як одне відвідування.
          </p>
        </div>
        <div className="lead-actions"><Button onClick={() => setEditor({ mode: 'book' })} disabled={archived}>Записати на урок</Button><Button variant="outline" onClick={() => setSubmitRequest(true)} disabled={archived || detail.curatorRequests.length > 0}>{detail.curatorRequests.length > 0 ? 'Запит уже очікує' : 'Запит куратору'}</Button></div>
      </div>
      {submitRequest && <EditDialog title="Новий запит куратору" description="Запит додасть тимчасовий запис у денні показники до підтвердження або скасування." close={() => setSubmitRequest(false)}><SaveForm label="Надіслати запит" cancel={() => setSubmitRequest(false)} save={async (form) => { await mutate('curator_submit', { submittedDate: textValue(form, 'submittedDate') || today }); setSubmitRequest(false); }}><Field label="Дата обліку запиту *" name="submittedDate" type="date" value={today} required /></SaveForm></EditDialog>}
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
        {detail.lessons.map((l) => {
          const pastBooked = l.status === 'booked' && l.lessonDate < today;
          return (
          <article className={`lead-lesson ${pastBooked ? 'is-past-booked' : ''}`} key={l.id} id={`lesson-${l.id}`}>
            <div className="lead-section-head">
              <div>
                <h4>{l.subject}</h4>
                <p>
                  {l.studentName} · {l.lessonDate}{' '}
                  {l.lessonTime || 'Час не вказано'} (Київ)
                </p>
              </div>
              <Badge variant={pastBooked ? 'secondary' : 'outline'}>{pastBooked ? 'Потрібен результат' : (labels[l.status] ?? l.status)}</Badge>
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
            <div className="lead-actions">
              {l.status === 'booked' && (
                <>
                  <Button
                    variant={pastBooked ? 'default' : 'outline'}
                    disabled={archived}
                    onClick={() => setStatusAction({ id: l.id, status: 'completed' })}
                  >
                    Проведено
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
                    onClick={() => setStatusAction({ id: l.id, status: 'no-show' })}
                  >
                    Учень пішов
                  </Button>
                  <Button
                    variant="outline"
                    disabled={archived}
                    onClick={() => setEditor({ mode: 'update', id: l.id })}
                  >
                    Дані уроку
                  </Button>
                </>
              )}
              <Button
                variant="outline"
                onClick={(event) => {
                  historyTrigger.current = event.currentTarget;
                  setHistoryLesson({ id: l.id, leadId: detail.lead.id, subject: l.subject, date: l.lessonDate });
                }}
              >
                <HistoryIcon data-icon="inline-start" />Історія
              </Button>
            </div>
            {l.status === 'booked' && <Reminders lesson={l} mutate={mutate} disabled={archived} />}
          </article>
          );
        })}
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
      {statusAction && (
        <EditDialog
          title={statusAction.status === 'completed' ? 'Підтвердити проведення уроку' : 'Підтвердити: учень пішов'}
          description={
            statusAction.status === 'completed'
              ? 'Урок буде зараховано як одне відвідування. Сам запис на урок і відвідування рахуються окремо.'
              : 'Відвідування не буде зараховано. Результат залишиться в історії цього уроку.'
          }
          close={() => setStatusAction(null)}
        >
          <SaveForm
            label={statusAction.status === 'completed' ? 'Так, урок проведено' : 'Так, учень пішов'}
            cancel={() => setStatusAction(null)}
            save={async (form) => {
              const status = statusAction.status;
              const reason = status === 'no-show'
                ? textValue(form, 'reason') || 'Учень пішов'
                : '';
              await mutate(
                'lesson_status',
                { status, reason },
                statusAction.id,
              );
              setStatusAction(null);
            }}
          >
            {statusAction.status === 'no-show' ? (
              <Field label="Коментар (необов’язково)" name="reason" />
            ) : (
              <p className="muted-note">Після підтвердження цей урок збільшить показник відвідувань на 1.</p>
            )}
          </SaveForm>
        </EditDialog>
      )}
      <LessonHistoryDialog open={historyLesson !== null} lesson={historyLesson} onClose={() => setHistoryLesson(null)} finalFocus={() => historyTrigger.current} />
    </section>
  );
}
