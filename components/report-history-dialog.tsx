'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { ReportHistoryItem } from '@/lib/reports/history';
import { diffReportText, type ReportTextDiff } from '@/lib/reports/diff';

export function ReportHistoryDialog({ open, date, currentRevision, onClose, onRestored, finalFocus }: { open: boolean; date: string | null; currentRevision: number; onClose: () => void; onRestored?: () => void; finalFocus?: () => HTMLElement | null }) {
  const [events, setEvents] = useState<ReportHistoryItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [compareId, setCompareId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !date) return;
    const controller = new AbortController();
    let active = true;
    queueMicrotask(() => { if (active) { setBusy(true); setError(''); setEvents([]); setCompareId(null); } });
    fetch(`/api/reports/history?date=${encodeURIComponent(date)}`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const value: unknown = await response.json();
        if (!response.ok) throw new Error(value && typeof value === 'object' && 'error' in value && typeof value.error === 'string' ? value.error : 'Не вдалося завантажити історію звіту.');
        if (!value || typeof value !== 'object' || !Array.isArray((value as { events?: unknown }).events)) throw new Error('Не вдалося прочитати історію звіту.');
        if (!controller.signal.aborted) setEvents((value as { events: ReportHistoryItem[] }).events);
      })
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Не вдалося завантажити історію звіту.'); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => { active = false; controller.abort(); };
  }, [date, open]);

  async function restore(event: ReportHistoryItem) {
    if (!date || busy || restoringId) return;
    setRestoringId(event.id); setError('');
    try {
      const response = await fetch('/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, text: event.text, submitted: event.submittedAt !== null, expectedRevision: currentRevision }) });
      const value: unknown = await response.json();
      if (!response.ok) throw new Error(value && typeof value === 'object' && 'error' in value && typeof value.error === 'string' ? value.error : 'Не вдалося відновити версію звіту.');
      onRestored?.(); onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не вдалося відновити версію звіту.');
    } finally { setRestoringId(null); }
  }

  const blocked = busy || Boolean(restoringId);
  const current = events[0] || null;
  return <Dialog open={open} onOpenChange={(next) => { if (!next && !blocked) onClose(); }}><DialogContent className="report-history-dialog" showCloseButton={!blocked} finalFocus={finalFocus}><DialogHeader><DialogTitle>Версії звіту</DialogTitle><DialogDescription>{date ? 'Звіт за ' + formatDate(date) + ' · відновлення створює нову версію' : ''}</DialogDescription></DialogHeader>{error && <p className="workspace-error" role="alert">{error}</p>}{busy ? <output className="workspace-loading">Завантажуємо історію…</output> : events.length ? <ol className="report-history-list">{events.map((event, index) => {
    const comparison = compareId === event.id && current ? diffReportText(event.text, current.text) : null;
    return <li key={event.id}><details open={index === 0 || compareId === event.id}><summary><span><strong>Версія {event.revision}</strong><small>{event.source === 'import' ? 'Імпорт' : 'Ручна зміна'}</small></span><time dateTime={new Date(event.occurredAt * 1000).toISOString()}>{formatTime(event.occurredAt)}</time></summary><div className="report-history-meta">{event.submittedAt ? 'Здано' : 'Чернетка'}</div>{event.manualAdjustments ? <div className="report-history-meta">{formatAdjustments(event.manualAdjustments)}</div> : null}<pre>{event.text || 'Текст відсутній.'}</pre>{index > 0 && <div className="report-history-actions"><Button type="button" variant="outline" size="sm" disabled={blocked} aria-pressed={compareId === event.id} onClick={() => setCompareId((value) => value === event.id ? null : event.id)}>{compareId === event.id ? 'Сховати порівняння' : 'Порівняти з поточною'}</Button><Button type="button" variant="outline" size="sm" disabled={blocked} onClick={() => void restore(event)}>{restoringId === event.id ? 'Відновлюємо…' : 'Відновити цю версію'}</Button></div>}{comparison ? <ReportVersionDiff diff={comparison} currentRevision={current.revision} /> : null}</details></li>;
  })}</ol> : <p className="muted-note">Історія ще порожня.</p>}<div className="dialog-actions"><Button variant="outline" onClick={onClose} disabled={blocked}>Закрити</Button></div></DialogContent></Dialog>;
}

function ReportVersionDiff({ diff, currentRevision }: { diff: ReportTextDiff; currentRevision: number }) {
  return <section className="report-version-compare" aria-label={'Порівняння з версією ' + currentRevision}><div className="report-version-compare-head"><div><strong>Зміни проти версії {currentRevision}</strong><small>+{diff.added} · −{diff.removed} рядків</small></div>{diff.truncated ? <span>Показано перші {diff.maxLines} рядків кожної версії</span> : null}</div><ol>{diff.operations.map((operation, index) => <li key={operation.kind + ':' + index} className={'is-' + operation.kind}><span aria-hidden="true">{operation.kind === 'added' ? '+' : operation.kind === 'removed' ? '−' : ' '}</span><code>{operation.text || ' '}</code></li>)}</ol></section>;
}

function formatAdjustments(value: NonNullable<ReportHistoryItem['manualAdjustments']>) {
  return `Корекція · оголошення ${signed(value.publications)} · відгуки ${signed(value.responses)} · записи ${signed(value.bookings)}`;
}
function signed(value: number) { return value > 0 ? `+${value}` : String(value); }
function formatDate(value: string) { const [year, month, day] = value.split('-'); return `${day}.${month}.${year}`; }
function formatTime(value: number) { return new Intl.DateTimeFormat('uk-UA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Kyiv' }).format(new Date(value * 1000)); }
