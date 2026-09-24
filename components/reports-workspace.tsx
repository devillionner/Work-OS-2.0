'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Copy, ExternalLink, FileText, History, RefreshCw, Save, UserPlus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { LeadEditor } from '@/components/leads/lead-editor';
import { createBrowserCommandClient } from '@/components/leads/client';
import { ReportHistoryDialog } from '@/components/report-history-dialog';
import { ReportCheckpoints } from '@/components/report-checkpoints';
import { ReportCalendarContext } from '@/components/report-calendar-context';
import { WorkspaceInitialLoading, WorkspaceRefreshIndicator } from '@/components/workspace-load-state';
import { ADMIN_REPORT_FORM_URL, MANAGER_SCHEDULE_URL } from '@/lib/reports/form';
import type { CalendarDayContext } from '@/lib/reports/calendar-context';
import { calendarContextLabels } from '@/lib/reports/calendar-labels';
import { reportRevisionHeatClass } from '@/lib/reports/calendar-heatmap';
import type { ReportEventDetail } from '@/lib/reports/details';

type Report = { id: string; date: string; text: string; submittedAt: number | null; updatedAt: number; revisionCount: number; submissionCount: number; stale: boolean };
type CalendarFilter = 'all' | 'has-report' | 'missing' | 'stale' | 'resubmitted';
type GoalPlanFact = { dailyTarget:number; dailyActual:number; monthlyTarget:number; monthlyActual:number };
type ReportData = { month: string; reports: Report[]; calendarContext: CalendarDayContext[]; selected: Report | null; suggestedText: string; summary: Array<{ platform: string; eventType: string; count: number }>; details: ReportEventDetail[]; previousReportReminder: { date:string; pending:boolean }; finalReportState: { canSubmit:boolean; reason:string|null } | null; goalPlanFact: GoalPlanFact | null; leadCommandScope: string };
const platformNames: Record<string, string> = { telegram: 'Telegram', whatsapp: 'WhatsApp', viber: 'Viber', facebook: 'Facebook', threads: 'Threads', unknown: 'Інше' };
const calendarFilters: Array<{ value: CalendarFilter; label: string }> = [
  { value:'all', label:'Усі' },
  { value:'has-report', label:'Є звіт' },
  { value:'missing', label:'Немає' },
  { value:'stale', label:'Застарілий' },
  { value:'resubmitted', label:'Здано повторно' },
];

export function ReportsWorkspace({ onOpenLead, syncRevision=0, active=true }: { onOpenLead?: (leadId: string) => void; syncRevision?:number; active?:boolean } = {}) {
  const [month, setMonth] = useState(() => currentMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [data, setData] = useState<ReportData | null>(null);
  const [dataKey, setDataKey] = useState('');
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const reportHistoryTrigger = useRef<HTMLButtonElement>(null);
  const [backdatedLeadOpen, setBackdatedLeadOpen] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reportConflict, setReportConflict] = useState(false);
  const [calendarFilter, setCalendarFilter] = useState<CalendarFilter>('all');
  const latestLoad = useRef(0);
  const leadCommandScopeRef = useRef<string | null>(null);
  const leadCommandRef = useRef<ReturnType<typeof createBrowserCommandClient> | null>(null);
  const dataCache = useRef(new Map<string,ReportData>());
  const lastSyncRevision = useRef(syncRevision);

  const load = useCallback(async (date = selectedDate, signal?: AbortSignal) => {
    const requestId = ++latestLoad.current;
    const key=reportViewKey(month,date);
    const cached=dataCache.current.get(key);
    if(cached){
      setData(cached);setDataKey(key);setText(cached.selected?.text||cached.suggestedText||'');
    }
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ month }); if (date) params.set('date', date);
      const response = await fetch(`/api/reports?${params}`, { cache: 'no-store', signal });
      const body = await response.json() as ReportData & { error?: string };
      if (requestId !== latestLoad.current || signal?.aborted) return;
      if (!response.ok) throw new Error(body.error || 'Не вдалося завантажити звіти.');
      if (leadCommandScopeRef.current !== body.leadCommandScope) {
        leadCommandScopeRef.current = body.leadCommandScope;
        leadCommandRef.current = createBrowserCommandClient(body.leadCommandScope);
      }
      dataCache.current.set(key,body); setData(body); setDataKey(key); setText(body.selected?.text || body.suggestedText || ''); setReportConflict(false);
    } catch (reason) { if (requestId === latestLoad.current && !signal?.aborted) setError(reason instanceof Error ? reason.message : 'Не вдалося завантажити звіти.'); }
    finally { if (requestId === latestLoad.current && !signal?.aborted) setLoading(false); }
  }, [month, selectedDate]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => void load(selectedDate, controller.signal), 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [load, selectedDate]);
  useEffect(() => {
    if (!active) {
      setHistoryOpen(false);
      setBackdatedLeadOpen(false);
    }
  }, [active]);
  useEffect(() => {
    if (!active || lastSyncRevision.current === syncRevision) return;
    lastSyncRevision.current = syncRevision;
    dataCache.current.clear();
    void load(selectedDate);
  }, [active, syncRevision, load, selectedDate]);

  const today = currentDate();
  const days = useMemo(() => monthDays(month, today), [month, today]);
  const currentKey=reportViewKey(month,selectedDate);
  const editorData=dataKey===currentKey?data:null;
  const calendarData=data?.month===month?data:null;
  const reportByDate = useMemo(() => new Map((calendarData?.reports || []).map((report) => [report.date, report])), [calendarData]);
  const contextByDate = useMemo(() => new Map((calendarData?.calendarContext || []).map((context) => [context.date, context])), [calendarData]);
  const selected = selectedDate || editorData?.selected?.date || null;

  const chooseDate = useCallback((date: string) => {
    if (date > today || date === selectedDate || saving) return;
    latestLoad.current++; setLoading(true); setNotice(''); setReportConflict(false);
    const nextMonth=date.slice(0,7);
    const cached=dataCache.current.get(reportViewKey(nextMonth,date));
    if(cached){setData(cached);setDataKey(reportViewKey(nextMonth,date));setText(cached.selected?.text||cached.suggestedText||'');}
    if (nextMonth !== month) setMonth(nextMonth);
    setSelectedDate(date);
  }, [month, saving, selectedDate, today]);

  useEffect(() => {
    if(!active)return;
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
  }, [active, chooseDate, saving, selected, today]);

  function moveMonth(offset: number) {
    if (saving) return;
    latestLoad.current++; setLoading(true); setNotice(''); setReportConflict(false);
    const next=shiftMonth(month,offset);
    const cached=dataCache.current.get(reportViewKey(next,null));
    if(cached){setData(cached);setDataKey(reportViewKey(next,null));setText(cached.selected?.text||cached.suggestedText||'');}
    setMonth(next);setSelectedDate(null);
  }
  async function save(submitted = false) {
    if (loading || saving || reportConflict) return;
    if (!selected || !text.trim()) { setError('Оберіть дату та додайте текст звіту.'); return; }
    if (selected > today) { setError('Майбутні звіти недоступні.'); return; }
    setSaving(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: selected, text, submitted, expectedRevision: editorData?.selected?.revisionCount ?? 0 }) });
      const body = await response.json() as { error?: string; currentRevision?: number };
      if (!response.ok) {
        if (response.status === 409 && typeof body.currentRevision === 'number') setReportConflict(true);
        throw new Error(body.error || 'Не вдалося зберегти звіт.');
      }
      setNotice(submitted ? 'Фінальний звіт здано.' : 'Чернетку звіту збережено.'); await load(selected);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не вдалося зберегти звіт.'); }
    finally { setSaving(false); }
  }

  async function copyReport() {
    if (!text.trim()) return;
    try { await navigator.clipboard.writeText(text); setNotice('Текст звіту скопійовано.'); }
    catch { setError('Не вдалося скопіювати текст звіту.'); }
  }

  async function createBackdatedLead(leadData: Record<string, unknown>) {
    const leadCommand = leadCommandRef.current;
    if (!selected || !leadCommand) throw new Error('Не вдалося визначити дату або власника CRM. Оновіть звіт.');
    const id = await leadCommand('create', leadData);
    setBackdatedLeadOpen(false);
    setNotice(`Ліда додано до ${formatDate(selected)}.`);
    onOpenLead?.(id);
  }

  return <div className={`reports-workspace ${selectedDate ? 'has-selected-day' : ''}`} aria-busy={loading}>
    <WorkspaceRefreshIndicator active={loading&&data!==null} label="Оновлюємо звіти…" />
    <section className="reports-hero"><div><p className="eyebrow">Контроль результату</p><h2>Історія звітів</h2><p>Обирай день у календарі, переглядай показники та коригуй звіт без втрати дат.</p><p className="muted-note">Форма адміністраторів відкривається вручну — Work OS не відправляє її автоматично.</p></div><div className="reports-hero-actions"><div className="reports-external-actions"><a className="report-form-link" href={MANAGER_SCHEDULE_URL} target="_blank" rel="noopener noreferrer"><ExternalLink />Графік керівника</a><a className="report-form-link" href={ADMIN_REPORT_FORM_URL} target="_blank" rel="noopener noreferrer"><ExternalLink />Відкрити форму адміністраторів</a></div><div className="reports-date-actions"><Button variant="outline" size="sm" onClick={() => chooseDate(today)} disabled={loading || saving || selected === today}>Сьогодні</Button><Button variant="outline" size="sm" onClick={() => void load()} disabled={loading || saving}><RefreshCw data-icon="inline-start" className={loading ? 'is-spinning' : undefined} />Оновити</Button></div></div></section>
    {error && <div className="workspace-error" role="alert">{error}{reportConflict ? ' Локальний текст залишено без змін. Скопіюйте його за потреби та натисніть «Оновити», щоб завантажити актуальну версію.' : ''}</div>}
    {notice && <output className="reports-notice">{notice}</output>}
    {calendarData?.previousReportReminder?.pending && <output className="workspace-error">{`Не здано фінальний звіт за ${formatDate(calendarData.previousReportReminder.date)}. Відкрий цей день у календарі та заверши звіт.`}</output>}
    <div className="reports-layout">
      <section className="reports-calendar-card"><div className="reports-month-head"><Button variant="ghost" size="icon" aria-label="Попередній місяць" onClick={() => moveMonth(-1)}><ChevronLeft /></Button><h3>{formatMonth(month)}</h3><Button variant="ghost" size="icon" aria-label="Наступний місяць" onClick={() => moveMonth(1)} disabled={saving || month >= today.slice(0, 7)}><ChevronRight /></Button></div><fieldset className="reports-calendar-filters" aria-label="Фільтр календаря">{calendarFilters.map((filter) => <Button key={filter.value} type="button" size="sm" variant={calendarFilter === filter.value ? 'secondary' : 'ghost'} aria-pressed={calendarFilter === filter.value} onClick={() => setCalendarFilter(filter.value)}>{filter.label}</Button>)}</fieldset><div className="reports-weekdays">{['Пн','Вт','Ср','Чт','Пт','Сб','Нд'].map((day) => <span key={day}>{day}</span>)}</div><div className="reports-calendar-grid">{days.map((day) => { const report = reportByDate.get(day.date); const context = contextByDate.get(day.date); const revision = report?.revisionCount || 0; const revisionClass = reportRevisionHeatClass(revision); const matches = matchesCalendarFilter(calendarFilter,day,report); return <button key={day.date} type="button" disabled={day.isFuture} className={`report-day ${day.isCurrentMonth ? '' : 'is-muted'} ${day.isFuture ? 'is-future' : ''} ${selected === day.date ? 'is-selected' : ''} ${report ? 'has-report' : ''} ${report?.submittedAt ? 'is-submitted' : ''} ${report?.stale ? 'is-stale' : ''} ${revisionClass} ${matches ? '' : 'is-filtered-out'}`} title={day.isFuture ? 'Майбутня дата недоступна' : report ? `${report.stale ? 'Застарілий звіт · ' : ''}${report.submittedAt ? 'Здано · ' : 'Чернетка · '}Збережених версій: ${revision}` : 'Додати звіт'} aria-label={`${formatDate(day.date)}. ${calendarContextLabels(day.date, context).join(', ') || 'Без подій'}. ${report ? `Збережених версій: ${revision}. ` : ''}${report?.stale ? 'Звіт потребує оновлення' : report?.submittedAt ? 'Звіт здано' : report ? 'Є чернетка звіту' : 'Звіту немає'}`} onClick={() => chooseDate(day.date)}><span>{day.day}</span><ReportCalendarContext date={day.date} context={context} />{report && <i className={report.submittedAt ? 'is-submitted' : 'is-draft'} aria-label={report.stale ? 'Застарілий звіт' : report.submittedAt ? 'Звіт здано' : 'Чернетка звіту'} />}</button>; })}</div><div className="reports-legend" aria-label="Інтенсивність календаря за кількістю версій"><span><i className="legend-dot revision-1" />1 версія</span><span><i className="legend-dot revision-2" />2 версії</span><span><i className="legend-dot revision-3" />3 версії</span><span><i className="legend-dot revision-4" />4+ версій</span><span><i className="legend-state is-draft" />Чернетка</span><span><i className="legend-state is-submitted" />Здано</span><span><i className="legend-dot is-stale" />Потребує оновлення</span></div></section>
      <section className="reports-editor-card">{selectedDate && <Button type="button" variant="ghost" className="report-mobile-back" onClick={() => { setSelectedDate(null); setNotice(''); setError(''); }}>← До календаря</Button>}{loading&&!data ? <WorkspaceInitialLoading compact label="Завантажуємо звіти…"/> : selected&&editorData ? <><div className="card-heading"><div><p className="eyebrow">Звіт за день</p><h3>{formatDate(selected)}</h3></div><div className="reports-editor-actions">{onOpenLead && editorData?.leadCommandScope ? <Button variant="outline" size="sm" onClick={() => setBackdatedLeadOpen(true)} disabled={saving}><UserPlus data-icon="inline-start" />Новий лід за дату</Button> : null}<Button ref={reportHistoryTrigger} variant="outline" size="sm" onClick={() => setHistoryOpen(true)} disabled={saving}><History data-icon="inline-start" />Версії</Button>{editorData?.selected?.stale ? <Badge variant="outline">Потребує оновлення</Badge> : editorData?.selected?.submittedAt ? <Badge variant="secondary">Здано</Badge> : editorData?.selected ? <Badge variant="outline">Чернетка</Badge> : <Badge variant="outline">Немає звіту</Badge>}</div></div><Textarea aria-label="Текст щоденного звіту" disabled={saving} value={text} onChange={(event) => setText(event.target.value)} placeholder="Встав текст щоденного звіту або внеси коригування…" rows={14} />{!editorData?.selected && editorData?.suggestedText ? <p className="muted-note">Чернетку автоматично сформовано з подій за цей день. Перевір текст перед збереженням.</p> : null}<div className="reports-editor-footer"><div className="reports-editor-meta"><span className="muted-note">Остання зміна: {editorData?.selected ? formatTime(editorData.selected.updatedAt) : 'ще не створено'}</span><span className="muted-note">Остання фінальна здача: {editorData?.selected?.submittedAt ? formatTime(editorData.selected.submittedAt) : 'ще не здано'}</span></div><div className="reports-editor-actions"><Button variant="outline" onClick={() => void copyReport()} disabled={loading || saving || !text.trim()}><Copy data-icon="inline-start" />Копіювати</Button><Button variant="outline" onClick={() => void save(false)} disabled={loading || saving || reportConflict || !text.trim()}><Save data-icon="inline-start" />{saving ? 'Зберігаємо…' : 'Зберегти чернетку'}</Button><Button onClick={() => void save(true)} disabled={loading || saving || reportConflict || !text.trim() || !editorData?.finalReportState?.canSubmit}>{saving ? 'Здаємо…' : editorData?.selected?.submittedAt ? 'Здати оновлення' : 'Здати фінальний'}</Button></div></div>{editorData?.finalReportState && !editorData.finalReportState.canSubmit && <p className="muted-note">{editorData.finalReportState.reason}</p>}{editorData?.goalPlanFact ? <GoalPlanFactView data={editorData.goalPlanFact} /> : null}{editorData?.summary.length ? <Summary summary={editorData.summary} /> : null}{editorData?.details?.length ? <details className="report-disclosure"><summary><span>Джерела та деталізація</span><small>{editorData.details.length} подій</small></summary><ReportEventDetails details={editorData.details} onOpenLead={onOpenLead} /></details> : null}{active&&<ReportCheckpoints date={selected} />}</> : selected ? <WorkspaceInitialLoading compact label="Завантажуємо вибраний звіт…"/> : <div className="workspace-empty"><FileText /><strong>Оберіть дату</strong><p>Дні зі звітом позначені синім.</p></div>}</section>
    </div>
    <ReportHistoryDialog open={historyOpen} date={selected} currentRevision={editorData?.selected?.revisionCount ?? 0} onClose={() => setHistoryOpen(false)} onRestored={() => { setNotice('Версію відновлено як нову.'); void load(selected); }} finalFocus={() => reportHistoryTrigger.current} />
    {backdatedLeadOpen && selected ? <LeadEditor defaultResponseDate={selected} close={() => setBackdatedLeadOpen(false)} save={createBackdatedLead} /> : null}
  </div>;
}

function reportViewKey(month:string,date:string|null){return `${month}:${date||''}`;}

function GoalPlanFactView({ data }: { data: GoalPlanFact }) {
  return <div className="report-summary"><p className="eyebrow">План / факт</p><div><strong>День</strong><span>План: {data.dailyTarget}</span><span>Факт: {data.dailyActual}</span></div><div><strong>Місяць</strong><span>План: {data.monthlyTarget}</span><span>Факт: {data.monthlyActual}</span></div></div>;
}

function Summary({ summary }: { summary: ReportData['summary'] }) { const grouped = new Map<string, Record<string, number>>(); for (const row of summary) { const current = grouped.get(row.platform) || {}; current[row.eventType] = (current[row.eventType] || 0) + row.count; grouped.set(row.platform, current); } return <div className="report-summary"><p className="eyebrow">Події в базі за цей день</p>{Array.from(grouped).map(([platform, values]) => <div key={platform}><strong>{platformNames[platform] || platform}</strong><span>Оголошення: {values.publication || 0}</span><span>Відгуки: {values.lead_created || 0}</span><span>Записи: {(values.lesson_booked || 0) + (values.curator_booking_pending || 0)}</span></div>)}</div>; }
function ReportEventDetails({ details, onOpenLead }: { details: ReportEventDetail[]; onOpenLead?: (leadId: string) => void }) {
  const sources = details.filter((event) => event.eventType === 'chat_joined' || event.eventType === 'publication');
  const responses = details.filter((event) => event.eventType === 'lead_created');
  const bookings = details.filter((event) => event.eventType === 'lesson_booked' || event.eventType === 'curator_booking_pending');
  return <section className="report-event-details" aria-label="Деталізація подій"><div className="report-event-details-head"><p className="eyebrow">Деталізація подій</p><span>Показано: {details.length}</span></div><div className="report-event-columns"><EventList title="Джерельні події" events={sources} onOpenLead={onOpenLead} /><EventList title="Відгуки" events={responses} onOpenLead={onOpenLead} /><EventList title="Записи" events={bookings} onOpenLead={onOpenLead} /></div></section>;
}
function EventList({ title, events, onOpenLead }: { title: string; events: ReportEventDetail[]; onOpenLead?: (leadId: string) => void }) {
  return <div className="report-event-list"><h4>{title} <span>{events.length}</span></h4>{events.length ? <ul>{events.map((event) => {
    const sourceEvent = event.eventType === 'chat_joined' || event.eventType === 'publication';
    const primary = sourceEvent ? event.chatName || 'Чат недоступний' : event.leadName || 'Лід недоступний';
    const platform = platformNames[event.platform || 'unknown'] || event.platform || 'Платформа не вказана';
    const detail = sourceEvent
      ? `${platform} · ${event.eventType === 'chat_joined' ? 'Приєднання чату' : 'Публікація'}`
      : `${platform} · ${event.eventType === 'lead_created' ? event.leadSubject || 'Предмет не вказано' : event.lessonSubject || event.leadSubject || 'Предмет не вказано'}`;
    return <li key={event.id}><div><strong>{primary}</strong><span>{detail}</span></div>{event.leadId && onOpenLead ? <Button type="button" variant="ghost" size="sm" onClick={() => onOpenLead(event.leadId!)}>Відкрити</Button> : null}</li>;
  })}</ul> : <p className="muted-note">Немає активних подій.</p>}</div>;
}

function matchesCalendarFilter(filter: CalendarFilter, day: { isCurrentMonth:boolean; isFuture:boolean }, report: Report | undefined) {
  if (filter === 'all') return true;
  if (!day.isCurrentMonth || day.isFuture) return false;
  if (filter === 'has-report') return Boolean(report);
  if (filter === 'missing') return !report;
  if (filter === 'stale') return Boolean(report?.stale);
  return Boolean(report?.submittedAt && report.submissionCount >= 2);
}

function currentMonth() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit' }).format(new Date()); }
function currentDate() { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()); const values = Object.fromEntries(parts.map((part) => [part.type, part.value])); return `${values.year}-${values.month}-${values.day}`; }
function monthDays(month: string, today: string) { const [year, monthNumber] = month.split('-').map(Number); const first = new Date(Date.UTC(year, monthNumber - 1, 1)); const count = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate(); const start = (first.getUTCDay() + 6) % 7; return Array.from({ length: start + count }, (_, index) => { const day = index - start + 1; const date = new Date(Date.UTC(year, monthNumber - 1, day)); const dateValue = date.toISOString().slice(0, 10); return { day: date.getUTCDate(), date: dateValue, isCurrentMonth: day >= 1 && day <= count, isFuture: dateValue > today }; }); }
function shiftDay(value: string, offset: number) { const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + offset); return date.toISOString().slice(0, 10); }
function shiftMonth(month: string, offset: number) { const [year, monthNumber] = month.split('-').map(Number); const date = new Date(Date.UTC(year, monthNumber - 1 + offset, 1)); return date.toISOString().slice(0, 7); }
function formatMonth(month: string) { const [year, monthNumber] = month.split('-').map(Number); return new Intl.DateTimeFormat('uk-UA', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, monthNumber - 1, 1))).replace(/^./, (value) => value.toUpperCase()); }
function formatDate(value: string) { const [year, month, day] = value.split('-'); return `${day}.${month}.${year}`; }
function formatTime(value: number) { return new Intl.DateTimeFormat('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' }).format(new Date(value * 1000)); }
