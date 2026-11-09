'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PoolPreview } from '@/components/views/platforms/pool-types';

type Args = { limit: number; exclude: string[] };

/**
 * Підбір текстів для «Переглянути чати партії» (Telegram з пулом): сервер рахує той самий розподіл, що й запуск, але нічого не створює.
 * Запит іде лише поки список партії відкрито й коли змінилась партія чи вибір тексту; перед запуском `overrides` додаються до запиту.
 */
export function usePoolPreview(accountId: string | null) {
  const [data, setData] = useState<PoolPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  /** Чати, для яких власник сам вибрав текст («Змінити»): лише вони підписані «вибрано вручну». */
  const [manual, setManual] = useState<Record<string, string>>({});
  const last = useRef<Args | null>(null);
  const token = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overridesRef = useRef(overrides);
  useEffect(() => { overridesRef.current = overrides; });
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const run = useCallback((args: Args, texts: Record<string, string>) => {
    if (!accountId) return;
    last.current = args;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const mine = ++token.current;
      setLoading(true);
      void fetch('/api/messenger-automation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'telegram-pool-preview', accountId, limit: args.limit, exclude: args.exclude, texts }) })
        .then(async (response) => ({ ok: response.ok, body: await response.json() as { preview?: PoolPreview } }))
        .then(({ ok, body }) => { if (mine === token.current && ok && body.preview) setData(body.preview); })
        .catch(() => undefined)
        .finally(() => { if (mine === token.current) setLoading(false); });
    }, 250);
  }, [accountId]);

  const load = useCallback((args: Args) => run(args, overridesRef.current), [run]);
  const dataRef = useRef(data);
  useEffect(() => { dataRef.current = data; });
  const manualRef = useRef(manual);
  useEffect(() => { manualRef.current = manual; });
  // Зміна тексту в одному чаті не має ворушити решту: показані тексти закріплюються, тож вивільнений текст просто стає вільним варіантом.
  const choose = useCallback((chatId: string, adId: string | null) => {
    const pinned = Object.fromEntries(Object.entries(dataRef.current?.items ?? {}).map(([chat, item]) => [chat, item.adId]));
    const nextManual = { ...manualRef.current };
    if (adId) nextManual[chatId] = adId; else delete nextManual[chatId];
    const next = { ...pinned, ...overridesRef.current, ...nextManual };
    if (!adId) delete next[chatId];
    setManual(nextManual);
    setOverrides(next);
    if (last.current) run(last.current, next);
  }, [run]);
  const clear = useCallback(() => { setOverrides({}); setManual({}); }, []);
  return { data, loading, overrides, manual, load, choose, clear };
}
