'use client';

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShell } from '@/components/shell/shell-context';
import { useViewActive } from '@/components/shell/view-pane';
import { Button } from '@/components/ui/button';
import { Ghost } from '@/components/ui/ghost';
import { Surface } from '@/components/ui/surface';
import { useToast } from '@/components/ui/toast';
import { createBrowserCommandClient } from '@/components/views/leads/client';
import { LeadEditor } from '@/components/views/leads/lead-editor';
import { useRemote } from '@/components/views/shared/use-remote';
import { ADMIN_REPORT_FORM_URL, MANAGER_SCHEDULE_URL } from '@/lib/reports/form';
import { CorrectionsPanel, type CorrectionTab } from './corrections-panel';
import { DayStrip } from './day-strip';
import { EventDetails, EventSummary, PlanFact } from './day-facts';
import { HistoryPanel } from './history-panel';
import { ManualDiffPanel } from './manual-diff-panel';
import { ReportEditor } from './report-editor';
import { currentDate, formatDate, shiftDay, shiftMonthDate, type DayFilter, type ReportData } from './types';

const Checkpoints = lazy(() => import('./checkpoints'));
const SubjectsCard = lazy(() => import('./subjects-card'));

type PanelKey = 'history' | 'diff' | 'corrections' | null;

/** «Звіти»: стрічка днів зі scroll-snap, звіт дня, проміжні звіти шкалою; корекції, версії й факт — в Inspector. */
export default function ReportsView() {
  const { syncRevision, openLead } = useShell();
  const active = useViewActive();
  const toast = useToast();
  const [today] = useState(currentDate);
  const [selectedDate, setSelectedDate] = useState(today);
  const [filter, setFilter] = useState<DayFilter>('all');
  const [refresh, setRefresh] = useState(0);
  const [draft, setDraft] = useState<{ date: string; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelKey>(null);
  const [correctionTab, setCorrectionTab] = useState<CorrectionTab>('publication');
  const [backdatedLead, setBackdatedLead] = useState(false);
  const seenRevision = useRef(syncRevision);
  const month = selectedDate.slice(0, 7);

  const report = useRemote<ReportData>(`/api/reports?month=${month}&date=${selectedDate}`, { refresh, enabled: active, keepPrevious: true, fallback: 'Не вдалося завантажити звіти.' });
  const data = report.data;
  const ready = data && !report.stale && data.month === month ? data : null;
  const monthData = data && data.month === month ? data : null;
  const text = draft && draft.date === selectedDate ? draft.text : ready ? ready.selected?.text || ready.suggestedText || '' : '';
  const hasConflict = conflict === selectedDate;
  const leadCommand = useMemo(() => (ready ? createBrowserCommandClient(ready.leadCommandScope) : null), [ready]);

  const reload = useCallback(() => setRefresh((value) => value + 1), []);

  // Зміни з інших пристроїв приходять через live-канал: перечитуємо раз, коли розділ активний.
  useEffect(() => {
    if (!active || seenRevision.current === syncRevision) return;
    seenRevision.current = syncRevision;
    queueMicrotask(reload);
  }, [active, syncRevision, reload]);

  const selectDate = useCallback((date: string) => {
    if (date > today || date === selectedDate || saving) return;
    setSelectedDate(date);
  }, [today, selectedDate, saving]);

  const moveMonth = (offset: number) => {
    const next = shiftMonthDate(selectedDate, offset);
    selectDate(next > today ? today : next);
  };

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
      event.preventDefault();
      selectDate(shiftDay(selectedDate, event.key === 'ArrowLeft' ? -1 : 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, selectedDate, selectDate]);

  const save = async (submitted: boolean) => {
    if (!ready || saving || hasConflict) return;
    if (!text.trim()) { toast.push({ message: 'Додай текст звіту.', tone: 'hot' }); return; }
    setSaving(true);
    try {
      const response = await fetch('/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: selectedDate, text, submitted, expectedRevision: ready.selected?.revisionCount ?? 0 }) });
      const body = await response.json().catch(() => ({})) as { error?: string; currentRevision?: number };
      if (!response.ok) {
        if (response.status === 409 && typeof body.currentRevision === 'number') setConflict(selectedDate);
        throw new Error(body.error || 'Не вдалося зберегти звіт.');
      }
      toast.push({ message: submitted ? 'Фінальний звіт здано.' : 'Чернетку звіту збережено.', tone: 'ok' });
      setDraft(null);
      reload();
    } catch (reason) {
      toast.push({ message: reason instanceof Error ? reason.message : 'Не вдалося зберегти звіт.', tone: 'hot', duration: 7000 });
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    if (!text.trim()) return;
    try { await navigator.clipboard.writeText(text); toast.push({ message: 'Текст звіту скопійовано.' }); }
    catch { toast.push({ message: 'Не вдалося скопіювати текст звіту.', tone: 'hot' }); }
  };

  const createBackdatedLead = async (values: Record<string, unknown>) => {
    if (!leadCommand) throw new Error('Не вдалося визначити власника CRM. Онови звіт.');
    const id = await leadCommand('create', values);
    setBackdatedLead(false);
    toast.push({ message: `Ліда додано до ${formatDate(selectedDate)}.`, tone: 'ok' });
    openLead(id);
  };

  const context = ready?.calendarContext.find((item) => item.date === selectedDate);
  const reminder = monthData?.previousReportReminder;

  return (
    <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-3 pb-6 @4xl:gap-4" aria-busy={report.loading}>
      <Surface variant="glass" radius="card" spot data-reveal className="p-4 @4xl:p-5">
        <DayStrip
          month={month}
          selected={selectedDate}
          today={today}
          reports={monthData?.reports ?? []}
          context={monthData?.calendarContext ?? []}
          filter={filter}
          onFilter={setFilter}
          onSelect={selectDate}
          onMonth={moveMonth}
          busy={saving}
        />
      </Surface>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-2">
        <a className="underline-offset-4 hover:text-ink hover:underline" href={MANAGER_SCHEDULE_URL} target="_blank" rel="noopener noreferrer">Графік керівника</a>
        <a className="underline-offset-4 hover:text-ink hover:underline" href={ADMIN_REPORT_FORM_URL} target="_blank" rel="noopener noreferrer">Форма адміністраторів</a>
        <span>Форма відкривається вручну — Work OS не відправляє її автоматично.</span>
      </div>

      {reminder?.pending ? (
        <div className="flex flex-wrap items-center gap-3 rounded-inner border border-line bg-sunken px-4 py-3">
          <p className="m-0 text-sm"><span className="mr-2 inline-block size-1.5 rounded-full bg-warn align-middle" />Не здано фінальний звіт за <span className="font-mono">{formatDate(reminder.date)}</span>.</p>
          <Button variant="outline" size="sm" onClick={() => selectDate(reminder.date)}>Відкрити цей день</Button>
        </div>
      ) : null}

      {report.error && !ready ? (
        <div className="flex flex-wrap items-center gap-3">
          <p role="alert" className="m-0 text-sm text-hot">{report.error}</p>
          <Button variant="outline" size="sm" onClick={reload}>Спробувати ще раз</Button>
        </div>
      ) : null}
      {hasConflict ? (
        <div className="flex flex-wrap items-center gap-3">
          <p role="alert" className="m-0 text-sm text-hot">Звіт уже змінено на іншому пристрої. Твій текст залишено без змін — скопіюй його за потреби й онови дані.</p>
          <Button variant="outline" size="sm" onClick={() => { setDraft(null); setConflict(null); reload(); }}>Завантажити актуальну версію</Button>
        </div>
      ) : null}

      {!ready ? (
        report.error ? null : (
          <div aria-busy="true" className="grid grid-cols-1 gap-3 @4xl:grid-cols-12 @4xl:gap-4">
            <Ghost className="h-[560px] rounded-card @4xl:col-span-8" />
            <Ghost className="h-[420px] rounded-card @4xl:col-span-4" />
          </div>
        )
      ) : (
        <div className="grid grid-cols-1 gap-3 @4xl:grid-cols-12 @4xl:gap-4">
          <div className="min-w-0 @4xl:col-span-8 [&>section]:h-full">
            <ReportEditor
              date={selectedDate}
              data={ready}
              context={context}
              text={text}
              onText={(value) => setDraft({ date: selectedDate, text: value })}
              saving={saving}
              conflict={hasConflict}
              onSave={(submitted) => void save(submitted)}
              onCopy={() => void copy()}
              onHistory={() => setPanel('history')}
              onDiff={() => setPanel('diff')}
              onCorrections={() => setPanel('corrections')}
              onBackdatedLead={() => setBackdatedLead(true)}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-3 @4xl:col-span-4 @4xl:gap-4">
            <Suspense fallback={<Ghost className="h-60 rounded-card" />}><Checkpoints date={selectedDate} active={active} /></Suspense>
            {ready.goalPlanFact ? <PlanFact data={ready.goalPlanFact} /> : null}
            <EventSummary summary={ready.summary} />
          </div>
          <Suspense fallback={<Ghost className="h-72 rounded-card @4xl:col-span-12" />}><SubjectsCard date={selectedDate} active={active} className="@4xl:col-span-12" /></Suspense>
          {ready.details.length ? <EventDetails details={ready.details} onOpenLead={openLead} className="@4xl:col-span-12" /> : null}
        </div>
      )}

      <HistoryPanel open={panel === 'history'} onOpenChange={(open) => setPanel(open ? 'history' : null)} date={selectedDate} currentRevision={ready?.selected?.revisionCount ?? 0} onRestored={() => { setDraft(null); reload(); }} />
      <ManualDiffPanel open={panel === 'diff'} onOpenChange={(open) => setPanel(open ? 'diff' : null)} date={selectedDate} />
      <CorrectionsPanel open={panel === 'corrections'} onOpenChange={(open) => setPanel(open ? 'corrections' : null)} date={selectedDate} tab={correctionTab} onTabChange={setCorrectionTab} />
      {backdatedLead ? <LeadEditor defaultResponseDate={selectedDate} close={() => setBackdatedLead(false)} save={createBackdatedLead} /> : null}
    </div>
  );
}
