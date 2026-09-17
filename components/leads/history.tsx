'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { LeadHistoryItem } from '@/lib/leads/history';

type HistoryLead = { id: string; name: string };
const eventNames: Record<string, string> = {
  lead_created: 'Ліда створено',
  lead_updated: 'Контакт оновлено',
  lead_archived: 'Ліда архівовано',
  lead_restored: 'Ліда відновлено',
  lead_response_cancelled: 'Відгук скасовано',
  lead_response_restored: 'Відгук відновлено',
  first_reply_recorded: 'Першу відповідь зафіксовано',
  curator_request_submitted: 'Запит куратору створено',
  curator_booking_pending: 'Запит куратору очікує відповіді',
  curator_request_cancelled: 'Запит куратору скасовано',
  lesson_booked: 'Урок записано',
  lesson_rescheduled: 'Урок перенесено',
  lesson_updated: 'Урок оновлено',
  lesson_completed: 'Урок проведено',
  lesson_cancelled: 'Урок скасовано',
  lesson_no_show: 'Неявка на урок',
  reminder_sent: 'Нагадування відправлено',
  reminder_skipped: 'Нагадування пропущено',
};

function leadHistoryTrigger(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return Array.from(document.querySelectorAll<HTMLElement>('.lead-action-utility [data-slot="button"]'))
    .find((element) => element.textContent?.trim() === 'Історія') ?? null;
}

export function LeadHistoryDialog({ open, lead, onClose }: { open: boolean; lead: HistoryLead | null; onClose: () => void }) {
  const [events, setEvents] = useState<LeadHistoryItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open || !lead) return;
    let cancelled = false;
    const controller = new AbortController();
    queueMicrotask(() => { if (!cancelled) { setBusy(true); setError(''); setEvents([]); } });
    fetch(`/api/leads/history?id=${encodeURIComponent(lead.id)}`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const value: unknown = await response.json();
        if (!response.ok) throw new Error(value && typeof value === 'object' && 'error' in value && typeof value.error === 'string' ? value.error : 'Не вдалося завантажити історію.');
        if (!value || typeof value !== 'object' || !Array.isArray((value as { events?: unknown }).events)) throw new Error('Не вдалося прочитати історію.');
        if (!controller.signal.aborted) setEvents((value as { events: LeadHistoryItem[] }).events);
      })
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Не вдалося завантажити історію.'); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => { cancelled = true; controller.abort(); };
  }, [open, lead]);
  return <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onClose(); }}><DialogContent className="lead-history-dialog" showCloseButton={!busy} finalFocus={leadHistoryTrigger}><DialogHeader><DialogTitle>Історія ліда</DialogTitle><DialogDescription>{lead?.name}</DialogDescription></DialogHeader>{error && <p className="lead-error" role="alert">{error}</p>}{busy ? <output aria-live="polite">Завантаження історії…</output> : events.length ? <ol className="lead-history-list">{events.map((event) => <li key={event.id}><div><strong>{eventNames[event.eventType] || event.eventType}</strong>{event.cancelledAt !== null && <span> · скасовано</span>}{typeof event.metadata.reason === 'string' && event.metadata.reason && <small> · {event.metadata.reason}</small>}</div><time dateTime={new Date(event.occurredAt * 1000).toISOString()}>{new Intl.DateTimeFormat('uk-UA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Kyiv' }).format(new Date(event.occurredAt * 1000))}</time></li>)}</ol> : <p className="muted-note">Історія ще порожня.</p>}<div className="dialog-actions"><Button variant="outline" onClick={onClose} disabled={busy}>Закрити</Button></div></DialogContent></Dialog>;
}
