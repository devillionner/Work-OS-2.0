'use client';

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { useShell } from '@/components/shell/shell-context';
import { TopbarControls, useViewActive } from '@/components/shell/view-pane';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Ghost } from '@/components/ui/ghost';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import type { AnalyticsOverview } from '@/lib/analytics-overview';
import { ChatRanking } from './chat-ranking';
import { CohortCard } from './cohort-card';
import { FunnelCard } from './funnel-card';
import { InsightsCard } from './insights-card';
import { KpiRow } from './kpi-row';
import { MetricPanel } from './metric-panel';
import { PlatformsCard } from './platforms-card';
import { SubjectsCard } from './subjects-card';
import { currentDate, formatRange, PERIODS, plural, previousRange, type AnalyticsData, type AnalyticsPeriod, type MetricKey } from './types';
import { useRemote } from '@/components/views/shared/use-remote';

// recharts живе тільки в чанку графіка.
const TrendChart = lazy(() => import('./trend-chart'));

function isEmpty(data: AnalyticsData): boolean {
  const { joined, publications, responses, bookings, completed } = data.totals;
  return joined + publications + responses + bookings + completed === 0;
}

/** «Аналітика»: період у Topbar, KPI з дельтою, графік, воронка, рейтинг чатів і когорти; показник відкривається в Inspector. */
export default function AnalyticsView() {
  const { syncRevision } = useShell();
  const active = useViewActive();
  const [today] = useState(currentDate);
  const [period, setPeriod] = useState<AnalyticsPeriod>('month');
  const [customFrom, setCustomFrom] = useState(`${today.slice(0, 7)}-01`);
  const [customTo, setCustomTo] = useState(today);
  const [refresh, setRefresh] = useState(0);
  const [metric, setMetric] = useState<MetricKey | null>(null);
  const seenRevision = useRef(syncRevision);

  const customValid = Boolean(customFrom && customTo && customFrom <= customTo && customTo <= today);
  const query = useMemo(() => {
    if (period !== 'custom') return new URLSearchParams({ period }).toString();
    return customValid ? new URLSearchParams({ period, from: customFrom, to: customTo }).toString() : null;
  }, [period, customFrom, customTo, customValid]);

  const current = useRemote<AnalyticsData>(query ? `/api/analytics?${query}` : null, { refresh, enabled: active, keepPrevious: true, fallback: 'Не вдалося завантажити аналітику.' });
  const data = current.data;
  const previousQuery = useMemo(() => {
    if (!data) return null;
    const range = previousRange(data.range.from, data.range.days);
    return new URLSearchParams({ period: 'custom', from: range.from, to: range.to }).toString();
  }, [data]);
  const previous = useRemote<AnalyticsData>(previousQuery ? `/api/analytics?${previousQuery}` : null, { refresh, enabled: active && data !== null });
  const overview = useRemote<AnalyticsOverview>(query ? `/api/analytics/overview?${query}` : null, { refresh, enabled: active, keepPrevious: true });

  const reload = useCallback(() => setRefresh((value) => value + 1), []);

  // Зміни з інших пристроїв приходять через live-канал: перечитуємо раз, коли розділ активний.
  useEffect(() => {
    if (!active || seenRevision.current === syncRevision) return;
    seenRevision.current = syncRevision;
    queueMicrotask(reload);
  }, [active, syncRevision, reload]);

  const exportCsv = () => {
    if (query) window.location.assign(`/api/analytics?${query}&format=csv`);
  };

  const previousData = previous.data;
  const refreshing = current.loading && data !== null;

  return (
    <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-3 pb-6 @4xl:gap-4" aria-busy={current.loading}>
      <TopbarControls>
        <div className="min-w-0">
          <Segmented<AnalyticsPeriod> label="Період аналітики" size="sm" value={period} onValueChange={setPeriod} items={PERIODS} />
        </div>
        <Button variant="outline" size="sm" className="shrink-0" onClick={exportCsv} disabled={!data}>
          <Download aria-hidden="true" strokeWidth={1.5} />Експорт
        </Button>
      </TopbarControls>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {period === 'custom' ? (
          <div className="flex flex-wrap items-center gap-2">
            <Input type="date" aria-label="Початок періоду" value={customFrom} max={customTo || today} onChange={(event) => setCustomFrom(event.target.value)} className="h-9 w-[152px]" />
            <span aria-hidden="true" className="text-ink-2">—</span>
            <Input type="date" aria-label="Кінець періоду" value={customTo} min={customFrom} max={today} onChange={(event) => setCustomTo(event.target.value)} className="h-9 w-[152px]" />
          </div>
        ) : null}
        {data ? (
          <p className="m-0 text-[13px] text-ink-2">
            <span className="font-mono text-ink">{formatRange(data.range.from, data.range.to)}</span>
            {` · ${data.range.days} ${plural(data.range.days, 'день', 'дні', 'днів')}`}
            {previousQuery && previousData ? <>{' · проти '}<span className="font-mono">{formatRange(previousData.range.from, previousData.range.to)}</span></> : null}
          </p>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          {refreshing ? <output className="text-xs text-ink-2">Оновлюємо…</output> : null}
          <Button variant="icon" size="sm" aria-label="Оновити аналітику" onClick={reload} disabled={!query || current.loading}><RefreshCw aria-hidden="true" strokeWidth={1.5} /></Button>
        </div>
      </div>

      {!query ? (
        <EmptyState text="Вкажи початок і кінець періоду: початок не пізніше кінця, кінець — не пізніше сьогодні." />
      ) : current.error ? (
        <div className="flex flex-wrap items-center gap-3">
          <p role="alert" className="m-0 text-sm text-hot">{current.error}</p>
          <Button variant="outline" size="sm" onClick={reload}>Спробувати ще раз</Button>
        </div>
      ) : null}

      {!data && query && !current.error ? <Skeleton /> : null}

      {data ? (
        <div aria-busy={current.stale} className={current.stale ? 'flex flex-col gap-3 opacity-60 transition-opacity duration-150 @4xl:gap-4' : 'flex flex-col gap-3 transition-opacity duration-150 @4xl:gap-4'}>
          <KpiRow data={data} previous={previousData} onOpen={setMetric} />
          <p className="m-0 text-xs text-ink-2">Натисни на показник, щоб побачити події, з яких він складається.</p>
          {isEmpty(data) ? (
            <>
              <div className="grid grid-cols-1 gap-3 @4xl:grid-cols-12 @4xl:gap-4">
                <InsightsCard className="@4xl:col-span-12" insights={data.insights} overview={overview.data} overviewError={Boolean(overview.error)} />
              </div>
              <EmptyState
                text="За цей період ще немає подій. Обери довший період, щоб побачити динаміку й рейтинги."
                action={period !== 'year' ? <Button variant="outline" size="sm" onClick={() => setPeriod('year')}>Показати рік</Button> : undefined}
              />
            </>
          ) : (
            <div className="grid grid-cols-1 gap-3 @4xl:grid-cols-12 @4xl:gap-4">
              <Suspense fallback={<Ghost className="h-[420px] rounded-card @4xl:col-span-8" />}>
                <TrendChart className="@4xl:col-span-8" points={data.trends} previous={previousData?.trends ?? null} periodLabel={formatRange(data.range.from, data.range.to)} />
              </Suspense>
              <InsightsCard className="@4xl:col-span-4" insights={data.insights} overview={overview.data} overviewError={Boolean(overview.error)} />
              <FunnelCard className="@4xl:col-span-6" data={data} />
              <SubjectsCard className="@4xl:col-span-6" data={data.subjects} />
              <PlatformsCard className="@4xl:col-span-5" platforms={data.platforms} />
              <ChatRanking className="@4xl:col-span-7" chats={data.chats} />
              <CohortCard className="@4xl:col-span-12" cohort={data.cohort} />
            </div>
          )}
        </div>
      ) : null}

      <MetricPanel metric={metric} query={query} onClose={() => setMetric(null)} />
    </div>
  );
}

function Skeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-3 @4xl:gap-4">
      <div className="grid grid-cols-2 gap-3 @4xl:grid-cols-4 @4xl:gap-4">{[0, 1, 2, 3].map((item) => <Ghost key={item} className="h-[132px] rounded-card @4xl:h-[148px]" />)}</div>
      <div className="grid grid-cols-1 gap-3 @4xl:grid-cols-12 @4xl:gap-4">
        <Ghost className="h-[420px] rounded-card @4xl:col-span-8" />
        <Ghost className="h-[420px] rounded-card @4xl:col-span-4" />
      </div>
    </div>
  );
}
