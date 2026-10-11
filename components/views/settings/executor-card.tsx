'use client';

import { useCallback, useEffect, useState } from 'react';
import { Cable, Copy, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { EXECUTOR_DEVICE_STORAGE_KEY, EXECUTOR_TOKEN_STORAGE_KEY, storeExecutorToken } from '@/lib/chat-discovery/executor-storage';
import { humanError } from '@/components/ui/human-error';

type Device = { id: string; name: string; createdAt: number; lastSeenAt: number | null };
const formatTime = (value: number) => new Intl.DateTimeFormat('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value * 1000));

/** Підключення runner до авторизованого WhatsApp Web (executor): credential лишається лише в цьому браузері. */
export function ExecutorCard() {
  const toast = useToast();
  const [devices, setDevices] = useState<Device[]>([]);
  const [name, setName] = useState('Цей браузер');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/chat-discovery?executorDevices=1', { cache: 'no-store' });
      const body = await response.json() as { devices?: Device[]; error?: string };
      if (!response.ok) throw new Error(body.error || 'Не вдалося завантажити executor.');
      setDevices(body.devices || []);
    } catch (reason) { setError(humanError(reason, 'Не вдалося завантажити executor.')); }
  }, []);

  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);

  async function mutate(body: Record<string, unknown>) {
    const response = await fetch('/api/chat-discovery', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const payload = await response.json() as { token?: string; device?: { id: string }; error?: string };
    if (!response.ok) throw new Error(payload.error || 'Операцію executor не завершено.');
    return payload;
  }

  async function pair() {
    if (busy || !name.trim()) return;
    setBusy(true); setError(''); setToken('');
    try {
      const payload = await mutate({ action: 'pair-executor', name });
      const next = payload.token || '';
      setToken(next);
      if (next && payload.device?.id) storeExecutorToken(next, payload.device.id);
      await load();
    } catch (reason) { setError(humanError(reason, 'Не вдалося підключити executor.')); }
    finally { setBusy(false); }
  }

  async function revoke(deviceId: string) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await mutate({ action: 'revoke-executor', deviceId });
      if (window.localStorage.getItem(EXECUTOR_DEVICE_STORAGE_KEY) === deviceId) {
        window.localStorage.removeItem(EXECUTOR_TOKEN_STORAGE_KEY);
        window.localStorage.removeItem(EXECUTOR_DEVICE_STORAGE_KEY);
        setToken('');
      }
      await load();
    } catch (reason) { setError(humanError(reason, 'Не вдалося відключити executor.')); }
    finally { setBusy(false); }
  }

  return (
    <section className="flex flex-col gap-4" aria-label="Executor пошуку чатів">
      <p className="m-0 text-sm text-ink-2">Підключення runner до авторизованого WhatsApp Web. Credential зберігається локально в цьому браузері для фонового executor. Непідтверджений target зупиняє дію — Work OS не зараховує вступ, перевірку або вихід навмання.</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input aria-label="Назва executor" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} />
        <Button variant="outline" busy={busy} disabled={!name.trim()} onClick={() => void pair()}><Cable aria-hidden="true" strokeWidth={1.5} />Підключити</Button>
      </div>
      {token ? (
        <div className="flex flex-col gap-2 rounded-inner border border-line bg-sunken p-3">
          <p className="m-0 text-xs text-ink-2">Скопіюй token зараз — повторно він не показується.</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate font-mono text-xs">{token}</code>
            <Button variant="icon" size="sm" aria-label="Скопіювати executor token" onClick={() => void navigator.clipboard.writeText(token).then(() => toast.push({ message: 'Token скопійовано.' }))}><Copy aria-hidden="true" strokeWidth={1.5} /></Button>
          </div>
        </div>
      ) : null}
      {error ? <p role="alert" className="m-0 text-sm text-hot">{error}</p> : null}
      {devices.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {devices.map((device) => (
            <li key={device.id} className="flex items-center gap-3 rounded-inner border border-line px-4 py-2.5">
              <div className="min-w-0 flex-1"><p className="m-0 truncate text-sm font-medium">{device.name}</p><p className="m-0 text-xs text-ink-2">{device.lastSeenAt ? `Онлайн був ${formatTime(device.lastSeenAt)}` : 'Ще не підключався'}</p></div>
              <Button variant="icon" size="sm" tone="danger" disabled={busy} aria-label={`Відключити ${device.name}`} onClick={() => void revoke(device.id)}><Trash2 aria-hidden="true" strokeWidth={1.5} /></Button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
