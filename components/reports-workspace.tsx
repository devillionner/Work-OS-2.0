'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, FileText, RefreshCw, Save } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

type Report = { id: string; date: string; text: string; submittedAt: number | null; updatedAt: number; revisionCount: number };
type ReportData = { month: string; reports: Report[]; selected: Report | null; summary: Array<{ platform: string; eventType: string; count: number }> };
const platformNames: Record<string, string> = { telegram: 'Telegram', whatsapp: 'WhatsApp', viber: 'Viber', facebook: 'Facebook', threads: 'Threads', unknown: 'Інше' };

export function ReportsWorkspace() {
  const [month, setMonth] = useState(() => currentMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [data, setData] = useState<ReportData | null>(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const latestLoad = useRef(0);

  const load = useCallback(async (date = selectedDate, signal?: AbortSignal) => {
    const requestId = ++latestLoad.current;
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ month }); if (date) params.set('date', date);
      const response = await fetch(`/api/reports?${params}`, { cache: 'no-store', signal });
      const body = await response.json() as ReportData & { error?: string };
      if (requestId !== latestLoad.current || signal?.aborted) return;
      if (!response.ok) throw new Error(body.error || 'Не вдалося завантажити звіти.');
      setData(body); setText(body.selected?.text || '');
    } catch (reason) { if (requestId === latestLoad.current && !signal?.aborted) setError(reason instanceof Error ? reason.message : 'Не вдалося завантажити звіти.'); }
    finally { if (requestId === latestLoad.current && !signal?.aborted) setLoading(false); }
  }, [month, selectedDate]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => void load(selectedDate, controller.signal), 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [load, selectedDate]);

  const days = useMemo(() => monthDays(month), [month]);
  const reportByDate = useMemo(() => new Map((data?.reports || []).map((report) => [report.date, report])), [data]);
  const selected = selectedDate || data?.selected?.date || null;

  function chooseDate(date: string) { if (date === selectedDate || saving) return; latestLoad.current++; setData(null); setText(''); setLoading(true); setNotice(''); setSelectedDate(date); }
  function moveMonth(offset: number) { if (saving) return; latestLoad.current++; setData(null); setText(''); setLoading(true); setNotice(''); const next = shiftMonth(month, offset); setMonth(next); setSelectedDate(null); }
  async function save() {
    if (loading || saving) return;
    if (!selected || !text.trim()) { setError('Оберіть дату та додайте текст звіту.'); return; }
    setSaving(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: selected, text, submitted: true }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || 'Не вдалося зберегти звіт.');
      setNotice('Звіт збережено.'); await load(selected);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не вдалося зберегти звіт.'); }
    finally { setSaving(false); }
  }

  return <div className="reports-workspace">
    <section className="reports-hero"><div><p className="eyebrow">Контроль результату</p><h2>Історія звітів</h2><p>Обирай день у календарі, переглядай показники та коригуй звіт без втрати дат.</p></div><Button variant="outline" size="sm" onClick={() => void load()} disabled={loading || saving}><RefreshCw data-icon="inline-start" className={loading ? 'is-spinning' : undefined} />Оновити</Button></section>
    {error && <div className="workspace-error" role="alert">{error}</div>}
    {notice && <output className="reports-notice">{notice}</output>}
    <div className="reports-layout">
      <section className="reports-calendar-card"><div className="reports-month-head"><Button variant="ghost" size="icon" aria-label="Попередній місяць" onClick={() => moveMonth(-1)}><ChevronLeft /></Button><h3>{formatMonth(month)}</h3><Button variant="ghost" size="icon" aria-label="Наступний місяць" onClick={() => moveMonth(1)}><ChevronRight /></Button></div><div className="reports-weekdays">{['Пн','Вт','Ср','Чт','Пт','Сб','Нд'].map((day) => <span key={day}>{day}</span>)}</div><div className="reports-calendar-grid">{days.map((day) => { const report = reportByDate.get(day.date); const revision = report?.revisionCount || 0; return <button key={day.date} type="button" className={`report-day ${day.isCurrentMonth ? '' : 'is-muted'} ${selected === day.date ? 'is-selected' : ''} ${report ? 'has-report' : ''} ${report?.submittedAt ? 'is-submitted' : ''} ${revision >= 3 ? 'is-revised-heavy' : revision === 2 ? 'is-revised' : ''}`} title={report ? `Редакцій: ${revision}` : 'Додати звіт'} onClick={() => chooseDate(day.date)}><span>{day.day}</span>{report && <i aria-label="Є звіт" />}</button>; })}</div><div className="reports-legend"><span><i className="legend-dot is-submitted" />Здано</span><span><i className="legend-dot has-report" />Є чернетка або зміни</span><span><i className="legend-dot is-revised" />Редагувався повторно</span></div></section>
      <section className="reports-editor-card">{loading ? <div className="workspace-loading">Завантажуємо звіт…</div> : selected ? <><div className="card-heading"><div><p className="eyebrow">Звіт за день</p><h3>{formatDate(selected)}</h3></div>{data?.selected?.submittedAt ? <Badge variant="secondary">Здано</Badge> : <Badge variant="outline">Немає звіту</Badge>}</div><Textarea disabled={saving} value={text} onChange={(event) => setText(event.target.value)} placeholder="Встав текст щоденного звіту або внеси коригування…" rows={14} /><div className="reports-editor-footer"><span className="muted-note">Остання зміна: {data?.selected ? formatTime(data.selected.updatedAt) : 'ще не створено'}</span><Button onClick={() => void save()} disabled={loading || saving || !text.trim()}><Save data-icon="inline-start" />{saving ? 'Зберігаємо…' : 'Зберегти звіт'}</Button></div>{data?.summary.length ? <Summary summary={data.summary} /> : null}</> : <div className="workspace-empty"><FileText /><strong>Оберіть дату</strong><p>Дні зі звітом позначені синім.</p></div>}</section>
    </div>
  </div>;
}

function Summary({ summary }: { summary: ReportData['summary'] }) { const grouped = new Map<string, Record<string, number>>(); for (const row of summary) { const current = grouped.get(row.platform) || {}; current[row.eventType] = (current[row.eventType] || 0) + row.count; grouped.set(row.platform, current); } return <div className="report-summary"><p className="eyebrow">Події в базі за цей день</p>{Array.from(grouped).map(([platform, values]) => <div key={platform}><strong>{platformNames[platform] || platform}</strong><span>Оголошення: {values.publication || 0}</span><span>Відгуки: {values.lead_created || 0}</span><span>Записи: {(values.lesson_booked || 0) + (values.curator_booking_pending || 0)}</span></div>)}</div>; }
function currentMonth() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit' }).format(new Date()); }
function monthDays(month: string) { const [year, monthNumber] = month.split('-').map(Number); const first = new Date(Date.UTC(year, monthNumber - 1, 1)); const count = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate(); const start = (first.getUTCDay() + 6) % 7; return Array.from({ length: start + count }, (_, index) => { const day = index - start + 1; const date = new Date(Date.UTC(year, monthNumber - 1, day)); return { day: date.getUTCDate(), date: date.toISOString().slice(0, 10), isCurrentMonth: day >= 1 && day <= count }; }); }
function shiftMonth(month: string, offset: number) { const [year, monthNumber] = month.split('-').map(Number); const date = new Date(Date.UTC(year, monthNumber - 1 + offset, 1)); return date.toISOString().slice(0, 7); }
function formatMonth(month: string) { const [year, monthNumber] = month.split('-').map(Number); return new Intl.DateTimeFormat('uk-UA', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, monthNumber - 1, 1))).replace(/^./, (value) => value.toUpperCase()); }
function formatDate(value: string) { const [year, month, day] = value.split('-'); return `${day}.${month}.${year}`; }
function formatTime(value: number) { return new Intl.DateTimeFormat('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' }).format(new Date(value * 1000)); }
