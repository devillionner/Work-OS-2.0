'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { AnalyticsInsights } from '@/components/analytics-insights';
import { AnalyticsTrends } from '@/components/analytics-trends';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

type AnalyticsPeriod = 'day' | 'week' | 'month' | 'year' | 'custom';
type PlatformRow = {
  key: string; name: string; color: string; joined: number; publications: number; responses: number;
  bookings: number; completed: number; publicationRate: number; responseRate: number; bookingRate: number; completionRate: number;
};
type CohortTotals = { leads:number; bookedLeads:number; bookings:number; completed:number; bookingLeadRate:number; completionRate:number };
type CohortPlatform = CohortTotals & { key:string; name:string; platform:string };
type CohortChat = CohortTotals & { id:string; name:string; platformName:string; platform:string };
type TrendPoint = { date:string; joined:number; publications:number; responses:number; bookings:number; completed:number };
type SubjectRow = { subject:string; responses:number; bookings:number; conversion:number; responseShare:number; bookingShare:number };
type SubjectData = { from:string; to:string; rows:SubjectRow[]; total:SubjectRow };
type AnalyticsInsightsData = {
  recommendation: { kind:'check_low_efficiency'|'consider_more_often'|'insufficient_data'; title:string; explanation:string; chatId:string|null; chatName:string|null };
  archiveReasons: Array<{ reason:string; count:number }>;
  archivedChats: number;
};
type AnalyticsData = {
  range: { period: string; days: number; from: string; to: string };
  totals: { joined: number; publications: number; responses: number; bookings: number; completed: number; publicationRate: number; responseRate: number; bookingRate: number; completionRate: number };
  platforms: PlatformRow[];
  chats: Array<{ id: string; name: string; platform: string; platformName: string; joined: number; publications: number; responses: number; bookings: number; publicationRate: number; responseRate: number; bookingRate: number }>;
  cohort: { totals:CohortTotals; platforms:CohortPlatform[]; chats:CohortChat[] };
  insights: AnalyticsInsightsData;
  trends: TrendPoint[];
  subjects: SubjectData;
};

const periods: Array<{ key: AnalyticsPeriod; label: string }> = [
  { key: 'day', label: 'День' },
  { key: 'week', label: 'Тиждень' },
  { key: 'month', label: 'Місяць' },
  { key: 'year', label: 'Рік' },
  { key: 'custom', label: 'Довільно' },
];

export function AnalyticsWorkspace() {
  const today = currentDate();
  const [period, setPeriod] = useState<AnalyticsPeriod>('month');
  const [customFrom, setCustomFrom] = useState(`${today.slice(0, 7)}-01`);
  const [customTo, setCustomTo] = useState(today);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const params = useCallback((format?: 'csv') => {
    const value = new URLSearchParams({ period });
    if (period === 'custom') {
      value.set('from', customFrom);
      value.set('to', customTo);
    }
    if (format) value.set('format', format);
    return value;
  }, [period, customFrom, customTo]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch(`/api/analytics?${params().toString()}`, { cache: 'no-store' });
      const body = await response.json() as AnalyticsData & { error?: string };
      if (!response.ok) throw new Error(body.error || 'Не вдалося завантажити аналітику.');
      setData(body);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не вдалося завантажити аналітику.');
    } finally { setLoading(false); }
  }, [params]);

  useEffect(() => { void load(); }, [load]);

  function exportCsv() {
    window.location.assign(`/api/analytics?${params('csv').toString()}`);
  }

  return (
    <div className="analytics-workspace">
      <section className="analytics-hero">
        <div>
          <p className="eyebrow">Рішення на основі даних</p>
          <h2>Аналітика роботи</h2>
          <p>Порівнюй активність за датою події та результат лідів, отриманих у вибраному періоді.</p>
        </div>
        <div className="analytics-controls">
          <div className="range-picker" role="group" aria-label="Період аналітики">
            {periods.map((item) => <button type="button" key={item.key} aria-pressed={period === item.key} onClick={() => setPeriod(item.key)}>{item.label}</button>)}
          </div>
          {period === 'custom' ? <div className="analytics-custom-range">
            <label>Від<input type="date" value={customFrom} max={customTo || today} onChange={(event) => setCustomFrom(event.target.value)} aria-label="Початок періоду" /></label>
            <label>До<input type="date" value={customTo} min={customFrom} max={today} onChange={(event) => setCustomTo(event.target.value)} aria-label="Кінець періоду" /></label>
          </div> : null}
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={loading || !data}><Download data-icon="inline-start" />CSV</Button>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw data-icon="inline-start" className={loading ? 'is-spinning' : undefined} />Оновити</Button>
        </div>
      </section>

      {error && <div className="workspace-error" role="alert">{error}</div>}
      {loading && !data ? <div className="workspace-loading"><RefreshCw className="is-spinning" /><span>Рахуємо показники…</span></div> : data ? <>
        <section className="analytics-metrics">
          <Metric label="Публікації" value={data.totals.publications} hint="за датою події" />
          <Metric label="Відгуки" value={data.totals.responses} hint={`${data.totals.responseRate}% від публікацій`} />
          <Metric label="Записи" value={data.totals.bookings} hint={`${data.totals.bookingRate}% від відгуків`} />
          <Metric label="Проведені уроки" value={data.totals.completed} hint={`${data.totals.completionRate}% від записів`} />
        </section>

        <AnalyticsInsights insights={data.insights} />
        <AnalyticsTrends points={data.trends} />
        <SubjectAnalytics data={data.subjects} />

        <section className="analytics-card">
          <div className="card-heading"><div><p className="eyebrow">Активність за датою події</p><h3>Де втрачається результат</h3></div><Badge variant="outline">{formatRange(data.range.from, data.range.to)}</Badge></div>
          <div className="funnel-grid">
            <FunnelStep title="Приєднані чати" value={data.totals.joined} detail="старт" />
            <FunnelStep title="Публікації" value={data.totals.publications} detail={`${data.totals.publicationRate}% від приєднань`} />
            <FunnelStep title="Відгуки" value={data.totals.responses} detail={`${data.totals.responseRate}% конверсія`} />
            <FunnelStep title="Записи" value={data.totals.bookings} detail={`${data.totals.bookingRate}% конверсія`} />
            <FunnelStep title="Проведені" value={data.totals.completed} detail={`${data.totals.completionRate}% доходимість`} />
          </div>
        </section>

        <section className="analytics-card">
          <div className="card-heading"><div><p className="eyebrow">Когорта лідів</p><h3>Що сталося з відгуками цього періоду</h3></div><Badge variant="outline">За датою отримання ліда</Badge></div>
          <div className="funnel-grid">
            <FunnelStep title="Ліди" value={data.cohort.totals.leads} detail="активні відгуки періоду" />
            <FunnelStep title="Ліди із записом" value={data.cohort.totals.bookedLeads} detail={`${data.cohort.totals.bookingLeadRate}% лідів`} />
            <FunnelStep title="Усі окремі записи" value={data.cohort.totals.bookings} detail="включно з пізнішими" />
            <FunnelStep title="Проведені" value={data.cohort.totals.completed} detail={`${data.cohort.totals.completionRate}% від записів`} />
          </div>
        </section>

        <section className="analytics-card">
          <div className="card-heading"><div><p className="eyebrow">Порівняння</p><h3>Результат за платформами</h3></div></div>
          <div className="analytics-table analytics-platform-table">
            <div className="analytics-table-head"><span>Платформа</span><span>Оголошення</span><span>Відгуки</span><span>Записи</span><span>Проведені</span><span>Відгук / огол.</span></div>
            {data.platforms.map((platform) => <div className="analytics-table-row" key={platform.key}><span className="platform-name"><i style={{ background: platform.color }} />{platform.name}</span><strong>{platform.publications}</strong><strong>{platform.responses}</strong><strong>{platform.bookings}</strong><strong>{platform.completed}</strong><span>{platform.responseRate}%</span></div>)}
            {!data.platforms.length && <div className="analytics-empty">За цей період ще немає подій.</div>}
          </div>
        </section>

        <section className="analytics-card">
          <div className="card-heading"><div><p className="eyebrow">Ефективність чатів</p><h3>Активність чатів за вибраними датами</h3></div><span className="muted-note">Показано до 100 чатів з активністю</span></div>
          <div className="analytics-table analytics-chat-table">
            <div className="analytics-table-head"><span>Чат</span><span>Платформа</span><span>Оголошення</span><span>Відгуки</span><span>Записи</span><span>Конверсія</span></div>
            {data.chats.map((chat) => <div className="analytics-table-row" key={chat.id}><span className="chat-analytics-name" title={chat.name}>{chat.name}</span><span>{chat.platformName}</span><strong>{chat.publications}</strong><strong>{chat.responses}</strong><strong>{chat.bookings}</strong><span>{chat.responseRate}%</span></div>)}
            {!data.chats.length && <div className="analytics-empty">Чати з активністю з’являться тут після роботи.</div>}
          </div>
        </section>

        <section className="analytics-card">
          <div className="card-heading"><div><p className="eyebrow">Джерела лідів</p><h3>Результат лідів за чатами-джерелами</h3></div><span className="muted-note">Пізні повторні записи лишаються за початковим чатом-джерелом</span></div>
          <div className="analytics-table analytics-chat-table">
            <div className="analytics-table-head"><span>Чат</span><span>Платформа</span><span>Ліди</span><span>Ліди із записом</span><span>Усі записи</span><span>Проведені</span></div>
            {data.cohort.chats.map((chat) => <div className="analytics-table-row" key={chat.id}><span className="chat-analytics-name" title={chat.name}>{chat.name}</span><span>{chat.platformName}</span><strong>{chat.leads}</strong><strong>{chat.bookedLeads}</strong><strong>{chat.bookings}</strong><span>{chat.completed}</span></div>)}
            {!data.cohort.chats.length && <div className="analytics-empty">Для лідів цього періоду ще немає атрибутованих чатів.</div>}
          </div>
        </section>
      </> : null}
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: number; hint: string }) {
  return <div className="analytics-metric"><span>{label}</span><strong>{value}</strong><small>{hint}</small></div>;
}

function FunnelStep({ title, value, detail }: { title: string; value: number; detail: string }) {
  return <div className="funnel-step"><span>{title}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function SubjectAnalytics({ data }: { data: SubjectData }) {
  return <section className="analytics-card analytics-subjects">
    <div className="card-heading"><div><p className="eyebrow">Напрямки попиту</p><h3>Предмети</h3><p className="muted-note analytics-card-note">Відгуки та записи за той самий вибраний період.</p></div><Badge variant="outline">{formatRange(data.from, data.to)}</Badge></div>
    <div className="subject-overview"><div><span>Відгуки</span><strong>{data.total.responses}</strong></div><div><span>Записи</span><strong>{data.total.bookings}</strong></div><div><span>Конверсія</span><strong>{data.total.conversion}%</strong></div></div>
    <div className="analytics-table analytics-subject-table"><div className="analytics-table-head"><span>Предмет</span><span>Відгуки</span><span>Записи</span><span>Конверсія</span></div>{data.rows.map((row) => <div className="analytics-table-row" key={row.subject}><strong>{row.subject}</strong><span>{row.responses}</span><span>{row.bookings}</span><span>{row.conversion}%</span></div>)}{!data.rows.length && <div className="analytics-empty">За цей період ще немає відгуків або записів.</div>}</div>
  </section>;
}

function formatRange(from: string, to: string) {
  return `${formatDate(from)} — ${formatDate(to)}`;
}

function formatDate(value: string) {
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
}

function currentDate() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
