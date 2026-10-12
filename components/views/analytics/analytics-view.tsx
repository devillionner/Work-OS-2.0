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
import { scrollToNode } from '@/components/views/shared/scroll';
import { PlatformsCard } from './platforms-card';
import { SubjectsCard } from './subjects-card';
import { comparisonWindow, currentDate, formatRange, humanRange, PERIODS, plural, toPreviousWindow, type AnalyticsData, type AnalyticsPeriod, type ComparisonData, type CohortData, type MetricKey } from './types';
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
  const [chatPlatform, setChatPlatform] = useState('all');
  const rankingRef = useRef<HTMLDivElement>(null);
  const seenRevision = useRef(syncRevision);

  const customValid = Boolean(customFrom && customTo && customFrom <= customTo && customTo <= today);
  const query = useMemo(() => {
    if (period !== 'custom') return new URLSearchParams({ period }).toString();
    return customValid ? new URLSearchParams({ period, from: customFrom, to: customTo }).toString() : null;
  }, [period, customFrom, customTo, customValid]);

  const current = useRemote<AnalyticsData>(query ? `/api/analytics?${query}&cohort=0` : null, { refresh, enabled: active, keepPrevious: true, fallback: 'Не вдалося завантажити аналітику.' });
  const data = current.data;
  // Період беремо з вибору, а не з відповіді: для одноденного тижня чи місяця сервер повертає period «day».
  const compare = useMemo(() => (data && !current.stale ? comparisonWindow(period, data.range) : null), [data, period, current.stale]);
  const previousQuery = useMemo(() => (compare ? new URLSearchParams({ period: 'custom', from: compare.from, to: compare.to, compare: '1' }).toString() : null), [compare]);
  const previous = useRemote<ComparisonData>(previousQuery ? `/api/analytics?${previousQuery}` : null, { refresh, enabled: active && data !== null });
  const overview = useRemote<AnalyticsOverview>(query ? `/api/analytics/overview?${query}` : null, { refresh, enabled: active, keepPrevious: true });
  // Когорти важкі для D1 (≈3 тис. рядків): вантажимо один раз, коли картка вперше з'являється в в'юпорті, окремо для кожного періоду.
  const cohortUrl = query ? `/api/analytics/cohort?${query}` : null;
  const [cohortFor, setCohortFor] = useState<string | null>(null);
  const cohort = useRemote<CohortData>(cohortUrl, { refresh, enabled: active && cohortUrl !== null && cohortFor === cohortUrl, fallback: 'Не вдалося завантажити когорти.' });

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

  const previousData = useMemo(() => (previous.data ? toPreviousWindow(previous.data) : null), [previous.data]);
  const refreshing = current.loading && data !== null;
  const chatPlatforms = useMemo(() => new Set(data?.chats.map((chat) => chat.platform) ?? []), [data]);
  // Клік на платформу ставить її фільтр у рейтингу чатів і гортає до нього.
  const showPlatformChats = (key: string) => {
    setChatPlatform(key);
    scrollToNode(rankingRef.current);
  };

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
            <span className="text-ink">{comparisonCaption(data.range.from, data.range.to, previousData?.range)}</span>
            {` · ${data.range.days} ${plural(data.range.days, 'день', 'дні', 'днів')}`}
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
                <InsightsCard className="@4xl:col-span-12" insights={data.insights} overview={overview.data} overviewError={Boolean(overview.error)} bookings={data.totals.bookings} previous={previousData} />
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
              <InsightsCard className="@4xl:col-span-4" insights={data.insights} overview={overview.data} overviewError={Boolean(overview.error)} bookings={data.totals.bookings} previous={previousData} />
              <PlatformsCard className="@4xl:col-span-12" platforms={data.platforms} previous={previousData?.platforms ?? null} period={period} chatPlatforms={chatPlatforms} onSelectPlatform={showPlatformChats} />
              <FunnelCard className="@4xl:col-span-6" data={data} />
              <SubjectsCard className="@4xl:col-span-6" data={data.subjects} />
              <div ref={rankingRef} className="min-w-0 @4xl:col-span-12"><ChatRanking chats={data.chats} platform={chatPlatform} onPlatformChange={setChatPlatform} /></div>
              <CohortCard className="@4xl:col-span-12" cohort={cohort.data} error={cohort.error} chats={data.chats} observeKey={cohortUrl} onVisible={() => setCohortFor(cohortUrl)} onRetry={reload} />
            </div>
          )}
        </div>
      ) : null}

      <MetricPanel metric={metric} query={query} onClose={() => setMetric(null)} />
    </div>
  );
}

/** «1–11 жовтня проти 1–11 вересня» у межах одного місяця; інакше — повні дати поточного й попереднього відрізків. */
function comparisonCaption(from: string, to: string, previous: { from: string; to: string } | undefined): string {
  const sameMonth = from.slice(0, 7) === to.slice(0, 7) && (!previous || previous.from.slice(0, 7) === previous.to.slice(0, 7));
  const current = sameMonth ? humanRange(from, to) : formatRange(from, to);
  if (!previous) return current;
  return `${current} проти ${sameMonth ? humanRange(previous.from, previous.to) : formatRange(previous.from, previous.to)}`;
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
