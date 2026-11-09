'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { useToast } from '@/components/ui/toast';
import { PoolPanel } from '@/components/views/platforms/pool-panel';
import { AUDIENCE_NAMES, endingText, fetchPool, type PoolView } from '@/components/views/platforms/pool-types';

/**
 * Пул текстових оголошень автопосту Telegram у Бібліотеці: той самий список, що в картці автопосту (вставка, заміна, додавання там же).
 * Тут його видно цілком: напрям, аудиторія, мова, термін і чи вільний текст сьогодні.
 */
export default function PoolSection({ active, query }: { active: boolean; query: string }) {
  const toast = useToast();
  const [pool, setPool] = useState<PoolView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [direction, setDirection] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const load = useCallback(() => { void fetchPool().then((value) => { setPool(value); setError(null); }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Не вдалося прочитати пул.')); }, []);
  useEffect(() => { if (active) load(); }, [active, load]);
  const needle = query.trim().toLocaleLowerCase('uk');
  const shown = useMemo(() => (pool?.items ?? []).filter((item) => (direction === null || (item.direction || 'Без напряму') === direction)
    && (!needle || item.text.toLocaleLowerCase('uk').includes(needle) || item.direction.toLocaleLowerCase('uk').includes(needle))), [pool, direction, needle]);
  const copy = (text: string) => { void navigator.clipboard.writeText(text).then(() => toast.push({ message: 'Текст скопійовано.' }), () => toast.push({ message: 'Не вдалося скопіювати текст.' })); };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="m-0 text-sm text-ink-2">
          {pool ? <>Пул Telegram: <b className="font-mono font-medium tabular-nums text-ink">{pool.summary.total}</b> · вільних сьогодні <b className="font-mono font-medium tabular-nums text-ink">{pool.summary.free}</b>{pool.summary.ending.length ? ` · ${endingText(pool.summary)}` : ''}{pool.summary.expired ? ` · минув термін: ${pool.summary.expired}` : ''}</> : error ? '' : 'Читаю пул…'}
        </p>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>{pool?.summary.total ? 'Оновити список' : 'Вставити список'}</Button>
      </div>
      {error ? <div className="flex flex-wrap items-center gap-3"><p role="alert" className="m-0 text-sm text-hot">{error}</p><Button variant="outline" size="sm" onClick={load}>Спробувати ще раз</Button></div> : null}
      {pool && pool.summary.byDirection.length > 1 ? (
        <fieldset className="hide-scrollbar m-0 flex min-w-0 items-center gap-2 overflow-x-auto border-0 p-0">
          <legend className="sr-only">Фільтр пулу за напрямом</legend>
          <Chip pressed={direction === null} onClick={() => setDirection(null)}>Усі напрями</Chip>
          {pool.summary.byDirection.map((entry) => <Chip key={entry.direction || 'none'} pressed={direction === (entry.direction || 'Без напряму')} onClick={() => setDirection(entry.direction || 'Без напряму')}>{entry.direction || 'Без напряму'} <span className="font-mono tabular-nums text-ink-2">{entry.free}/{entry.total}</span></Chip>)}
        </fieldset>
      ) : null}
      {pool && pool.items.length === 0 ? <p className="m-0 rounded-inner border border-line px-4 py-3 text-sm text-ink-2">Пул порожній. Вставте список оголошень: Work OS розпізнає напрям, аудиторію й мову, а на автопості Telegram підбере текст кожному чату й не видасть жоден текст двічі за добу.</p> : null}
      {pool && pool.items.length > 0 && shown.length === 0 ? <p className="m-0 text-sm text-ink-2">За цим фільтром текстів немає.</p> : null}
      <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 @4xl:grid-cols-2">
        {shown.map((item) => (
          <li key={item.id} className="flex flex-col gap-1.5 rounded-inner border border-line p-3">
            <div className="flex items-start gap-2">
              <i aria-hidden="true" className={`mt-1.5 size-2 shrink-0 rounded-full ${item.expired ? 'bg-hot' : item.free ? 'bg-ok' : 'bg-ink-3'}`} />
              <p className="m-0 min-w-0 flex-1 text-sm font-medium">{item.snippet}</p>
            </div>
            <p className="m-0 pl-4 text-xs text-ink-2">
              {[item.direction || 'Без напряму', AUDIENCE_NAMES[item.audience], item.language === 'ru' ? 'RU' : 'UA', item.until ? `до ${item.until.split('-').reverse().join('.')}` : null, item.expired ? 'термін минув' : item.free ? 'вільний сьогодні' : 'сьогодні вже використано', item.author || null].filter(Boolean).join(' · ')}
            </p>
            <details className="group pl-4">
              <summary className="cursor-pointer list-none text-xs text-ink-2 [&::-webkit-details-marker]:hidden"><span className="underline decoration-line-strong underline-offset-4">Текст</span></summary>
              <p className="m-0 mt-2 whitespace-pre-wrap break-words text-[13px] text-ink-2">{item.text}</p>
              <Button variant="ghost" size="sm" className="mt-2" onClick={() => copy(item.text)}>Копіювати</Button>
            </details>
          </li>
        ))}
      </ul>
      <PoolPanel open={open} onOpenChange={setOpen} total={pool?.summary.total ?? 0} onSaved={load} />
    </div>
  );
}
