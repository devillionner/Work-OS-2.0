'use client';
import { useState } from 'react';
import type { LeadDetail } from '@/lib/leads/application/queries';
import { FUNNEL_STAGES } from '@/lib/leads/domain/validation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  EditDialog,
  Field,
  SaveForm,
  SelectField,
  textValue,
  epochValue,
  datetimeValue,
} from './form';
import { displayTime, labels, type Mutation } from './client';
import { businessDate } from '@/lib/leads/domain/time';
export function FollowUp({
  detail,
  mutate,
}: {
  detail: LeadDetail;
  mutate: Mutation;
}) {
  const lead = detail.lead;
  const [editing, setEditing] = useState(false);
  const [reply, setReply] = useState(false);
  const [now] = useState(() => Math.floor(Date.now() / 1000));
  const today = businessDate(now);
  const pastBookedLesson = detail.lessons.find((lesson) => lesson.status === 'booked' && lesson.lessonDate < today);
  return (
    <section className="lead-panel" aria-labelledby="follow-up-title">
      <div className="lead-section-head">
        <h3 id="follow-up-title">Наступна дія та воронка</h3>
        <Button
          variant="outline"
          onClick={() => setEditing(true)}
          disabled={lead.archivedAt !== null}
        >
          Змінити
        </Button>
      </div>
      <ol className="lead-funnel" aria-label="Етапи воронки">
        {FUNNEL_STAGES.map((stage) => (
          <li
            key={stage}
            aria-current={stage === lead.funnelStage ? 'step' : undefined}
          >
            {labels[stage]}
          </li>
        ))}
      </ol>
      <div className={`lead-follow-up ${lead.overdue ? 'is-overdue' : ''}`}>
        <strong>{lead.nextAction || 'Наступну дію ще не заплановано'}</strong>
        <p>
          {lead.nextContactAt !== null
            ? displayTime(lead.nextContactAt)
            : 'Без терміну'}{' '}
          {lead.overdue && <Badge variant="destructive">Прострочено</Badge>}
        </p>
      </div>
      {pastBookedLesson && <output className="lead-stale-lesson"><div><strong>Минулий урок ще без результату</strong><p>{pastBookedLesson.subject} · {pastBookedLesson.lessonDate}. Зафіксуй результат, щоб воронка перейшла з «Запис» далі.</p></div><Button variant="outline" onClick={() => document.getElementById(`lesson-${pastBookedLesson.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>До уроку</Button></output>}
      <dl className="lead-facts">
        <div>
          <dt>Кваліфікація ліда / родини</dt>
          <dd>
            {lead.qualification ?? '—'} / {lead.familyQualification ?? '—'}
          </dd>
        </div>
        <div>
          <dt>Відгук</dt>
          <dd>{displayTime(lead.responseAt)}</dd>
        </div>
        <div>
          <dt>Перша відповідь</dt>
          <dd>{displayTime(lead.firstReplyAt)}</dd>
        </div>
        <div>
          <dt>
            {lead.firstReplyAt === null
              ? 'Очікує відповіді'
              : 'До першої відповіді'}
          </dt>
          <dd>
            {lead.waitingSeconds === null
              ? 'Час відгуку невідомий'
              : `${Math.floor(lead.waitingSeconds / 3600)} год ${Math.floor(lead.waitingSeconds / 60) % 60} хв`}
          </dd>
        </div>
      </dl>
      {lead.firstReplyAt === null && (
        <Button
          variant="ghost"
          onClick={() => setReply(true)}
          disabled={lead.archivedAt !== null || lead.responseAt === null}
        >
          Зафіксувати першу відповідь
        </Button>
      )}
      {editing && (
        <EditDialog
          title="Follow-up та кваліфікація"
          close={() => setEditing(false)}
        >
          <SaveForm
            cancel={() => setEditing(false)}
            save={async (f) => {
              await mutate('update', {
                nextAction: textValue(f, 'nextAction'),
                nextContactAt: epochValue(
                  f,
                  'nextContactAt',
                  lead.nextContactAt,
                ),
                qualification: textValue(f, 'qualification') || null,
                familyQualification:
                  textValue(f, 'familyQualification') || null,
                funnelStage: textValue(f, 'funnelStage'),
              });
              setEditing(false);
            }}
          >
            <Field
              label="Наступна дія"
              name="nextAction"
              value={lead.nextAction}
            />
            <Field
              label="Коли зв’язатись (Київ)"
              name="nextContactAt"
              type="datetime-local"
              value={datetimeValue(lead.nextContactAt)}
            />
            <SelectField
              label="Кваліфікація ліда"
              name="qualification"
              value={lead.qualification ?? ''}
              options={['', 'A', 'B', 'C']}
            />
            <SelectField
              label="Кваліфікація родини"
              name="familyQualification"
              value={lead.familyQualification ?? ''}
              options={['', 'A', 'B', 'C']}
            />
            <SelectField
              label="Етап воронки"
              name="funnelStage"
              value={lead.funnelStage}
              options={FUNNEL_STAGES}
            />
          </SaveForm>
        </EditDialog>
      )}
      {reply && (
        <EditDialog
          title="Перша відповідь"
          close={() => setReply(false)}
          description="Фактичний час першої відповіді. Внутрішні повідомлення CRM не фіксують його автоматично."
        >
          <SaveForm
            cancel={() => setReply(false)}
            save={async (f) => {
              await mutate('first_reply', { at: epochValue(f, 'at') });
              setReply(false);
            }}
          >
            <Field
              label="Дата й час (Київ)"
              name="at"
              type="datetime-local"
              value={datetimeValue(now)}
              required
            />
          </SaveForm>
        </EditDialog>
      )}
    </section>
  );
}
