'use client';

import { useRef, useState } from 'react';
import { Check, RefreshCw } from 'lucide-react';
import { Panel } from '@/components/shell/panel';
import { Button } from '@/components/ui/button';
import { humanError } from '@/components/ui/human-error';

type ScanStatus = 'updated' | 'unchanged' | 'confirm' | 'error';
type ScanItem = { id: string; platform: string; currentName: string; suggestedName: string | null; status: ScanStatus; updatedAt: number; error: string | null };
type PlatformCounts = { checked: number; updated: number; unchanged: number; confirm: number; error: number };
type ScanResponse = { items: ScanItem[]; counts: Record<string, PlatformCounts>; nextCursor: string | null; error?: string };
type Totals = PlatformCounts & { platforms: Record<string, PlatformCounts> };

const EMPTY = (): Totals => ({ checked: 0, updated: 0, unchanged: 0, confirm: 0, error: 0, platforms: {} });
const PLATFORM_LABEL: Record<string, string> = { telegram: 'Telegram', whatsapp: 'WhatsApp', viber: 'Viber', facebook: 'Facebook' };

function mergeTotals(current: Totals, next: Record<string, PlatformCounts>): Totals {
  const result: Totals = { ...current, platforms: { ...current.platforms } };
  for (const [platform, value] of Object.entries(next)) {
    const existing = result.platforms[platform] || { checked: 0, updated: 0, unchanged: 0, confirm: 0, error: 0 };
    result.platforms[platform] = { checked: existing.checked + value.checked, updated: existing.updated + value.updated, unchanged: existing.unchanged + value.unchanged, confirm: existing.confirm + value.confirm, error: existing.error + value.error };
    result.checked += value.checked; result.updated += value.updated; result.unchanged += value.unchanged; result.confirm += value.confirm; result.error += value.error;
  }
  return result;
}

/** Перевірка назв усіх чатів порціями; надійні ручні назви не перезаписуються без підтвердження. */
export function NamesPanel({ open, onClose, onChanged }: { open: boolean; onClose: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [totals, setTotals] = useState<Totals>(EMPTY);
  const [problems, setProblems] = useState<ScanItem[]>([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [resumeCursor, setResumeCursor] = useState<string | null>(null);
  const stopRef = useRef(false);

  async function scanAll() {
    const continuing = Boolean(resumeCursor) && !done;
    setBusy(true); if (!continuing) { setTotals(EMPTY()); setProblems([]); } setNotice(''); setError(''); setDone(false); stopRef.current = false;
    let cursor: string | null = continuing ? resumeCursor : null;
    let changed = false;
    try {
      do {
        const response = await fetch('/api/chats/names', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'scan', cursor, limit: 12 }) });
        const body = await response.json() as ScanResponse;
        if (!response.ok) throw new Error(body.error || 'Не вдалося перевірити назви чатів.');
        setTotals((current) => mergeTotals(current, body.counts));
        setProblems((current) => [...current, ...body.items.filter((item) => item.status === 'confirm' || item.status === 'error')].slice(-300));
        if (body.items.some((item) => item.status === 'updated')) changed = true;
        cursor = body.nextCursor;
        if (stopRef.current) break;
      } while (cursor);
      setResumeCursor(cursor);
      setDone(!cursor);
      setNotice(stopRef.current ? 'Перевірку зупинено після поточної порції. Можна продовжити з цього місця.' : 'Перевірку завершено.');
      if (changed) onChanged();
    } catch (reason) {
      setError(humanError(reason, 'Не вдалося перевірити назви чатів.'));
    } finally { setBusy(false); }
  }

  async function confirm(item: ScanItem) {
    if (!item.suggestedName) return;
    setError('');
    try {
      const response = await fetch('/api/chats/names', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'confirm', id: item.id, name: item.suggestedName, expectedUpdatedAt: item.updatedAt }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || 'Не вдалося підтвердити назву.');
      setProblems((current) => current.filter((row) => row.id !== item.id));
      setTotals((current) => {
        const platform = current.platforms[item.platform];
        return { ...current, confirm: Math.max(0, current.confirm - 1), updated: current.updated + 1, platforms: platform ? { ...current.platforms, [item.platform]: { ...platform, confirm: Math.max(0, platform.confirm - 1), updated: platform.updated + 1 } } : current.platforms };
      });
      onChanged();
    } catch (reason) { setError(humanError(reason, 'Не вдалося підтвердити назву.')); }
  }

  function close() {
    if (busy) { stopRef.current = true; setNotice('Зупиняємо після поточної порції…'); return; }
    onClose();
  }

  const summary = [['Перевірено', totals.checked], ['Оновлено', totals.updated], ['Без змін', totals.unchanged], ['Підтвердити', totals.confirm], ['Помилки', totals.error]] as const;
  return (
    <Panel open={open} onOpenChange={(next) => { if (!next) close(); }} title="Перевірити назви всіх чатів" subtitle="Work OS читає публічні сторінки Telegram, WhatsApp, Viber і Facebook порціями. Помилка одного посилання не зупиняє решту, а надійна ручна назва не перезаписується без твого підтвердження.">
      <div className="flex flex-col gap-4">
        {error ? <p role="alert" className="m-0 text-sm text-hot">{error}</p> : null}
        {notice ? <output className="block text-sm text-ink-2">{notice}</output> : null}
        <dl className="m-0 grid grid-cols-5 gap-2 text-center" aria-live="polite">
          {summary.map(([label, value]) => <div key={label} className="rounded-inner border border-line bg-sunken px-1.5 py-2"><dt className="text-[11px] text-ink-2">{label}</dt><dd className="m-0 font-mono text-lg">{value}</dd></div>)}
        </dl>
        {Object.keys(totals.platforms).length > 0 ? (
          <p className="m-0 flex flex-col gap-0.5 text-xs text-ink-2">{Object.entries(totals.platforms).map(([platform, count]) => <span key={platform}>{PLATFORM_LABEL[platform] ?? platform}: {count.checked} · оновлено {count.updated} · помилок {count.error}</span>)}</p>
        ) : null}
        {totals.confirm + totals.error > problems.length ? <p className="m-0 text-xs text-ink-2">Показано останні {problems.length} із {totals.confirm + totals.error} проблемних чатів. Загальні лічильники вище враховують усі результати.</p> : null}
        {problems.length > 0 ? (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {problems.map((item) => (
              <li key={item.id} data-status={item.status} className="flex items-start justify-between gap-3 rounded-inner border border-line bg-sunken px-4 py-3">
                <div className="min-w-0 text-sm">
                  <p className="m-0 truncate font-medium">{item.currentName} <span className="text-xs font-normal text-ink-2">{PLATFORM_LABEL[item.platform] ?? item.platform}</span></p>
                  {item.status === 'confirm' && item.suggestedName ? <p className="m-0 text-xs text-ink-2">Знайдено: <b className="font-medium text-ink">{item.suggestedName}</b></p> : <p className="m-0 text-xs text-hot">{item.error || 'Назву не вдалося визначити.'}</p>}
                </div>
                {item.status === 'confirm' && item.suggestedName ? <Button variant="outline" size="sm" disabled={busy} onClick={() => void confirm(item)}><Check aria-hidden="true" strokeWidth={1.5} />Замінити</Button> : null}
              </li>
            ))}
          </ul>
        ) : null}
        {!busy && done && totals.checked === 0 ? <p className="m-0 text-sm text-ink-2">Чатів для перевірки не знайдено.</p> : null}
        <div className="flex justify-end gap-2">
          {busy ? (
            <><Button variant="outline" onClick={() => { stopRef.current = true; }}>Зупинити</Button><Button variant="action" busy>Перевіряємо…</Button></>
          ) : (
            <><Button variant="ghost" onClick={onClose}>Закрити</Button><Button variant="action" onClick={() => void scanAll()}><RefreshCw aria-hidden="true" strokeWidth={1.5} />{resumeCursor && !done ? 'Продовжити перевірку' : done ? 'Перевірити ще раз' : 'Почати перевірку'}</Button></>
          )}
        </div>
      </div>
    </Panel>
  );
}
