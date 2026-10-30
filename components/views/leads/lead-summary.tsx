'use client';

import { useState } from 'react';
import { Archive, Check, Copy, ExternalLink, History, Pencil, Phone, RotateCcw, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { scrollToNode } from '@/components/views/shared/scroll';
import type { LeadDetail } from '@/lib/leads/application/queries';
import { FUNNEL_STAGES, safeUrl } from '@/lib/leads/domain/validation';
import { businessDate } from '@/lib/leads/domain/time';
import { cn } from '@/lib/utils';
import { EditDialog, Field, SaveForm, SelectField, textValue, epochValue, datetimeValue } from './form';
import { displayTime, labels, type Mutation } from './client';
import { StudentsBlock } from './learners';

/** Вкладка «Огляд»: контакти, воронка, наступна дія, факти й швидкі дії над лідом. */
export function LeadSummary({ detail, mutate, onEdit, onHistory, onArchive, onResponse }: {
  detail: LeadDetail;
  mutate: Mutation;
  onEdit: () => void;
  onHistory: () => void;
  onArchive: () => void;
  onResponse: () => void;
}) {
  const lead = detail.lead;
  const toast = useToast();
  const [copied, setCopied] = useState<string | null>(null);
  const [reply, setReply] = useState(false);
  const [now] = useState(() => Math.floor(Date.now() / 1000));
  const archived = lead.archivedAt !== null;
  const today = businessDate(now);
  const pastBooked = detail.lessons.find((lesson) => lesson.status === 'booked' && lesson.lessonDate < today);
  const stageIndex = FUNNEL_STAGES.indexOf(lead.funnelStage as (typeof FUNNEL_STAGES)[number]);

  const copy = async (label: string, value: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      toast.push({ message: `${label} скопійовано.` });
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      toast.push({ message: `Не вдалося скопіювати ${label.toLowerCase()}. Скопіюй вручну.`, tone: 'hot' });
    }
  };

  const chip = (label: string, value: string, icon: typeof Phone) => {
    const Icon = icon;
    return (
      <button key={label} type="button" onClick={() => void copy(label, value)} className="inline-flex h-8 items-center gap-2 rounded-full border border-line px-3 text-[13px] transition-colors hover:bg-raised active:scale-[0.985]" aria-label={`Копіювати ${label.toLowerCase()}: ${value}`}>
        <Icon aria-hidden="true" strokeWidth={1.5} className="size-3.5 text-ink-2" />
        <span className="font-mono">{value}</span>
        {copied === label ? <Check aria-hidden="true" strokeWidth={1.5} className="size-3.5 text-ok" /> : <Copy aria-hidden="true" strokeWidth={1.5} className="size-3.5 text-ink-3" />}
      </button>
    );
  };

  return (
    <div className="@container">
    <div className="grid grid-cols-1 gap-5 @[640px]:grid-cols-[minmax(0,1fr)_minmax(0,300px)]">
    <div className="flex min-w-0 flex-col gap-5 @[640px]:col-start-1 @[640px]:row-start-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-2">
        <span>Звернувся з предмета: <span className="text-ink">{lead.subject || 'не вказано'}</span></span>
        <span aria-hidden="true">·</span>
        <span>Відгук: <span className="font-mono">{lead.responseDate || 'не вказано'}</span></span>
        <span aria-hidden="true">·</span>
        <span>{archived ? 'В архіві' : (labels[lead.status] ?? lead.status)}</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {lead.phone ? chip('Телефон', lead.phone, Phone) : null}
        {lead.telegramUsername ? chip('Telegram', lead.telegramUsername, Send) : null}
        {lead.contactUnknown === 1 && !lead.phone && !lead.telegramUsername ? (
          <span className="inline-flex h-8 items-center rounded-full border border-dashed border-line px-3 text-[13px] text-ink-2">Контакт невідомий</span>
        ) : null}
        {safeUrl(lead.sourceChatLink) || detail.sourceChat ? (
          <a href={safeUrl(lead.sourceChatLink) ? lead.sourceChatLink : detail.sourceChat?.link} target="_blank" rel="noreferrer" className="inline-flex h-8 max-w-full items-center gap-2 rounded-full border border-line px-3 text-[13px] transition-colors hover:bg-raised"><ExternalLink aria-hidden="true" strokeWidth={1.5} className="size-3.5 shrink-0 text-ink-2" /><span className="truncate">{detail.sourceChat ? `${detail.sourceChat.name} · ${labels[detail.sourceChat.platform] ?? detail.sourceChat.platform}` : 'Джерело відгуку'}</span></a>
        ) : null}
      </div>

    </div>

    <div className="min-w-0 @[640px]:col-start-2 @[640px]:row-span-2 @[640px]:row-start-1">
      <StudentsBlock detail={detail} mutate={mutate} />
    </div>

    <div className="flex min-w-0 flex-col gap-5 @[640px]:col-start-1 @[640px]:row-start-2">
      {lead.note ? (
        <div className="flex items-start justify-between gap-3 rounded-inner border border-line bg-sunken px-4 py-3">
          <p className="m-0 whitespace-pre-wrap text-sm">{lead.note}</p>
          <Button variant="icon" size="sm" aria-label="Копіювати нотатку" onClick={() => void copy('Нотатку', lead.note)}>{copied === 'Нотатку' ? <Check aria-hidden="true" strokeWidth={1.5} /> : <Copy aria-hidden="true" strokeWidth={1.5} />}</Button>
        </div>
      ) : null}
      {lead.duplicateState !== 'none' ? <p className="m-0 text-sm text-warn">Дублікат: {labels[lead.duplicateState]}</p> : null}

      <ol className="m-0 flex list-none gap-1 overflow-x-auto p-0 hide-scrollbar" aria-label="Етапи воронки">
        {FUNNEL_STAGES.map((stage, index) => (
          <li key={stage} aria-current={stage === lead.funnelStage ? 'step' : undefined} className={cn('flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs', stage === lead.funnelStage ? 'border-transparent bg-action text-action-ink' : stageIndex > index ? 'border-line-strong text-ink' : 'border-line text-ink-2')}>
            <span className="font-mono">{index + 1}</span>{labels[stage]}
          </li>
        ))}
      </ol>

      <div className={cn('flex items-start justify-between gap-3 rounded-inner border px-4 py-3', lead.overdue ? 'border-hot/50' : 'border-line bg-sunken')}>
        <div className="min-w-0">
          <p className="m-0 flex items-center gap-2 text-sm font-medium">
            {lead.overdue ? <i aria-label="Прострочено" className="size-1.5 shrink-0 rounded-full bg-hot" /> : null}
            {lead.nextAction || 'Наступну дію ще не заплановано'}
          </p>
          <p className="m-0 mt-0.5 font-mono text-xs text-ink-2">Термін: {lead.nextContactAt !== null ? displayTime(lead.nextContactAt) : 'без терміну'}</p>
        </div>
      </div>

      {pastBooked ? (
        <output className="flex items-start justify-between gap-3 rounded-inner border border-warn/40 px-4 py-3">
          <p className="m-0 text-sm"><strong className="font-medium">Минулий урок без результату.</strong> {pastBooked.subject} · {pastBooked.lessonDate}. Зафіксуй результат, щоб воронка пішла далі.</p>
          <Button variant="outline" size="sm" onClick={() => scrollToNode(document.getElementById(`lesson-${pastBooked.id}`), { block: 'center' })}>До уроку</Button>
        </output>
      ) : null}

      <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div><dt className="text-xs text-ink-2">Кваліфікація лід / родина</dt><dd className="m-0 font-mono">{lead.qualification ?? '—'} / {lead.familyQualification ?? '—'}</dd></div>
        <div><dt className="text-xs text-ink-2">Час відгуку</dt><dd className="m-0 font-mono text-[13px]">{displayTime(lead.responseAt)}</dd></div>
        <div><dt className="text-xs text-ink-2">Перша відповідь</dt><dd className="m-0 font-mono text-[13px]">{displayTime(lead.firstReplyAt)}</dd></div>
        <div><dt className="text-xs text-ink-2">{lead.firstReplyAt === null ? 'Очікує відповіді' : 'Швидкість відповіді'}</dt><dd className="m-0 font-mono">{lead.waitingSeconds === null ? '—' : `${Math.floor(lead.waitingSeconds / 3600)} г ${Math.floor(lead.waitingSeconds / 60) % 60} хв`}</dd></div>
      </dl>
      {lead.firstReplyAt === null ? (
        <div className="flex items-center justify-between gap-3 rounded-inner border border-dashed border-line-strong px-4 py-3">
          <p className="m-0 text-sm text-ink-2">Відповідь ліду ще не зафіксовано</p>
          <Button variant="outline" size="sm" disabled={archived || lead.responseAt === null} onClick={() => setReply(true)}>Зафіксувати</Button>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={archived} onClick={onEdit}><Pencil aria-hidden="true" strokeWidth={1.5} />Редагувати</Button>
        <Button variant="outline" size="sm" disabled={archived} onClick={onResponse}>{lead.responseCancelledAt === null ? 'Скасувати відгук' : 'Відновити відгук'}</Button>
        <Button variant="ghost" size="sm" onClick={onHistory}><History aria-hidden="true" strokeWidth={1.5} />Історія</Button>
        <Button variant="ghost" size="sm" tone={archived ? 'default' : 'danger'} onClick={onArchive}>{archived ? <><RotateCcw aria-hidden="true" strokeWidth={1.5} />Відновити</> : <><Archive aria-hidden="true" strokeWidth={1.5} />Архівувати</>}</Button>
      </div>

      {reply ? (
        <EditDialog title="Перша відповідь" description="Фактичний час першої відповіді." close={() => setReply(false)}>
          <SaveForm cancel={() => setReply(false)} save={async (f) => { await mutate('first_reply', { at: epochValue(f, 'at') }); setReply(false); }}>
            <Field label="Дата й час (Київ)" name="at" type="datetime-local" value={datetimeValue(now)} required />
          </SaveForm>
        </EditDialog>
      ) : null}
    </div>
    </div>
    </div>
  );
}

/** Крок «Етап і наступна дія» (відкривається з шапки панелі й з «Огляду»). */
export function StageEditor({ lead, mutate, close }: { lead: LeadDetail['lead']; mutate: Mutation; close: () => void }) {
  return (
    <EditDialog title="Етап і наступна дія" description="Етап воронки, кваліфікація та коли зв’язатися." close={close}>
      <SaveForm
        cancel={close}
        save={async (f) => {
          await mutate('update', {
            nextAction: textValue(f, 'nextAction'),
            nextContactAt: epochValue(f, 'nextContactAt', lead.nextContactAt),
            qualification: textValue(f, 'qualification') || null,
            familyQualification: textValue(f, 'familyQualification') || null,
            funnelStage: textValue(f, 'funnelStage'),
          });
          close();
        }}
      >
        <Field label="Наступна дія" name="nextAction" value={lead.nextAction} />
        <Field label="Коли зв’язатись (Київ)" name="nextContactAt" type="datetime-local" value={datetimeValue(lead.nextContactAt)} />
        <SelectField label="Кваліфікація ліда" name="qualification" value={lead.qualification ?? ''} options={['', 'A', 'B', 'C']} />
        <SelectField label="Кваліфікація родини" name="familyQualification" value={lead.familyQualification ?? ''} options={['', 'A', 'B', 'C']} />
        <SelectField label="Етап воронки" name="funnelStage" value={lead.funnelStage} options={FUNNEL_STAGES} />
      </SaveForm>
    </EditDialog>
  );
}
