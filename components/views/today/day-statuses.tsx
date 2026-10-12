'use client';

import { emitCommand } from '@/components/shell/command-bus';
import { useShell } from '@/components/shell/shell-context';
import { useTelegramAccounts } from '@/components/views/platforms/telegram-accounts';
import { useTelegramSchedule } from '@/components/views/platforms/telegram-schedule-store';
import { isMissed, nextPending, slotTime } from '@/components/views/today/schedule-slots';
import { useReportStatuses } from '@/components/views/today/report-statuses';
import { useMinuteClock } from '@/components/views/today/use-minute-clock';
import { cn } from '@/lib/utils';

type Tone = 'ok' | 'hot' | 'neutral';
const DOT: Record<Tone, string> = { ok: 'bg-ok', hot: 'bg-hot', neutral: 'bg-line-strong' };

function Status({ label, value, tone, link = false, loading = false, onClick, title }: { label: string; value: string; tone: Tone; link?: boolean; loading?: boolean; onClick: () => void; title: string }) {
  return (
    <li className="shrink-0">
      <button type="button" title={title} onClick={onClick} className="inline-flex min-h-9 items-center gap-2 rounded-full border border-line px-3.5 text-sm transition-colors duration-150 hover:bg-raised [@media(pointer:coarse)]:min-h-11 @4xl:border-transparent @4xl:px-2.5 @4xl:hover:border-line">
        <i aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', loading ? 'animate-pulse bg-line-strong' : DOT[tone])} />
        <span className="text-ink-2">{label}</span>
        <span className={cn(loading ? 'text-ink-3' : tone === 'hot' ? 'text-hot' : 'text-ink', link && !loading && 'underline underline-offset-4')}>{loading ? '…' : value}</span>
      </button>
    </li>
  );
}

/**
 * Рядок статусів дня: звіт за вчора, звіт за сьогодні й розклад Telegram, кожен — крапка й коротке слово, без карток.
 * Червоним буває лише вчорашній незданий звіт. Дані: `GET /api/reports` (один запит, далі за ревізією) і сховище розкладу.
 */
export function DayStatuses() {
  const { snapshot, navigate } = useShell();
  const reports = useReportStatuses();
  const now = useMinuteClock();
  const telegram = snapshot.enabledPlatforms.includes('telegram');
  const { accountId } = useTelegramAccounts(telegram);
  const { snapshot: schedule, loading: scheduleLoading } = useTelegramSchedule(telegram ? accountId : null);

  const openReport = (date: string) => { navigate('reports'); emitCommand('reports:date', date); };
  const openSchedule = () => { navigate('platforms'); emitCommand('platforms:telegram-schedule'); };

  const yesterday = reports.yesterday;
  const today = reports.today;
  const slots = schedule?.slots ?? [];
  const next = nextPending(slots, now);
  const missed = slots.filter((slot) => isMissed(slot, now)).length;

  return (
    <ul aria-label="Статуси дня" className="hide-scrollbar m-0 flex list-none gap-2 overflow-x-auto p-0 @4xl:flex-wrap @4xl:gap-x-4 @4xl:overflow-visible">
      <Status
        label="Звіт за вчора"
        loading={reports.loading && yesterday === null}
        value={yesterday === 'submitted' ? 'здано' : yesterday === 'pending' ? 'не здано' : 'не потрібен'}
        tone={yesterday === 'submitted' ? 'ok' : yesterday === 'pending' ? 'hot' : 'neutral'}
        link={yesterday === 'pending'}
        title="Відкрити звіт за вчора"
        onClick={() => openReport(reports.yesterdayDate)}
      />
      <Status
        label="Звіт сьогодні"
        loading={today === null && reports.loading}
        value={today === 'submitted' ? 'здано' : today === 'draft' ? 'чернетка' : 'не почато'}
        tone={today === 'submitted' ? 'ok' : 'neutral'}
        title="Відкрити звіт дня"
        onClick={() => openReport(snapshot.today)}
      />
      {telegram ? (
        <Status
          label="Розклад"
          loading={!schedule && scheduleLoading}
          value={next ? `наступний слот ${slotTime(next.scheduledAt)} · ${next.chatName ?? 'чат'}` : !slots.length ? 'на сьогодні не створено' : missed ? `пропущено ${missed}` : 'усі слоти виконано'}
          tone={next || (slots.length > 0 && !missed) ? 'ok' : 'neutral'}
          title="Відкрити розклад Telegram"
          onClick={openSchedule}
        />
      ) : null}
    </ul>
  );
}
