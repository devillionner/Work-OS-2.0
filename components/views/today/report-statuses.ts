'use client';

import { useShell } from '@/components/shell/shell-context';
import { useViewActive } from '@/components/shell/view-pane';
import { useRemote } from '@/components/views/shared/use-remote';
import { shiftDay, type ReportData } from '@/components/views/reports/types';

/** Звіт за вчора: «здано», «не здано» (була робота, звіту немає) або «не потрібен» (вчора без роботи й без звіту). */
export type YesterdayReport = 'submitted' | 'pending' | 'none';
/** Звіт за сьогодні: ще не почато, чернетка або здано. */
export type TodayReport = 'not-started' | 'draft' | 'submitted';

export type ReportStatuses = { loading: boolean; yesterday: YesterdayReport | null; yesterdayDate: string; today: TodayReport | null };

/**
 * Стан звітів «вчора» й «сьогодні» з наявного `GET /api/reports` (календар місяця + `previousReportReminder`), без нового ендпоінта.
 * Один запит при відкритті «Сьогодні» (на 1-е число — ще й за попередній місяць); далі лише за новою ревізією (live-подія чи здача
 * звіту), без таймерів.
 */
export function useReportStatuses(): ReportStatuses {
  const { snapshot, syncRevision } = useShell();
  const active = useViewActive();
  const today = snapshot.today;
  const yesterdayDate = shiftDay(today, -1);
  const month = today.slice(0, 7);
  const previousMonth = yesterdayDate.slice(0, 7);
  const crossesMonth = previousMonth !== month;
  const current = useRemote<ReportData>(`/api/reports?month=${month}&date=${today}`, { refresh: syncRevision, enabled: active, keepPrevious: true, fallback: 'Не вдалося завантажити стан звітів.' });
  const previous = useRemote<ReportData>(crossesMonth ? `/api/reports?month=${previousMonth}&date=${yesterdayDate}` : null, { refresh: syncRevision, enabled: active && crossesMonth, keepPrevious: true, fallback: 'Не вдалося завантажити стан звітів.' });

  const data = current.data;
  const yesterdaySource = crossesMonth ? previous.data : data;
  if (!data || (crossesMonth && !yesterdaySource)) {
    // Поки дані не прийшли, «сьогодні» береться зі знімка (він уже знає, чи звіт здано).
    return { loading: !current.error, yesterday: null, yesterdayDate, today: snapshot.reportSubmittedAt !== null ? 'submitted' : null };
  }
  const todayReport = data.reports.find((report) => report.date === today);
  const yesterdayReport = yesterdaySource?.reports.find((report) => report.date === yesterdayDate);
  return {
    loading: false,
    yesterdayDate,
    yesterday: data.previousReportReminder.pending ? 'pending' : yesterdayReport?.submittedAt ? 'submitted' : 'none',
    today: todayReport?.submittedAt ? 'submitted' : todayReport ? 'draft' : 'not-started',
  };
}
