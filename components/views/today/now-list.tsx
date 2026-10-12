'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ArrowRight, Play } from 'lucide-react';
import { emitCommand } from '@/components/shell/command-bus';
import { useShell } from '@/components/shell/shell-context';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { useTelegramAccounts } from '@/components/views/platforms/telegram-accounts';
import { useTelegramSchedule } from '@/components/views/platforms/telegram-schedule-store';
import { dayProgress } from '@/components/views/shared/pace';
import { plural } from '@/components/views/shared/plural';
import { LeadTasks } from '@/components/views/today/lead-tasks';
import { inMinutes, isMissed, nextPending, slotTime } from '@/components/views/today/schedule-slots';
import type { WorkdayStatus } from '@/components/views/today/workday-panel';
import { cn } from '@/lib/utils';

type Row = {
  key: string;
  /** Число або час ліворуч (mono). */
  lead?: string;
  text: string;
  detail?: ReactNode;
  hot?: boolean;
  /** Тихий рядок без дії: «Прострочених немає». */
  quiet?: boolean;
  action?: { label: string; run: () => void; busy?: boolean; icon?: 'play' };
};
type Entry = { rank: number } & ({ kind: 'row'; row: Row } | { kind: 'tasks' });

/** Звіт нагадуємо ввечері (після 18:00) або коли день уже завершено: раніше він ще не потрібен. */
const REPORT_FROM = 0.75;

/**
 * «Що зробити зараз»: наступні дії, зібрані зі знімка «Сьогодні» і розкладу Telegram, що вже завантажені, — без нових запитів.
 * Кожен рядок — число, що це за справа і перехід; порядок за терміновістю: старт дня, пропущені публікації, прострочені
 * ліди, найближча публікація, цілі, звіт. Найтерміновіша дія — світла кнопка, решта — контурні.
 */
export function NowList({ workday, onStartDay }: { workday: WorkdayStatus | null; onStartDay: () => void }) {
  const { snapshot, navigate } = useShell();
  const telegram = snapshot.enabledPlatforms.includes('telegram');
  const { accounts, accountId } = useTelegramAccounts(telegram);
  const { snapshot: schedule } = useTelegramSchedule(telegram ? accountId : null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const started = workday ? workday.started : Boolean(snapshot.workday);
  const openSchedule = () => { navigate('platforms'); emitCommand('platforms:telegram-schedule'); };
  const account = accounts.find((item) => item.id === accountId);
  const accountLabel = account ? `${account.name} #${account.number}` : null;
  const slots = schedule?.slots ?? [];
  const entries: Entry[] = [];

  if (!started) {
    entries.push({ rank: 0, kind: 'row', row: { key: 'start', text: 'Почати робочий день', detail: 'Зафіксує цілі й запустить відлік часу.', action: { label: 'Почати день', run: onStartDay, busy: workday?.busy, icon: 'play' } } });
  }

  const missed = slots.filter((slot) => isMissed(slot, now));
  if (missed.length) {
    entries.push({ rank: 1, kind: 'row', row: {
      key: 'missed', lead: missed.length > 1 ? String(missed.length) : slotTime(missed[0].scheduledAt), hot: true,
      text: missed.length > 1 ? `Пропущені публікації: ${missed.length}` : 'Пропущена публікація',
      detail: `${missed.length > 1 ? `найраніша ${slotTime(missed[0].scheduledAt)} · ` : ''}«${missed[0].chatName ?? 'чат'}»`,
      action: { label: 'До розкладу', run: openSchedule },
    } });
  }

  if (snapshot.leadTasks.length) entries.push({ rank: 2, kind: 'tasks' });
  else entries.push({ rank: 2, kind: 'row', row: { key: 'no-tasks', text: 'Прострочених немає', quiet: true } });

  const next = nextPending(slots, now);
  if (next) {
    entries.push({ rank: 3, kind: 'row', row: {
      key: 'next', lead: slotTime(next.scheduledAt), text: 'Наступна публікація',
      detail: `«${next.chatName ?? 'чат'}»${accountLabel ? ` · ${accountLabel}` : ''} · ${inMinutes(next, now)}`,
      action: { label: 'До розкладу', run: openSchedule },
    } });
  }

  if (started) {
    const publicationsLeft = Math.max(0, snapshot.publicationGoal.target - snapshot.publicationGoal.completed);
    if (publicationsLeft > 0) entries.push({ rank: 4, kind: 'row', row: { key: 'publications', lead: String(publicationsLeft), text: `${plural(publicationsLeft, 'публікація', 'публікації', 'публікацій')} до цілі`, detail: `зроблено ${snapshot.publicationGoal.completed} із ${snapshot.publicationGoal.target}`, action: { label: 'До платформ', run: () => navigate('platforms') } } });
    const chatsLeft = Math.max(0, snapshot.chatGoal.target - snapshot.chatGoal.completed);
    if (chatsLeft > 0) entries.push({ rank: 5, kind: 'row', row: { key: 'chats', lead: String(chatsLeft), text: `${plural(chatsLeft, 'чат', 'чати', 'чатів')} до цілі приєднання`, detail: `приєднано ${snapshot.chatGoal.completed} із ${snapshot.chatGoal.target}`, action: { label: 'До черги', run: () => navigate('platforms') } } });
    if (snapshot.reportSubmittedAt === null && (dayProgress() >= REPORT_FROM || (workday ? workday.ended : snapshot.workday?.status === 'ended'))) {
      entries.push({ rank: 6, kind: 'row', row: { key: 'report', text: 'Звіт за сьогодні не здано', detail: 'Чернетка збирається з подій дня.', action: { label: 'До звіту', run: () => navigate('reports') } } });
    } else if (snapshot.reportSubmittedAt !== null && snapshot.pendingAfterReport > 0) {
      entries.push({ rank: 6, kind: 'row', row: { key: 'report-update', lead: String(snapshot.pendingAfterReport), text: `${plural(snapshot.pendingAfterReport, 'подія', 'події', 'подій')} після звіту`, detail: 'Звіт можна оновити.', action: { label: 'До звіту', run: () => navigate('reports') } } });
    }
  }

  entries.sort((a, b) => a.rank - b.rank);
  const firstAction = entries.find((entry): entry is Entry & { kind: 'row' } => entry.kind === 'row' && Boolean(entry.row.action));

  return (
    <Surface variant="glass" radius="card" data-reveal className="@container flex min-w-0 flex-col gap-1 p-5" aria-labelledby="now-title">
      <h2 id="now-title" className="m-0 mb-1 text-[17px] font-medium">Що зробити зараз</h2>
      <ol className="m-0 flex list-none flex-col p-0">
        {entries.map((entry) => (
          <li key={entry.kind === 'row' ? entry.row.key : 'tasks'} className="border-t border-line first:border-t-0">
            {entry.kind === 'tasks' ? <LeadTasks /> : (
              <div className="flex min-h-14 items-center gap-3 py-2">
                <span className={cn('w-14 shrink-0 text-right font-mono text-lg tabular-nums', entry.row.hot ? 'text-hot' : 'text-ink', !entry.row.lead && 'hidden @md:block')}>{entry.row.lead ?? ''}</span>
                <div className="min-w-0 flex-1">
                  <p className={cn('m-0 text-sm', entry.row.quiet ? 'text-ink-2' : 'font-medium')}>{entry.row.text}</p>
                  {entry.row.detail ? <p className="m-0 line-clamp-2 text-xs text-ink-2">{entry.row.detail}</p> : null}
                </div>
                {entry.row.action ? (
                  <Button variant={entry.row.key === firstAction?.row.key ? 'action' : 'outline'} size="sm" busy={entry.row.action.busy} onClick={entry.row.action.run} className="shrink-0">
                    {entry.row.action.icon === 'play' ? <Play aria-hidden="true" strokeWidth={1.5} /> : null}{entry.row.action.label}{entry.row.action.icon === 'play' ? null : <ArrowRight aria-hidden="true" strokeWidth={1.5} />}
                  </Button>
                ) : null}
              </div>
            )}
          </li>
        ))}
      </ol>
    </Surface>
  );
}
