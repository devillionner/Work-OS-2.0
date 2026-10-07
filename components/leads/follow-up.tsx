'use client';
import { useState } from 'react';
import { Clock, AlertTriangle, CheckCircle2, Edit3, ArrowRight, Zap, Hourglass } from 'lucide-react';
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

  const currentStageIndex = FUNNEL_STAGES.indexOf(lead.funnelStage as (typeof FUNNEL_STAGES)[number]);

  return (
    <section className="lead-panel lead-follow-up-section" aria-labelledby="follow-up-title">
      <div className="lead-section-head">
        <div>
          <p className="eyebrow">Супровід та воронка</p>
          <h3 id="follow-up-title">Наступна дія та етап</h3>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setEditing(true)}
          disabled={lead.archivedAt !== null}
        >
          <Edit3 className="size-3.5 mr-1" />
          Змінити етап
        </Button>
      </div>

      <div className="lead-funnel-container" aria-label="Етапи воронки">
        <ol className="lead-funnel-pipeline">
          {FUNNEL_STAGES.map((stage, index) => {
            const isCurrent = stage === lead.funnelStage;
            const isPassed = currentStageIndex > index;
            return (
              <li
                key={stage}
                className={`lead-funnel-step ${isCurrent ? 'is-current' : ''} ${isPassed ? 'is-passed' : ''}`}
                aria-current={isCurrent ? 'step' : undefined}
              >
                <span className="lead-funnel-step-indicator">
                  {isPassed ? <CheckCircle2 className="size-3" /> : index + 1}
                </span>
                <span className="lead-funnel-step-label">{labels[stage]}</span>
              </li>
            );
          })}
        </ol>
      </div>

      <div className={`lead-follow-up-card ${lead.overdue ? 'is-overdue' : ''}`}>
        <div className="lead-follow-up-icon-col">
          {lead.overdue ? (
            <AlertTriangle className="size-5 text-red-600" />
          ) : (
            <Clock className="size-5 text-blue-600" />
          )}
        </div>
        <div className="lead-follow-up-body">
          <div className="lead-follow-up-action-line">
            <strong>{lead.nextAction || 'Наступну дію ще не заплановано'}</strong>
            {lead.overdue && <Badge variant="destructive">Прострочено</Badge>}
          </div>
          <p className="lead-follow-up-time">
            Термін: {lead.nextContactAt !== null ? displayTime(lead.nextContactAt) : 'Без терміну'}
          </p>
        </div>
      </div>

      {pastBookedLesson && (
        <output className="lead-stale-lesson">
          <div className="lead-stale-lesson-content">
            <AlertTriangle className="size-4 text-amber-600 flex-shrink-0" />
            <div>
              <strong>Минулий урок ще без результату</strong>
              <p>{pastBookedLesson.subject} · {pastBookedLesson.lessonDate}. Зафіксуй результат, щоб воронка перейшла з «Запис» далі.</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => document.getElementById(`lesson-${pastBookedLesson.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
            До уроку
            <ArrowRight className="size-3.5 ml-1" />
          </Button>
        </output>
      )}

      <div className="lead-facts-grid">
        <div className="lead-fact-card">
          <span className="lead-fact-label">Кваліфікація (Лід / Родина)</span>
          <strong className="lead-fact-value">
            {lead.qualification ?? '—'} <span className="text-slate-400">/</span> {lead.familyQualification ?? '—'}
          </strong>
        </div>
        <div className="lead-fact-card">
          <span className="lead-fact-label">Час відгуку</span>
          <strong className="lead-fact-value">{displayTime(lead.responseAt)}</strong>
        </div>
        <div className="lead-fact-card">
          <span className="lead-fact-label">Перша відповідь</span>
          <strong className="lead-fact-value">{displayTime(lead.firstReplyAt)}</strong>
        </div>
        <div className="lead-fact-card">
          <span className="lead-fact-label">
            {lead.firstReplyAt === null ? 'Очікує відповіді' : 'Швидкість відповіді'}
          </span>
          <strong className="lead-fact-value">
            {lead.waitingSeconds === null
              ? '—'
              : `${Math.floor(lead.waitingSeconds / 3600)}г ${Math.floor(lead.waitingSeconds / 60) % 60}хв`}
          </strong>
        </div>
      </div>

      {lead.firstReplyAt === null && (
        <div className="lead-first-reply-prompt">
          <Zap className="size-4 text-amber-500" />
          <span>Відповідь ліду ще не зафіксовано в системі</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setReply(true)}
            disabled={lead.archivedAt !== null || lead.responseAt === null}
          >
            Зафіксувати першу відповідь
          </Button>
        </div>
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
