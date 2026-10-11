'use client';

import { useState } from 'react';
import { Panel } from '@/components/shell/panel';
import { Button } from '@/components/ui/button';
import { Ghost } from '@/components/ui/ghost';
import type { LeadDetail } from '@/lib/leads/application/queries';
import { labels, type Mutation } from './client';
import { Confirmation } from './form';
import { HistoryList } from './history-events';
import { LeadEditor } from './lead-editor';
import { LeadSummary, StageEditor } from './lead-summary';
import { ConversationTab } from './tab-conversation';
import { LessonsTab } from './tab-lessons';
import { ScriptsTab } from './tab-scripts';
import { StudentsTab } from './tab-students';

export type LeadTab = 'overview' | 'conversation' | 'reminders' | 'lessons' | 'students' | 'history' | 'scripts';
const TABS = [
  { value: 'overview', label: 'Огляд' },
  { value: 'conversation', label: 'Розмова' },
  { value: 'reminders', label: 'Нагадування' },
  { value: 'lessons', label: 'Заняття' },
  { value: 'students', label: 'Учні' },
  { value: 'history', label: 'Історія' },
  { value: 'scripts', label: 'Скрипти' },
] as const;

/** Inspector ліда: компактна шапка (ім'я, етап, головна дія) і вкладки Огляд · Розмова · Нагадування · Заняття · Учні · Історія · Скрипти. */
export function LeadInspector({ open, onClose, name, detail, error, mutate, reload, onChanged }: {
  open: boolean;
  onClose: () => void;
  name: string;
  detail: LeadDetail | null;
  error: string;
  mutate: Mutation;
  reload: () => void;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<LeadTab>('overview');
  const [seenLead, setSeenLead] = useState<string | undefined>(undefined);
  const [stage, setStage] = useState(false);
  const [editing, setEditing] = useState(false);
  const [archive, setArchive] = useState(false);
  const [response, setResponse] = useState(false);
  const lead = detail?.lead;
  // Інший лід — знову «Огляд» (скидання під час рендеру, без ефекту).
  if (lead && lead.id !== seenLead) { setSeenLead(lead.id); setTab('overview'); }

  return (
    <Panel open={open} onOpenChange={(next) => { if (!next) onClose(); }} title={lead?.name ?? name} subtitle={lead ? `${labels[lead.platform] ?? lead.platform}${lead.subject ? ` · ${lead.subject}` : ''} · ${labels[lead.funnelStage] ?? lead.funnelStage}` : undefined} actions={lead && lead.archivedAt === null ? <Button variant="outline" size="sm" onClick={() => setStage(true)}>Змінити етап</Button> : undefined} tabs={TABS} tab={tab} onTabChange={setTab}>
      {error && !detail ? (
        <div className="flex flex-col items-start gap-3">
          <p role="alert" className="m-0 text-sm text-hot">{error}</p>
          <Button variant="outline" size="sm" onClick={reload}>Спробувати ще раз</Button>
        </div>
      ) : !detail || !lead ? (
        <div aria-busy="true" className="flex flex-col gap-3"><Ghost className="h-6 w-2/3 rounded-full" /><Ghost className="h-28 rounded-inner" /><Ghost className="h-40 rounded-inner" /></div>
      ) : (
        <div key={lead.id} className="flex flex-col gap-6">
          {tab === 'overview' ? <LeadSummary detail={detail} mutate={mutate} onEdit={() => setEditing(true)} onHistory={() => setTab('history')} onArchive={() => setArchive(true)} onResponse={() => setResponse(true)} /> : null}
          {tab === 'conversation' ? <ConversationTab detail={detail} mutate={mutate} onChanged={onChanged} /> : null}
          {tab === 'reminders' ? <LessonsTab detail={detail} mutate={mutate} mode="reminders" /> : null}
          {tab === 'lessons' ? <LessonsTab detail={detail} mutate={mutate} mode="lessons" /> : null}
          {tab === 'students' ? <StudentsTab detail={detail} mutate={mutate} /> : null}
          {tab === 'history' ? <HistoryList leadId={lead.id} /> : null}
          {tab === 'scripts' ? <ScriptsTab lead={lead} /> : null}
          {stage ? <StageEditor lead={lead} mutate={mutate} close={() => setStage(false)} /> : null}
          {editing ? <LeadEditor lead={lead} close={() => setEditing(false)} save={(data) => mutate('update', data)} /> : null}
          {archive ? (
            <Confirmation
              title={lead.archivedAt !== null ? 'Відновити ліда?' : 'Архівувати ліда?'}
              description="Учні, уроки, переписка й історичні показники збережуться."
              close={() => setArchive(false)}
              run={() => mutate(lead.archivedAt !== null ? 'restore' : 'archive')}
            />
          ) : null}
          {response ? (
            <Confirmation
              title={lead.responseCancelledAt === null ? 'Скасувати відгук?' : 'Відновити відгук?'}
              description={lead.responseCancelledAt === null ? 'Контакт і вся історія збережуться, але цей відгук перестане входити у звіти та статистику.' : 'Первинний відгук знову ввійде у звіти та статистику на своїй історичній даті.'}
              close={() => setResponse(false)}
              run={() => mutate(lead.responseCancelledAt === null ? 'response_cancel' : 'response_restore')}
            />
          ) : null}
        </div>
      )}
    </Panel>
  );
}
