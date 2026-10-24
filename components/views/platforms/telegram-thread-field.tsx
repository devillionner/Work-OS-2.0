'use client';

import { useEffect, useRef, useState } from 'react';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { createActionGate } from '@/lib/action-gate';
import { humanError } from '@/components/ui/human-error';

type ThreadView = { forum: boolean | null; thread: { id: string; title: string } | null; topics: Array<{ id: string; title: string; closed: boolean }> };

/**
 * Гілка форуму, куди автопост публікує в цьому чаті Telegram (зберігається в чаті; вибір діє одразу, без «Зберегти профіль»).
 * Список гілок збирає автопост, коли відкриває чат: до цього чат вважається звичайним або ще не відкритим.
 */
export function TelegramThreadField({ chatId, disabled }: { chatId: string; disabled: boolean }) {
  const [view, setView] = useState<ThreadView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const gate = useRef(createActionGate());

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/messenger-automation?telegramThread=${encodeURIComponent(chatId)}`, { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json() as { thread?: ThreadView };
        if (!cancelled && response.ok && body.thread) setView(body.thread);
      })
      .catch(() => { /* поле просто не з’явиться */ });
    return () => { cancelled = true; };
  }, [chatId]);

  if (!view) return null;
  if (view.forum !== true) {
    return <p className="m-0 text-xs text-ink-2">{view.forum === false ? 'У цьому чаті Telegram немає гілок: автопост публікує просто в чат.' : 'Автопост ще не відкривав цей чат, тож не знає, чи є в ньому гілки. Він збере список гілок під час першої публікації.'}</p>;
  }

  async function choose(threadId: string) {
    await gate.current(async () => {
      setBusy(true); setError('');
      try {
        const response = await fetch('/api/messenger-automation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'telegram-choose-thread', chatId, threadId: threadId || null }) });
        const body = await response.json() as { thread?: { id: string; title: string } | null; error?: string };
        if (!response.ok) throw new Error(body.error || 'Не вдалося зберегти гілку.');
        setView((current) => (current ? { ...current, thread: body.thread ?? null } : current));
      } catch (reason) { setError(humanError(reason, 'Не вдалося зберегти гілку. Спробуй ще раз.')); }
      finally { setBusy(false); }
    });
  }

  return (
    <Field label="Гілка для автопосту" htmlFor="chat-profile-thread">
      <Select id="chat-profile-thread" value={view.thread?.id ?? ''} disabled={disabled || busy} onChange={(event) => void choose(event.target.value)}>
        <option value="">Не вибрано</option>
        {view.topics.map((topic) => <option key={topic.id} value={topic.id} disabled={topic.closed}>{topic.title}{topic.closed ? ' · закрита' : ''}</option>)}
      </Select>
      {error ? <span role="alert" className="mt-1 block text-xs text-hot">{error}</span> : null}
    </Field>
  );
}
