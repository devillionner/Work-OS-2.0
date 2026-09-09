'use client';

import { useCallback, useEffect, useState } from 'react';
import { BarChart3, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

type PlatformRow = {
  key: string; name: string; color: string; publications: number; responses: number;
  bookings: number; completed: number; responseRate: number; bookingRate: number; completionRate: number;
};
type AnalyticsData = {
  range: { days: number; from: string; to: string };
  totals: { publications: number; responses: number; bookings: number; completed: number; responseRate: number; bookingRate: number; completionRate: number };
  platforms: PlatformRow[];
  chats: Array<{ id: string; name: string; platform: string; platformName: string; publications: number; responses: number; bookings: number; responseRate: number; bookingRate: number }>;
};

const ranges = [
  { days: 7, label: '7 днів' },
  { days: 30, label: '30 днів' },
  { days: 90, label: '90 днів' },
];

export function AnalyticsWorkspace() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch(`/api/analytics?range=${days}`, { cache: 'no-store' });
      const body = await response.json() as AnalyticsData & { error?: string };
      if (!response.ok) throw new Error(body.error || 'Не вдалося завантажити аналітику.');
      setData(body);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не вдалося завантажити аналітику.');
    } finally { setLoading(false); }
  }, [days]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="analytics-workspace">
      <section className="analytics-hero">
        <div>
          <p className="eyebrow">Рішення на основі даних</p>
          <h2>Аналітика роботи</h2>
          <p>Порівнюй платформи й чати за одним зрозумілим воронковим показником.</p>
        </div>
        <div className="analytics-controls">
          <div className="range-picker" role="group" aria-label="Період аналітики">
            {ranges.map((range) => <button type="button" key={range.days} aria-pressed={days === range.days} onClick={() => setDays(range.days)}>{range.label}</button>)}
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw data-icon="inline-start" className={loading ? 'is-spinning' : undefined} />Оновити</Button>
        </div>
      </section>

      {error && <div className="workspace-error" role="alert">{error}</div>}
      {loading && !data ? <div className="workspace-loading"><RefreshCw className="is-spinning" /><span>Рахуємо показники…</span></div> : data ? <>
        <section className="analytics-metrics">
          <Metric label="Публікації" value={data.totals.publications} hint="у вибраному періоді" />
          <Metric label="Відгуки" value={data.totals.responses} hint={`${data.totals.responseRate}% від публікацій`} />
          <Metric label="Записи" value={data.totals.bookings} hint={`${data.totals.bookingRate}% від відгуків`} />
          <Metric label="Проведені уроки" value={data.totals.completed} hint={`${data.totals.completionRate}% від записів`} />
        </section>

        <section className="analytics-card">
          <div className="card-heading"><div><p className="eyebrow">Воронка</p><h3>Де втрачається результат</h3></div><Badge variant="outline">{formatRange(data.range.from, data.range.to)}</Badge></div>
          <div className="funnel-grid">
            <FunnelStep title="Публікації" value={data.totals.publications} detail="старт" />
            <FunnelStep title="Відгуки" value={data.totals.responses} detail={`${data.totals.responseRate}% конверсія`} />
            <FunnelStep title="Записи" value={data.totals.bookings} detail={`${data.totals.bookingRate}% конверсія`} />
            <FunnelStep title="Проведені" value={data.totals.completed} detail={`${data.totals.completionRate}% доходимість`} />
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
          <div className="card-heading"><div><p className="eyebrow">Ефективність чатів</p><h3>Чати, які дають результат</h3></div><span className="muted-note">Показано до 100 чатів з публікаціями</span></div>
          <div className="analytics-table analytics-chat-table">
            <div className="analytics-table-head"><span>Чат</span><span>Платформа</span><span>Оголошення</span><span>Відгуки</span><span>Записи</span><span>Конверсія</span></div>
            {data.chats.map((chat) => <div className="analytics-table-row" key={chat.id}><span className="chat-analytics-name" title={chat.name}>{chat.name}</span><span>{chat.platformName}</span><strong>{chat.publications}</strong><strong>{chat.responses}</strong><strong>{chat.bookings}</strong><span>{chat.responseRate}%</span></div>)}
            {!data.chats.length && <div className="analytics-empty">Чати з публікаціями з’являться тут після роботи.</div>}
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

function formatRange(from: string, to: string) {
  return `${formatDate(from)} — ${formatDate(to)}`;
}

function formatDate(value: string) {
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
}
