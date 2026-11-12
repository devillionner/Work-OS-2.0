'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { createActionGate } from '@/lib/action-gate';
import { humanError } from '@/components/ui/human-error';
import { subscribeLiveMessages, subscribeLiveStatus, type LiveStatus } from '@/lib/live-channel';

type ThreadView = { forum: boolean | null; thread: { id: string; title: string } | null; topics: Array<{ id: string; title: string; closed: boolean }>; scannedAt?: number | null };
/** Скільки чекаємо на прохід, поки результат не прийшов live-каналом (runner міг зникнути посеред перевірки). */
const SCAN_WAIT_MS = 120_000;

function when(seconds: number): string {
  const date = new Date(seconds * 1000);
  const two = (value: number) => String(value).padStart(2, '0');
  return `${two(date.getDate())}.${two(date.getMonth() + 1)} о ${two(date.getHours())}:${two(date.getMinutes())}`;
}

/**
 * Гілка форуму, куди автопост публікує в цьому чаті Telegram (зберігається в чаті; вибір діє одразу, без «Зберегти профіль»).
 * Блок є завжди: автопост міг не побачити гілок (шапка чату ще не домалювалась), тож «Перевірити гілки ще раз» запускає наявний прохід
 * `telegram-scan-threads` для цього чату; результат приходить live-каналом, і поле оновлюється без перезавантаження.
 */
export function TelegramThreadField({ chatId, disabled }: { chatId: string; disabled: boolean }) {
  const [view, setView] = useState<ThreadView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [scanning, setScanning] = useState<{ jobId: string; before: number | null } | null>(null);
  const [note, setNote] = useState('');
  const [runner, setRunner] = useState<LiveStatus>({ connected: false, runnerConnected: null });
  const gate = useRef(createActionGate());

  const load = useCallback(async (): Promise<ThreadView | null> => {
    try {
      const response = await fetch(`/api/messenger-automation?telegramThread=${encodeURIComponent(chatId)}`, { cache: 'no-store' });
      const body = await response.json() as { thread?: ThreadView };
      if (response.ok && body.thread) { setView(body.thread); return body.thread; }
    } catch { /* поле просто не з’явиться */ }
    return null;
  }, [chatId]);

  useEffect(() => {
    let live = true;
    void fetch(`/api/messenger-automation?telegramThread=${encodeURIComponent(chatId)}`, { cache: 'no-store' })
      .then((response) => response.json() as Promise<{ thread?: ThreadView }>)
      .then((body) => { if (live && body.thread) setView(body.thread); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [chatId]);
  useEffect(() => subscribeLiveStatus(setRunner), []);

  // Результат проходу цього чату: подія live-каналу з id задачі; без неї (обрив, runner зник) — зупиняємо очікування за таймером.
  useEffect(() => {
    if (!scanning) return;
    const finish = async () => {
      const next = await load();
      const changed = next !== null && (next.scannedAt ?? null) !== scanning.before;
      setNote(changed ? '' : 'Не вдалося визначити, чи є в чаті гілки: чат не встиг завантажитись у Telegram Web. Нічого не змінено, спробуй ще раз.');
      setScanning(null);
    };
    const timer = setTimeout(() => { void finish(); }, SCAN_WAIT_MS);
    const off = subscribeLiveMessages((message) => {
      if (message.type === 'process_state' && message.process === 'autopost' && message.jobId === scanning.jobId && !['running', 'released', 'queue_changed'].includes(String(message.status))) { clearTimeout(timer); void finish(); }
    });
    return () => { clearTimeout(timer); off(); };
  }, [scanning, load]);

  async function scan() {
    await gate.current(async () => {
      setBusy(true); setError(''); setNote('');
      try {
        const response = await fetch('/api/messenger-automation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'telegram-scan-threads', chatId }) });
        const body = await response.json() as { created?: number; jobId?: string; reason?: string; error?: string };
        if (!response.ok) throw new Error(body.error || 'Не вдалося запустити перевірку.');
        if (!body.created || !body.jobId) { setNote(`Перевірку зараз не поставити: ${(body.reason || 'у чата вже є активна задача автопосту').replace(/[.]$/, '')}.`); return; }
        setScanning({ jobId: body.jobId, before: view?.scannedAt ?? null });
      } catch (reason) { setError(humanError(reason, 'Не вдалося запустити перевірку. Спробуй ще раз.')); }
      finally { setBusy(false); }
    });
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

  if (!view) return null;
  const offline = runner.connected && runner.runnerConnected === false;
  const recheck = scanning ? <output className="text-xs text-ink-2">Перевіряю…</output>
    : offline ? <span className="text-xs text-ink-2">Runner не підключений: запусти його на ПК, щоб перевірити гілки.</span>
      : <Button type="button" variant="outline" size="sm" className="self-start" disabled={disabled || busy} onClick={() => void scan()}>Перевірити гілки ще раз</Button>;
  const messages = (
    <>
      {note ? <output className="block text-xs text-ink-2">{note}</output> : null}
      {error ? <span role="alert" className="block text-xs text-hot">{error}</span> : null}
    </>
  );

  if (view.forum !== true) {
    return (
      <Field label="Гілка для автопосту">
        <div className="flex min-w-0 flex-col items-start gap-2">
          <p className="m-0 text-xs text-ink-2">
            {view.forum === false
              ? `Автопост не знайшов у цьому чаті гілок${view.scannedAt ? ` (перевірено ${when(view.scannedAt)})` : ''}: він публікує просто в чат. Якщо гілки там є, перевір ще раз.`
              : 'Автопост ще не відкривав цей чат, тож не знає, чи є в ньому гілки. Він збере їх під час першої публікації; можна перевірити зараз.'}
          </p>
          {recheck}
          {messages}
        </div>
      </Field>
    );
  }

  return (
    <Field label="Гілка для автопосту" htmlFor="chat-profile-thread">
      <Select id="chat-profile-thread" value={view.thread?.id ?? ''} disabled={disabled || busy || Boolean(scanning)} onChange={(event) => void choose(event.target.value)}>
        <option value="">Не вибрано</option>
        {view.topics.map((topic) => <option key={topic.id} value={topic.id} disabled={topic.closed}>{topic.title}{topic.closed ? ' · закрита' : ''}</option>)}
      </Select>
      <div className="mt-1 flex min-w-0 flex-col items-start gap-2">
        {view.scannedAt ? <span className="text-xs text-ink-2">Список гілок перевірено {when(view.scannedAt)}</span> : null}
        {recheck}
        {messages}
      </div>
    </Field>
  );
}
