'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, FileText, History, RefreshCw, Save } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ReportHistoryDialog } from '@/components/report-history-dialog';
import { ReportCheckpoints } from '@/components/report-checkpoints';
import type { ReportEventDetail } from '@/lib/reports/details';

type Report = { id: string; date: string; text: string; submittedAt: number | null; updatedAt: number; revisionCount: number; stale: boolean };
type SubjectRow = { subject:string; responses:number; bookings:number; conversion:number; responseShare:number; bookingShare:number };
type SubjectData = { period:'day'|'7'|'30'|'month'|'all'; from:string|null; to:string; rows:SubjectRow[]; total:SubjectRow };
type ReportData = { month: string; reports: Report[]; selected: Report | null; summary: Array<{ platform: string; eventType: string; count: number }>; details: ReportEventDetail[]; subjects: SubjectData | null; previousReportReminder: { date:string; pending:boolean }; finalReportState: { canSubmit:boolean; reason:string|null } | null };
const platformNames: Record<string, string> = { telegram: 'Telegram', whatsapp: 'WhatsApp', viber: 'Viber', facebook: 'Facebook', threads: 'Threads', unknown: 'Інше' };

export function ReportsWorkspace({ onOpenLead }: { onOpenLead?: (leadId: string) => void } = {}) {
  const [month, setMonth] = useState(() => currentMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [data, setData] = useState<ReportData | null>(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [subjectPeriod, setSubjectPeriod] = useState<'day'|'7'|'30'|'month'|'all'>('day');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const latestLoad = useRef(0);

  const load = useCallback(async (date = selectedDate, signal?: AbortSignal) => {
    const requestId = ++latestLoad.current;
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ month, subjectPeriod }); if (date) params.set('date', date);
      const response = await fetch(`/api/reports?${params}`, { cache: 'no-store', signal });
      const body = await response.json() as ReportData & { error?: string };
      if (requestId !== latestLoad.current || signal?.aborted) return;
      if (!response.ok) throw new Error(body.error || 'Не вдалося завантажити звіти.');
      setData(body); setText(body.selected?.text || '');
    } catch (reason) { if (requestId === latestLoad.current && !signal?.aborted) setError(reason instanceof Error ? reason.message : 'Не вдалося завантажити звіти.'); }
    finally { if (requestId === latestLoad.current && !signal?.aborted) setLoading(false); }
  }, [month, selectedDate, subjectPeriod]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => void load(selectedDate, controller.signal), 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [load, selectedDate]);

  const today = currentDate();
  const days = useMemo(() => monthDays(month, today), [month, today]);
  const reportByDate = useMemo(() => new Map((data?.reports || []).map((report) => [report.date, report])), [data]);
  const selected = selectedDate || data?.selected?.date || null;

  const chooseDate = useCallback((date: string) => {
    if (date > today || date === selectedDate || saving) return;
    latestLoad.current++; setData(null); setText(''); setLoading(true); setNotice('');
    if (date.slice(0, 7) !== month) setMonth(date.slice(0, 7));
    setSelectedDate(date);
  }, [month, saving, selectedDate, today]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
      event.preventDefault();
      if (saving) return;
      const base = selected || today;
      const next = shiftDay(base, event.key === 'ArrowLeft' ? -1 : 1);
      if (next > today) return;
      chooseDate(next);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [chooseDate, saving, selected, today]);

  function moveMonth(offset: number) { if (saving) return; latestLoad.current++; setData(null); setText(''); setLoading(true); setNotice(''); const next = shiftMonth(month, offset); setMonth(next); setSelectedDate(null); }
  async function save(submitted = false) {
    if (loading || saving) return;
    if (!selected || !text.trim()) { setError('Оберіть дату та додайте текст звіту.'); return; }
    if (selected > today) { setError('Майбутні звіти недоступні.'); return; }
    setSaving(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: selected, text, submitted }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || 'Не вдалося зберегти звіт.');
      setNotice(submitted ? 'Фінальний звіт здано.' : 'Чернетку звіту збережено.'); await load(selected);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не вдалося зберегти звіт.'); }
    finally { setSaving(false); }
  }

  return <div className="reports-workspace">
    <section className="reports-hero"><div><p className="eyebrow">Контроль результату</p><h2>Історія звітів</h2><p>Обирай день у календарі, переглядай показники та коригуй звіт без втрати дат.</p></div><div className="reports-hero-actions"><Button variant="outline" size="sm" onClick={() => chooseDate(today)} disabled={loading || saving || selected === today}>Сьогодні</Button><Button variant="outline" size="sm" onClick={() => void load()} disabled={loading || saving}><RefreshCw data-icon="inline-start" className={loading ? 'is-spinning' : undefined} />Оновити</Button></div></section>
    {error && <div className="workspace-error" role="alert">{error}</div>}
    {notice && <output className="reports-notice">{notice}</output>}
    {data?.previousReportReminder?.pending && <output className="workspace-error">{`\u041d\u0435 \u0437\u0434\u0430\u043d\u043e \u0444\u0456\u043d\u0430\u043b\u044c\u043d\u0438\u0439 \u0437\u0432\u0456\u0442 \u0437\u0430 ${formatDate(data.previousReportReminder.date)}. \u0412\u0456\u0434\u043a\u0440\u0438\u0439 \u0446\u0435\u0439 \u0434\u0435\u043d\u044c \u0443 \u043a\u0430\u043b\u0435\u043d\u0434\u0430\u0440\u0456 \u0442\u0430 \u0437\u0430\u0432\u0435\u0440\u0448\u0438 \u0437\u0432\u0456\u0442.`}</output>}
    <div className="reports-layout">
      <section className="reports-calendar-card"><div className="reports-month-head"><Button variant="ghost" size="icon" aria-label="Попередній місяць" onClick={() => moveMonth(-1)}><ChevronLeft /></Button><h3>{formatMonth(month)}</h3><Button variant="ghost" size="icon" aria-label="Наступний місяць" onClick={() => moveMonth(1)} disabled={saving || month >= today.slice(0, 7)}><ChevronRight /></Button></div><div className="reports-weekdays">{['Пн','Вт','Ср','Чт','Пт','Сб','Нд'].map((day) => <span key={day}>{day}</span>)}</div><div className="reports-calendar-grid">{days.map((day) => { const report = reportByDate.get(day.date); const revision = report?.revisionCount || 0; return <button key={day.date} type="button" disabled={day.isFuture} className={`report-day ${day.isCurrentMonth ? '' : 'is-muted'} ${day.isFuture ? 'is-future' : ''} ${selected === day.date ? 'is-selected' : ''} ${report ? 'has-report' : ''} ${report?.submittedAt ? 'is-submitted' : ''} ${report?.stale ? 'is-stale' : ''} ${revision >= 3 ? 'is-revised-heavy' : revision === 2 ? 'is-revised' : ''}`} title={day.isFuture ? 'Майбутня дата недоступна' : report ? `${report.stale ? 'Застарілий звіт · ' : ''}Редакцій: ${revision}` : 'Додати звіт'} onClick={() => chooseDate(day.date)}><span>{day.day}</span>{report && <i aria-label={report.stale ? 'Застарілий звіт' : 'Є звіт'} />}</button>; })}</div><div className="reports-legend"><span><i className="legend-dot is-submitted" />Здано</span><span><i className="legend-dot is-stale" />Потребує оновлення</span><span><i className="legend-dot has-report" />Є чернетка або зміни</span><span><i className="legend-dot is-revised" />Редагувався повторно</span></div></section>
      <section className="reports-editor-card">{loading ? <div className="workspace-loading">Завантажуємо звіт…</div> : selected ? <><div className="card-heading"><div><p className="eyebrow">Звіт за день</p><h3>{formatDate(selected)}</h3></div><div className="reports-editor-actions"><Button variant="outline" size="sm" onClick={() => setHistoryOpen(true)} disabled={saving}><History data-icon="inline-start" />Версії</Button>{data?.selected?.stale ? <Badge variant="outline">Потребує оновлення</Badge> : data?.selected?.submittedAt ? <Badge variant="secondary">Здано</Badge> : data?.selected ? <Badge variant="outline">Чернетка</Badge> : <Badge variant="outline">Немає звіту</Badge>}</div></div><Textarea disabled={saving} value={text} onChange={(event) => setText(event.target.value)} placeholder="Встав текст щоденного звіту або внеси коригування…" rows={14} /><div className="reports-editor-footer"><span className="muted-note">Остання зміна: {data?.selected ? formatTime(data.selected.updatedAt) : 'ще не створено'}</span><div className="reports-editor-actions"><Button variant="outline" onClick={() => void save(false)} disabled={loading || saving || !text.trim()}><Save data-icon="inline-start" />{saving ? 'Зберігаємо…' : 'Зберегти чернетку'}</Button><Button onClick={() => void save(true)} disabled={loading || saving || !text.trim() || !data?.finalReportState?.canSubmit}>{saving ? 'Здаємо…' : data?.selected?.submittedAt ? 'Здати оновлення' : 'Здати фінальний'}</Button></div></div>{data?.finalReportState && !data.finalReportState.canSubmit && <p className="muted-note">{data.finalReportState.reason}</p>}{data?.summary.length ? <Summary summary={data.summary} /> : null}{data?.details?.length ? <ReportEventDetails details={data.details} onOpenLead={onOpenLead} /> : null}<ReportCheckpoints date={selected} /><SubjectAnalyticsTable data={data?.subjects || null} period={subjectPeriod} onPeriod={setSubjectPeriod} /></> : <div className="workspace-empty"><FileText /><strong>Оберіть дату</strong><p>Дні зі звітом позначені синім.</p></div>}</section>
    </div>
    <ReportHistoryDialog open={historyOpen} date={selected} onClose={() => setHistoryOpen(false)} onRestored={() => { setNotice('Версію відновлено як нову.'); void load(selected); }} />
  </div>;
}

function Summary({ summary }: { summary: ReportData['summary'] }) { const grouped = new Map<string, Record<string, number>>(); for (const row of summary) { const current = grouped.get(row.platform) || {}; current[row.eventType] = (current[row.eventType] || 0) + row.count; grouped.set(row.platform, current); } return <div className="report-summary"><p className="eyebrow">Події в базі за цей день</p>{Array.from(grouped).map(([platform, values]) => <div key={platform}><strong>{platformNames[platform] || platform}</strong><span>Оголошення: {values.publication || 0}</span><span>Відгуки: {values.lead_created || 0}</span><span>Записи: {(values.lesson_booked || 0) + (values.curator_booking_pending || 0)}</span></div>)}</div>; }
function ReportEventDetails({ details, onOpenLead }: { details: ReportEventDetail[]; onOpenLead?: (leadId: string) => void }) {
  const responses = details.filter((event) => event.eventType === 'lead_created');
  const bookings = details.filter((event) => event.eventType === 'lesson_booked' || event.eventType === 'curator_booking_pending');
  return <section className="report-event-details" aria-label="Деталізація подій"><div className="report-event-details-head"><p className="eyebrow">Деталізація подій</p><span>Показано: {details.length}</span></div><div className="report-event-columns"><EventList title="Відгуки" events={responses} onOpenLead={onOpenLead} /><EventList title="Записи" events={bookings} onOpenLead={onOpenLead} /></div></section>;
}
function EventList({ title, events, onOpenLead }: { title: string; events: ReportEventDetail[]; onOpenLead?: (leadId: string) => void }) {
  return <div className="report-event-list"><h4>{title} <span>{events.length}</span></h4>{events.length ? <ul>{events.map((event) => <li key={event.id}><div><strong>{event.leadName || 'Лід недоступний'}</strong><span>{platformNames[event.platform || 'unknown'] || event.platform || 'Платформа не вказана'} · {event.eventType === 'lead_created' ? event.leadSubject || 'Предмет не вказано' : event.lessonSubject || event.leadSubject || 'Предмет не вказано'}</span></div>{event.leadId && onOpenLead ? <Button type="button" variant="ghost" size="sm" onClick={() => onOpenLead(event.leadId!)}>Відкрити</Button> : null}</li>)}</ul> : <p className="muted-note">Немає активних подій.</p>}</div>;
}

function SubjectAnalyticsTable({ data, period, onPeriod }: { data: SubjectData | null; period: SubjectData['period']; onPeriod: (period: SubjectData['period']) => void }) {
  const periods: Array<[SubjectData['period'], string]> = [['day','\u0414\u0435\u043d\u044c'],['7','7 \u0434\u043d\u0456\u0432'],['30','30 \u0434\u043d\u0456\u0432'],['month','\u041c\u0456\u0441\u044f\u0446\u044c'],['all','\u0412\u0435\u0441\u044c \u0447\u0430\u0441']];
  if (!data) return null;
  return <section className="report-subjects"><div className="report-event-details-head"><div><p className="eyebrow">{'\u041f\u0440\u0435\u0434\u043c\u0435\u0442\u0438'}</p><strong>{'\u0412\u0456\u0434\u0433\u0443\u043a\u0438 \u2192 \u0437\u0430\u043f\u0438\u0441\u0438'}</strong></div><div className="reports-periods">{periods.map(([key,label]) => <Button key={key} type="button" size="sm" variant={period===key?'secondary':'ghost'} onClick={() => onPeriod(key)}>{label}</Button>)}</div></div><div className="report-subject-table"><div className="report-subject-row is-head"><span>{'\u041f\u0440\u0435\u0434\u043c\u0435\u0442'}</span><span>{'\u0412\u0456\u0434\u0433\u0443\u043a\u0438'}</span><span>{'\u0417\u0430\u043f\u0438\u0441\u0438'}</span><span>{'\u041a\u043e\u043d\u0432\u0435\u0440\u0441\u0456\u044f'}</span><span>{'\u0427\u0430\u0441\u0442\u043a\u0430 \u0432\u0456\u0434\u0433\u0443\u043a\u0456\u0432'}</span><span>{'\u0427\u0430\u0441\u0442\u043a\u0430 \u0437\u0430\u043f\u0438\u0441\u0456\u0432'}</span></div>{[...data.rows,data.total].map((row) => <div key={row.subject} className={`report-subject-row ${row.subject==='\u0423\u0441\u044c\u043e\u0433\u043e'?'is-total':''}`}><strong>{row.subject}</strong><span>{row.responses}</span><span>{row.bookings}</span><span>{row.conversion}%</span><span>{row.responseShare}%</span><span>{row.bookingShare}%</span></div>)}</div></section>;
}

function currentMonth() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit' }).format(new Date()); }
function currentDate() { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()); const values = Object.fromEntries(parts.map((part) => [part.type, part.value])); return `${values.year}-${values.month}-${values.day}`; }
function monthDays(month: string, today: string) { const [year, monthNumber] = month.split('-').map(Number); const first = new Date(Date.UTC(year, monthNumber - 1, 1)); const count = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate(); const start = (first.getUTCDay() + 6) % 7; return Array.from({ length: start + count }, (_, index) => { const day = index - start + 1; const date = new Date(Date.UTC(year, monthNumber - 1, day)); const dateValue = date.toISOString().slice(0, 10); return { day: date.getUTCDate(), date: dateValue, isCurrentMonth: day >= 1 && day <= count, isFuture: dateValue > today }; }); }
function shiftDay(value: string, offset: number) { const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + offset); return date.toISOString().slice(0, 10); }
function shiftMonth(month: string, offset: number) { const [year, monthNumber] = month.split('-').map(Number); const date = new Date(Date.UTC(year, monthNumber - 1 + offset, 1)); return date.toISOString().slice(0, 7); }
function formatMonth(month: string) { const [year, monthNumber] = month.split('-').map(Number); return new Intl.DateTimeFormat('uk-UA', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, monthNumber - 1, 1))).replace(/^./, (value) => value.toUpperCase()); }
function formatDate(value: string) { const [year, month, day] = value.split('-'); return `${day}.${month}.${year}`; }
function formatTime(value: number) { return new Intl.DateTimeFormat('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' }).format(new Date(value * 1000)); }
