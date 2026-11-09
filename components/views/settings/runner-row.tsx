'use client';

import { useCallback, useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { getLatestTransfer, subscribeLiveMessages, subscribeLiveStatus, type LiveStatus, type RunnerTransfer } from '@/lib/live-channel';
import { Row } from './ui';

type Backup = { id: string; createdAt: number; sizeBytes: number; version: string; host: string };
const CHECK_COMMAND = '~/.local/share/work-os/runner/scripts/install-runner.sh --check';
/** Прогрес, старший за цей час без завершення, вважається застарілим (runner міг впасти). */
const STALE_MS = 10 * 60_000;

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  if (bytes < 1024 ** 3) return `${Math.round(bytes / 1024 / 1024)} МБ`;
  return `${(bytes / 1024 ** 3).toFixed(1).replace('.', ',')} ГБ`;
}
function formatWhen(seconds: number): string {
  const date = new Date(seconds * 1000);
  const two = (value: number) => String(value).padStart(2, '0');
  return `${two(date.getDate())}.${two(date.getMonth() + 1)} о ${two(date.getHours())}:${two(date.getMinutes())}`;
}
function formatLeft(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * «Runner на цьому ПК»: стан зв'язку з live-каналу (без запитів до бази) і дві дії для переїзду.
 * «Встановити на новій системі» — одна команда з одноразовим кодом (15 хв); «Зберегти для перенесення» — runner на ПК шифрує входи паролем,
 * який вводиться у вікні на ПК, і вивантажує архів у хмару; прогрес іде live-каналом, пароль у Work OS не потрапляє.
 */
export function RunnerRow() {
  const toast = useToast();
  const [status, setStatus] = useState<LiveStatus>({ connected: false, runnerConnected: null });
  const [backups, setBackups] = useState<Backup[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [transfer, setTransfer] = useState<RunnerTransfer | null>(() => getLatestTransfer());
  const [code, setCode] = useState<{ value: string; expiresAt: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const origin = typeof window === 'undefined' ? '' : window.location.origin;

  const load = useCallback(() => {
    void fetch('/api/runner/backup', { cache: 'no-store' }).then((response) => response.json() as Promise<{ backups?: Backup[]; available?: boolean }>)
      .then((body) => { setBackups(body.backups ?? []); setAvailable(body.available !== false); }).catch(() => setBackups((current) => current ?? []));
  }, []);
  useEffect(() => subscribeLiveStatus(setStatus), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => subscribeLiveMessages((message) => {
    if (message.type === 'hello') { setTransfer(getLatestTransfer()); setNow(Date.now()); return; }
    if (message.type === 'progress' && message.process === 'runner_transfer') {
      const next = getLatestTransfer();
      setTransfer(next);
      setNow(Date.now());
      if (next?.phase === 'done') load();
    }
  }), [load]);
  // Зворотний відлік коду: локальний таймер без запитів, лише поки код показано.
  useEffect(() => {
    if (!code) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [code]);

  const state = !status.connected ? 'Зв’язок із сервером перевіряється.' : status.runnerConnected === null ? 'Стан runner ще не відомий.' : status.runnerConnected ? `Runner підключений${status.runnerVersion ? `, версія ${status.runnerVersion}` : ''}.` : 'Runner не підключений.';
  const post = async (url: string, body: unknown) => {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Не вдалося виконати дію.');
    return data;
  };
  const createCode = async () => {
    setBusy(true);
    try {
      const data = await post('/api/runner/enroll', { action: 'create' }) as { code: string; expiresAt: number };
      setCode({ value: data.code, expiresAt: data.expiresAt * 1000 });
      setNow(Date.now());
    } catch (error) { toast.push({ message: error instanceof Error ? error.message : 'Не вдалося створити код.' }); }
    finally { setBusy(false); }
  };
  const startBackup = async () => {
    setBusy(true);
    try { await post('/api/runner/transfer', { action: 'backup' }); setTransfer({ op: 'backup', phase: 'asking', text: 'Чекаю на пароль у вікні на ПК', percent: 0, bytes: 0, total: 0, at: Date.now() }); }
    catch (error) { toast.push({ message: error instanceof Error ? error.message : 'Не вдалося запустити збереження.' }); }
    finally { setBusy(false); }
  };
  const cancel = () => { void post('/api/runner/transfer', { action: 'cancel' }).catch(() => undefined); };
  const remove = async (id: string) => {
    setBusy(true);
    try { const data = await post('/api/runner/backup', { action: 'delete', id }) as { backups: Backup[] }; setBackups(data.backups); toast.push({ message: 'Архів видалено з хмари.' }); }
    catch (error) { toast.push({ message: error instanceof Error ? error.message : 'Не вдалося видалити архів.' }); }
    finally { setBusy(false); setConfirmDelete(false); }
  };
  const copy = (text: string, message: string) => void navigator.clipboard.writeText(text).then(() => toast.push({ message }));

  const left = code ? code.expiresAt - now : 0;
  const command = code ? `curl -fsSL ${origin}/runner/install | bash -s -- --site ${origin} --code ${code.value}` : '';
  const running = transfer !== null && !['done', 'error'].includes(transfer.phase) && now - transfer.at < STALE_MS;
  const failed = transfer?.phase === 'error' && now - transfer.at < 60 * 60_000;
  const latest = backups?.[0] ?? null;

  return (
    <Row label="Runner на цьому ПК" description={`${state} Новий ПК чи інша система Linux: встанови одну командою з одноразовим кодом, а входи в WhatsApp, Telegram і Viber перенеси зашифрованим архівом із хмари: без QR-кодів.`} stacked>
      <div className="flex w-full min-w-0 flex-col gap-4">
        <section className="flex min-w-0 flex-col gap-2" aria-label="Встановити на новій системі">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="m-0 text-sm font-medium">Встановити на новій системі</h3>
            <Button variant="outline" size="sm" busy={busy} disabled={busy} onClick={() => void createCode()}>{code && left > 0 ? 'Новий код' : 'Створити код'}</Button>
          </div>
          {code ? (
            <div className="flex min-w-0 items-center gap-2 rounded-inner border border-line bg-sunken px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="m-0 text-xs text-ink-2">{left > 0 ? <>Одноразовий код діє ще <span className="font-mono tabular-nums text-ink">{formatLeft(left)}</span></> : 'Код прострочено: створи новий'}</p>
                <code className={`block break-all font-mono text-xs ${left > 0 ? '' : 'text-ink-3 line-through'}`}>{command}</code>
              </div>
              <Button variant="icon" size="sm" aria-label="Скопіювати команду встановлення" disabled={left <= 0} onClick={() => copy(command, 'Команду скопійовано.')}><Copy aria-hidden="true" strokeWidth={1.5} /></Button>
            </div>
          ) : <p className="m-0 text-xs text-ink-2">Команду видно лише тут і лише після створення коду: код одноразовий. Пакет runner завантажується з цього сайту й перевіряється за SHA-256; репозиторій і git на ПК не потрібні.</p>}
          <div className="flex min-w-0 items-center gap-2 rounded-inner border border-line bg-sunken px-3 py-2">
            <div className="min-w-0 flex-1"><p className="m-0 text-xs text-ink-2">Перевірити готовність на ПК</p><code className="block truncate font-mono text-xs" title={CHECK_COMMAND}>{CHECK_COMMAND}</code></div>
            <Button variant="icon" size="sm" aria-label="Скопіювати команду перевірки" onClick={() => copy(CHECK_COMMAND, 'Команду скопійовано.')}><Copy aria-hidden="true" strokeWidth={1.5} /></Button>
          </div>
        </section>

        <section className="flex min-w-0 flex-col gap-2" aria-label="Зберегти для перенесення">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="m-0 text-sm font-medium">Зберегти для перенесення</h3>
            {running
              ? <Button variant="outline" size="sm" onClick={cancel}>Скасувати</Button>
              : <Button variant="outline" size="sm" busy={busy} disabled={busy || !available || status.runnerConnected !== true} title={status.runnerConnected === true ? undefined : 'Runner має бути підключений'} onClick={() => void startBackup()}>Зберегти для перенесення</Button>}
          </div>
          {running && transfer ? (
            <output className="flex flex-col gap-1.5 rounded-inner border border-line px-3 py-2">
              <p className="m-0 text-sm">{transfer.text}</p>
              <span aria-hidden="true" className="block h-1.5 overflow-hidden rounded-full bg-sunken"><span className="block h-full rounded-full bg-action transition-[width] duration-300" style={{ width: `${Math.max(2, Math.min(100, transfer.percent ?? 0))}%` }} /></span>
              <p className="m-0 text-xs text-ink-2">Пароль вводиться у вікні на ПК і до Work OS не доходить. Браузер runner і Android на цей час закриваються, потім усе повертається.</p>
            </output>
          ) : failed && transfer ? <p role="alert" className="m-0 text-sm text-hot">{transfer.text}</p> : null}
          {!available ? <p className="m-0 text-xs text-ink-2">Сховище для архіву не підключене на цьому середовищі.</p> : latest ? (
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <p className="m-0">Збережено <span className="font-mono tabular-nums">{formatWhen(latest.createdAt)}</span> · <span className="font-mono tabular-nums">{formatBytes(latest.sizeBytes)}</span>{latest.host ? <span className="text-ink-2"> · {latest.host}</span> : null}</p>
              <Button variant="ghost" size="sm" tone="danger" disabled={busy || running} onClick={() => setConfirmDelete(true)}>Видалити архів із хмари</Button>
            </div>
          ) : backups !== null ? <p className="m-0 text-xs text-ink-2">Архіву ще немає. Архів зашифровано паролем, який знаєш лише ти: без нього його не відкрити, відновити пароль неможливо.</p> : null}
        </section>
      </div>
      <ConfirmDialog open={confirmDelete} title="Видалити архів із хмари" description="Архів входів буде видалено назавжди. Щоб переїхати на іншу систему, доведеться зберегти новий." confirmLabel="Видалити" destructive busy={busy} onCancel={() => setConfirmDelete(false)} onConfirm={() => latest && void remove(latest.id)} />
    </Row>
  );
}
