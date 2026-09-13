'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

type LeaveState = { required: boolean; confirmed: boolean; confirmedAt: number | null };
type LeaveChat = { id: string; stateToken: string; platform: string; name: string };

export function ChatLeaveChecklist({ chat, onChanged }: { chat: LeaveChat; onChanged?: (stateToken?: string) => void }) {
  const [state, setState] = useState<LeaveState | null>(null);
  const [stateToken, setStateToken] = useState(chat.stateToken);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setStateToken(chat.stateToken);
    setError('');
    fetch(`/api/chats/leave?id=${encodeURIComponent(chat.id)}`, { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json() as LeaveState & { error?: string };
        if (!response.ok) throw new Error(body.error || 'Не вдалося перевірити вихід із чату.');
        if (!cancelled) setState(body);
      })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Не вдалося перевірити вихід із чату.'); });
    return () => { cancelled = true; };
  }, [chat.id, chat.stateToken]);

  async function change(confirm: boolean) {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/chats/leave', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: chat.id, stateToken, confirm }),
      });
      const body = await response.json() as { error?: string; stateToken?: string; leave?: LeaveState };
      if (!response.ok) throw new Error(body.error || 'Не вдалося оновити чекліст виходу.');
      if (body.leave) setState(body.leave);
      if (body.stateToken) setStateToken(body.stateToken);
      onChanged?.(body.stateToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не вдалося оновити чекліст виходу.');
    } finally { setBusy(false); }
  }

  if (error) return <div className="workspace-error" role="alert">{error}</div>;
  if (!state?.required) return null;
  return <div className="chat-leave-checklist">
    <div><strong>Вихід із чату</strong><p className="muted-note">Перед остаточним прибиранням архівного {chat.platform === 'telegram' ? 'Telegram' : 'WhatsApp'}-чату підтвердь, що ти реально вийшов із нього.</p></div>
    {state.confirmed ? <div className="chat-leave-confirmed"><span>✓ Вихід підтверджено</span>{state.confirmedAt && <time dateTime={new Date(state.confirmedAt * 1000).toISOString()}>{new Intl.DateTimeFormat('uk-UA', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Kyiv' }).format(new Date(state.confirmedAt * 1000))}</time>}<Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void change(false)}>Скасувати підтвердження</Button></div>
      : <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void change(true)}>Я вийшов із чату</Button>}
  </div>;
}
