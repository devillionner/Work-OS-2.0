'use client';

import { useMemo, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';

/** Оголошення Бібліотеки в режимі «Оголошення з Бібліотеки»: те, що віддає план (`plan.library.ads`). */
export type LibraryAdView = { id: string; title: string; directions: string[]; scope: 'wide' | 'exclusive'; image: boolean; imageKey: string | null; fits: number };
export type LibraryAdsPlan = { selected: string[]; needSelection: boolean; ads: LibraryAdView[] };

const chatsWord = (count: number) => {
  const tail = count % 100; const last = count % 10;
  return tail >= 11 && tail <= 14 ? 'чатам' : last === 1 ? 'чату' : 'чатам';
};

/** Зберігає спільний вибір оголошень (один для Viber, WhatsApp і Telegram). */
export async function saveAdsSelection(ids: string[]): Promise<string[]> {
  const response = await fetch('/api/messenger-automation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'autopost-ads-save', ids }) });
  const body = await response.json().catch(() => ({})) as { ids?: string[]; error?: string };
  if (!response.ok) throw new Error(body.error || 'Не вдалося зберегти вибір оголошень.');
  return body.ids ?? ids;
}

/** Режим WhatsApp і Viber: «Оголошення з Бібліотеки» чи «Власний текст і фото» (спільний для двох платформ). */
export function useSharedSource(onChanged: () => void) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const change = (mode: 'library' | 'own') => {
    setBusy(true);
    void fetch('/api/messenger-automation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'autopost-source', mode }) })
      .then(async (response) => { if (!response.ok) { const body = await response.json().catch(() => ({})) as { error?: string }; throw new Error(body.error || 'Не вдалося змінити режим.'); } onChanged(); toast.push({ message: mode === 'library' ? 'Публікуємо оголошення з Бібліотеки: кожен чат отримає підходяще з обраних.' : 'Публікуємо власний текст і фото: усі чати отримають однаковий матеріал.' }); })
      .catch((error: unknown) => toast.push({ message: error instanceof Error ? error.message : 'Не вдалося змінити режим.' }))
      .finally(() => setBusy(false));
  };
  return { busy, change };
}

/**
 * Вибір оголошень Бібліотеки для автопосту: картки з мініатюрою фото, назвою, напрямами, охопленням («Широке» / «Лише свій напрям») і числом чатів цієї
 * платформи, яким оголошення підійде. Вибір спільний для Viber, WhatsApp і Telegram; зберігається одразу, кожен чат у партії отримає підходяще з обраних.
 */
export function LibraryAdsPicker({ plan, busy, onSaved }: { plan: LibraryAdsPlan; busy: boolean; onSaved: () => void }) {
  const toast = useToast();
  const [query, setQuery] = useState('');
  // Оптимістичний вибір діє, поки план не повернув свій (його ключ змінився).
  const [local, setLocal] = useState<{ base: string; ids: string[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const selectedKey = plan.selected.join(',');
  const selected = local && local.base === selectedKey ? local.ids : plan.selected;
  const chosen = useMemo(() => new Set(selected), [selected]);
  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('uk');
    return needle ? plan.ads.filter((ad) => `${ad.title} ${ad.directions.join(' ')}`.toLocaleLowerCase('uk').includes(needle)) : plan.ads;
  }, [plan.ads, query]);
  const save = (ids: string[]) => {
    setLocal({ base: selectedKey, ids }); setSaving(true);
    void saveAdsSelection(ids)
      .then((saved) => { setLocal({ base: selectedKey, ids: saved }); onSaved(); })
      .catch((error: unknown) => { setLocal(null); toast.push({ message: error instanceof Error ? error.message : 'Не вдалося зберегти вибір оголошень.' }); })
      .finally(() => setSaving(false));
  };
  const toggle = (id: string) => save(chosen.has(id) ? selected.filter((item) => item !== id) : [...selected, id]);
  const allShown = shown.length > 0 && shown.every((ad) => chosen.has(ad.id));
  const toggleAll = () => save(allShown ? selected.filter((id) => !shown.some((ad) => ad.id === id)) : [...new Set([...selected, ...shown.map((ad) => ad.id)])]);
  const disabled = busy || saving;

  if (!plan.ads.length) return <p className="m-0 text-sm text-ink-2">У Бібліотеці немає оголошень для цієї платформи. Додай оголошення в розділі «Бібліотека», тоді вони з’являться тут.</p>;
  return (
    <section className="flex flex-col gap-3" aria-label="Оголошення Бібліотеки для автопосту">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="m-0 text-xs text-ink-2">Спільний вибір для Viber, WhatsApp і Telegram · обрано <span className="tabular-nums text-ink">{selected.length}</span> з <span className="tabular-nums">{plan.ads.length}</span></p>
        <Button variant="ghost" size="sm" disabled={disabled} onClick={toggleAll}>{allShown ? 'Зняти всі' : 'Вибрати всі'}</Button>
      </div>
      {plan.ads.length > 6 ? <Input type="search" inputMode="search" autoComplete="off" aria-label="Пошук оголошення" placeholder="Назва або напрям" value={query} onChange={(event) => setQuery(event.target.value)} /> : null}
      <ul className="m-0 flex max-h-96 list-none flex-col divide-y divide-line overflow-y-auto rounded-inner border border-line p-0 scroll-soft">
        {shown.map((ad) => {
          const on = chosen.has(ad.id);
          return (
            <li key={ad.id}>
              <label className={`flex cursor-pointer items-center gap-3 px-3 py-3 transition-colors hover:bg-raised ${on ? 'bg-sunken' : ''}`}>
                <input type="checkbox" className="size-4 shrink-0 accent-[var(--ink)]" checked={on} disabled={disabled} onChange={() => toggle(ad.id)} aria-label={`Обрати оголошення ${ad.title}`} />
                {ad.image ? <span aria-hidden="true" style={{ backgroundImage: `url(/api/library/image?id=${encodeURIComponent(ad.id)}&v=${(ad.imageKey ?? '').slice(0, 16)})` }} className="size-12 shrink-0 rounded-field border border-line bg-cover bg-center" />
                  : <span aria-hidden="true" title="Без фото: піде лише текст" className="flex size-12 shrink-0 items-center justify-center rounded-field border border-dashed border-line-strong text-ink-3"><ImagePlus strokeWidth={1.5} className="size-5" /></span>}
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium" title={ad.title}>{ad.title}</span>
                  <span className="truncate text-xs text-ink-2">{ad.directions.length ? ad.directions.join(', ') : 'Без напряму'} · {ad.scope === 'exclusive' ? 'Лише свій напрям' : 'Широке'}</span>
                  <span className="text-xs text-ink-3">підійде <span className="tabular-nums">{ad.fits}</span> {chatsWord(ad.fits)}{ad.image ? '' : ' · без фото'}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {shown.length === 0 ? <p className="m-0 text-sm text-ink-2">Оголошень із такою назвою чи напрямом немає.</p> : null}
      {plan.needSelection ? <output className="m-0 text-sm text-warn">Обери хоча б одне оголошення, щоб запустити партію.</output> : null}
    </section>
  );
}
