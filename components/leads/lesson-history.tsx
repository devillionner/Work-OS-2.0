'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { LeadHistoryItem } from '@/lib/leads/history';

const eventNames: Record<string, string> = {
  lesson_booked: 'Урок записано',
  lesson_rescheduled: 'Урок перенесено',
  lesson_updated: 'Урок оновлено',
  lesson_completed: 'Урок проведено',
  lesson_cancelled: 'Урок скасовано',
  lesson_no_show: 'Неявка на урок',
  reminder_sent: 'Нагадування відправлено',
  reminder_skipped: 'Нагадування пропущено',
};

type HistoryLesson = { id: string; leadId: string; subject: string; date: string };

export function LessonHistoryDialog({ open, lesson, onClose }: { open: boolean; lesson: HistoryLesson | null; onClose: () => void }) {
  const [events, setEvents] = useState<LeadHistoryItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !lesson) return;
    const controller = new AbortController();
    let active = true;
    queueMicrotask(() => { if (active) { setBusy(true); setError(''); setEvents([]); } });
    fetch(`/api/leads/history?id=${encodeURIComponent(lesson.leadId)}&lessonId=${encodeURIComponent(lesson.id)}`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const value: unknown = await response.json();
        if (!response.ok) throw new Error(value && typeof value === 'object' && 'error' in value && typeof value.error === 'string' ? value.error : 'Не вдалося завантажити історію уроку.');
        if (!value || typeof value !== 'object' || !Array.isArray((value as { events?: unknown }).events)) throw new Error('Не вдалося прочитати історію уроку.');
        if (!controller.signal.aborted) setEvents((value as { events: LeadHistoryItem[] }).events);
      })
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Не вдалося завантажити історію уроку.'); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => { active = false; controller.abort(); };
  }, [lesson, open]);

  return <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onClose(); }}><DialogContent className="lead-history-dialog" showCloseButton={!busy}><DialogHeader><DialogTitle>Історія уроку</DialogTitle><DialogDescription>{lesson ? `${lesson.subject} · ${formatDate(lesson.date)}` : ''}</DialogDescription></DialogHeader>{error && <p className="lead-error" role="alert">{error}</p>}{busy ? <output>Завантажуємо історію…</output> : events.length ? <ol className="lead-history-list">{events.map((event) => <li key={event.id}><div><strong>{eventNames[event.eventType] || event.eventType}</strong>{event.cancelledAt !== null && <span> · скасовано</span>}{typeof event.metadata.reason === 'string' && event.metadata.reason && <small> · {event.metadata.reason}</small>}</div><time dateTime={new Date(event.occurredAt * 1000).toISOString()}>{formatTime(event.occurredAt)}</time></li>)}</ol> : <p className="muted-note">Історія ще порожня.</p>}<div className="dialog-actions"><Button variant="outline" onClick={onClose} disabled={busy}>Закрити</Button></div></DialogContent></Dialog>;
}

function formatDate(value: string) { const [year, month, day] = value.split('-'); return `${day}.${month}.${year}`; }
function formatTime(value: number) { return new Intl.DateTimeFormat('uk-UA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Kyiv' }).format(new Date(value * 1000)); }
