'use client';

import { useState } from 'react';
import { History as HistoryIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import type { LeadDetail } from '@/lib/leads/application/queries';
import { safeUrl } from '@/lib/leads/domain/validation';
import { businessDate } from '@/lib/leads/domain/time';
import { EditDialog, Field, SaveForm, textValue } from './form';
import { labels, type Mutation } from './client';
import { LessonEditor } from './lesson-editor';
import { LessonHistory } from './history-events';
import { Reminders } from './reminders';

/** Заняття ліда: запис, перенесення, результат, запити куратору. Режим «reminders» показує нагадування уроків. */
const STATUS_DIALOG = {
  completed: { title: 'Підтвердити проведення уроку', description: 'Урок буде зараховано як одне відвідування. Запис на урок і відвідування рахуються окремо.', confirm: 'Так, урок проведено' },
  'no-show': { title: 'Підтвердити: учень пішов', description: 'Відвідування не буде зараховано. Результат залишиться в історії цього уроку.', confirm: 'Так, учень пішов' },
  cancelled: { title: 'Учень відмовився від уроку', description: 'Запис більше не рахуватиметься в «Записах» (цілі, звіти, аналітика). У історії ліда лишиться, що урок був записаний і потім скасований.', confirm: 'Так, скасувати запис' },
} as const;

export function LessonsTab({ detail, mutate, mode }: { detail: LeadDetail; mutate: Mutation; mode: 'lessons' | 'reminders' }) {
  const [editor, setEditor] = useState<{ mode: 'book' | 'update' | 'reschedule'; id?: string } | null>(null);
  const [statusAction, setStatusAction] = useState<{ id: string; status: 'completed' | 'no-show' | 'cancelled' } | null>(null);
  const [cancelRequest, setCancelRequest] = useState<string | null>(null);
  const [submitRequest, setSubmitRequest] = useState(false);
  const [historyLesson, setHistoryLesson] = useState<{ id: string; leadId: string; subject: string; date: string } | null>(null);
  const [today] = useState(() => businessDate(Math.floor(Date.now() / 1000)));
  const archived = detail.lead.archivedAt !== null;
  const attendance = detail.lessons.filter((lesson) => lesson.status === 'completed').length;

  if (mode === 'reminders') {
    const booked = detail.lessons.filter((lesson) => lesson.status === 'booked');
    return booked.length ? (
      <div className="flex flex-col gap-6">
        {booked.map((lesson) => (
          <section key={lesson.id} className="flex flex-col gap-3" aria-label={`Нагадування: ${lesson.subject}`}>
            <h3 className="m-0 text-[15px] font-medium">{lesson.subject} <span className="font-mono text-xs font-normal text-ink-2">{lesson.lessonDate} {lesson.lessonTime || ''}</span></h3>
            <Reminders lesson={lesson} leadId={detail.lead.id} leadVersion={detail.lead.version} mutate={mutate} disabled={archived} />
          </section>
        ))}
      </div>
    ) : <EmptyState text="Нагадування уроків з’являться, коли буде записано урок." />;
  }

  return (
    <section className="flex flex-col gap-5" aria-label="Заняття">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-sm text-ink-2">Відвідувань: <span className="font-mono text-ink">{attendance}</span>. Проведений урок зараховується як одне відвідування.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="action" size="sm" disabled={archived} onClick={() => setEditor({ mode: 'book' })}>Записати на урок</Button>
          <Button variant="outline" size="sm" disabled={archived || detail.curatorRequests.length > 0} onClick={() => setSubmitRequest(true)}>{detail.curatorRequests.length > 0 ? 'Запит уже очікує' : 'Запит куратору'}</Button>
        </div>
      </div>

      {detail.curatorRequests.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-inner border border-warn/40 px-4 py-3">
          <h3 className="m-0 text-sm font-medium">Очікують відповіді куратора</h3>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {detail.curatorRequests.map((request) => (
              <li key={request.id} className="flex items-center justify-between gap-3 text-sm">
                <span>Запит від {request.submittedDate}</span>
                <Button variant="ghost" size="sm" disabled={archived} onClick={() => setCancelRequest(request.id)}>Скасувати запит</Button>
              </li>
            ))}
          </ul>
          <p className="m-0 text-xs text-ink-2">Підтверди запит під час запису на урок або скасуй його з причиною.</p>
        </div>
      ) : null}

      {!detail.lessons.length ? <EmptyState text="Уроків поки немає. Запиши на перший урок." /> : null}
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {detail.lessons.map((lesson) => {
          const pastBooked = lesson.status === 'booked' && lesson.lessonDate < today;
          return (
            <li key={lesson.id} id={`lesson-${lesson.id}`} className={`flex flex-col gap-3 rounded-inner border bg-sunken px-4 py-4 ${pastBooked ? 'border-warn/50' : 'border-line'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="m-0 truncate text-[15px] font-medium">{lesson.subject}</h3>
                  <p className="m-0 mt-0.5 text-xs text-ink-2">{lesson.studentName} · <span className="font-mono">{lesson.lessonDate} {lesson.lessonTime || 'час не вказано'}</span> (Київ)</p>
                </div>
                <span className={`flex shrink-0 items-center gap-1.5 text-xs ${pastBooked ? 'text-warn' : 'text-ink-2'}`}>
                  {pastBooked ? <i aria-hidden="true" className="size-1.5 rounded-full bg-warn" /> : null}
                  {pastBooked ? 'Потрібен результат' : (labels[lesson.status] ?? lesson.status)}
                </span>
              </div>
              <p className="m-0 text-xs text-ink-2">{lesson.teacherName || 'Викладача не вказано'} · {lesson.lessonPlatform || 'платформу не вказано'} · дата запису {lesson.bookingDate || 'не вказана'}</p>
              {safeUrl(lesson.meetingLink) ? <a href={lesson.meetingLink} target="_blank" rel="noreferrer" className="w-fit text-sm underline underline-offset-4">Відкрити зустріч</a> : null}
              {lesson.statusReason ? <p className="m-0 text-xs text-ink-2">Причина: {lesson.statusReason}</p> : null}
              {lesson.rescheduledFromId ? <p className="m-0 text-xs text-ink-2"><a href={`#lesson-${lesson.rescheduledFromId}`} className="underline underline-offset-4">Попередній урок</a> · перенесення</p> : null}
              {lesson.replacementId ? <p className="m-0 text-xs text-ink-2"><a href={`#lesson-${lesson.replacementId}`} className="underline underline-offset-4">Перейти до нової дати</a></p> : null}
              <div className="flex flex-wrap gap-2">
                {lesson.status === 'booked' ? (
                  <>
                    <Button variant={pastBooked ? 'action' : 'outline'} size="sm" disabled={archived} onClick={() => setStatusAction({ id: lesson.id, status: 'completed' })}>Проведено</Button>
                    <Button variant="outline" size="sm" disabled={archived} onClick={() => setEditor({ mode: 'reschedule', id: lesson.id })}>Перенести</Button>
                    <Button variant="outline" size="sm" disabled={archived} onClick={() => setStatusAction({ id: lesson.id, status: 'no-show' })}>Учень пішов</Button>
                    <Button variant="outline" size="sm" disabled={archived} onClick={() => setStatusAction({ id: lesson.id, status: 'cancelled' })}>Учень відмовився</Button>
                    <Button variant="ghost" size="sm" disabled={archived} onClick={() => setEditor({ mode: 'update', id: lesson.id })}>Дані уроку</Button>
                  </>
                ) : null}
                <Button variant="ghost" size="sm" onClick={() => setHistoryLesson({ id: lesson.id, leadId: detail.lead.id, subject: lesson.subject, date: lesson.lessonDate })}><HistoryIcon aria-hidden="true" strokeWidth={1.5} />Історія</Button>
              </div>
            </li>
          );
        })}
      </ul>

      {submitRequest ? (
        <EditDialog title="Новий запит куратору" description="Запит додасть тимчасовий запис у денні показники до підтвердження або скасування." close={() => setSubmitRequest(false)}>
          <SaveForm label="Надіслати запит" cancel={() => setSubmitRequest(false)} save={async (form) => { await mutate('curator_submit', { submittedDate: textValue(form, 'submittedDate') || today }); setSubmitRequest(false); }}>
            <Field label="Дата обліку запиту *" name="submittedDate" type="date" value={today} required />
          </SaveForm>
        </EditDialog>
      ) : null}
      {cancelRequest ? (
        <EditDialog title="Скасувати запит куратору" description="Запит залишиться в історії, його попередній booking-показник буде скасовано." close={() => setCancelRequest(null)}>
          <SaveForm label="Підтвердити скасування" cancel={() => setCancelRequest(null)} save={async (form) => { await mutate('curator_cancel', { reason: textValue(form, 'reason') }, cancelRequest); setCancelRequest(null); }}>
            <Field label="Причина скасування *" name="reason" required />
          </SaveForm>
        </EditDialog>
      ) : null}
      {editor ? <LessonEditor detail={detail} lesson={detail.lessons.find((lesson) => lesson.id === editor.id)} mode={editor.mode} mutate={mutate} close={() => setEditor(null)} /> : null}
      {statusAction ? (
        <EditDialog
          title={STATUS_DIALOG[statusAction.status].title}
          description={STATUS_DIALOG[statusAction.status].description}
          close={() => setStatusAction(null)}
        >
          <SaveForm
            label={STATUS_DIALOG[statusAction.status].confirm}
            cancel={() => setStatusAction(null)}
            save={async (form) => {
              const status = statusAction.status;
              const reason = status === 'completed' ? '' : textValue(form, 'reason') || (status === 'no-show' ? 'Учень пішов' : '');
              await mutate('lesson_status', { status, reason }, statusAction.id);
              setStatusAction(null);
            }}
          >
            {statusAction.status === 'completed'
              ? <p className="m-0 text-sm text-ink-2">Після підтвердження цей урок збільшить показник відвідувань на 1.</p>
              : <Field label={statusAction.status === 'cancelled' ? 'Причина відмови' : 'Коментар (необов’язково)'} name="reason" required={statusAction.status === 'cancelled'} />}
          </SaveForm>
        </EditDialog>
      ) : null}
      {historyLesson ? <LessonHistory lesson={historyLesson} close={() => setHistoryLesson(null)} /> : null}
    </section>
  );
}
