'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { MultiSelect, type SearchOption } from '@/components/ui/combobox';
import { humanError } from '@/components/ui/human-error';
import { useRemote } from '@/components/views/shared/use-remote';
import { canonicalDirection, FOCUS_DIRECTIONS } from '@/lib/directions';
import { cleanDictionaryName, sameName, type Dictionaries } from '@/lib/library-dictionaries';
import { nameSimilarity, SIMILAR_NAME_THRESHOLD } from '@/lib/name-similarity';

type DictionaryPayload = { dictionaries: Dictionaries };

/**
 * Цільові напрямки чату: вибір зі спільного довідника «Напрямки» (той самий, що в редакторі Бібліотеки), пошук, чіпи з «×», нове
 * значення створюється з поля й одразу потрапляє в довідник. Значення, збережені в профілях раніше й відсутні в довіднику (ручне
 * введення), лишаються й видно окремо: їх можна додати в довідник або замінити схожим напрямком. Формат збереження не змінюється.
 */
export function DirectionsField({ id, values, onChange, disabled }: { id: string; values: string[]; onChange: (values: string[]) => void; disabled?: boolean }) {
  const dictionary = useRemote<DictionaryPayload>('/api/library/dictionaries', { revalidateOnEnable: true, fallback: 'Не вдалося завантажити довідник напрямків.' });
  const [added, setAdded] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const names = useMemo(() => {
    const base = [...(dictionary.data?.dictionaries.directions ?? []), ...added];
    return base.filter((name, index) => base.findIndex((other) => sameName(other, name)) === index);
  }, [dictionary.data, added]);
  const loaded = dictionary.data !== null;
  // Сервер зводить «ІТ» і «Шахи» до «ІТ та шахи», тож таке значення вважаємо відомим, хоч у довіднику вони окремо.
  const isKnown = (value: string) => names.some((name) => sameName(name, value)) || (FOCUS_DIRECTIONS as readonly string[]).includes(value)
    || names.some((name) => canonicalDirection(name) === canonicalDirection(value));
  const known = loaded ? values.filter(isKnown) : values;
  const unknown = loaded ? values.filter((value) => !isKnown(value)) : [];
  const options: SearchOption[] = useMemo(() => {
    const extra = known.filter((value) => !names.some((name) => sameName(name, value)));
    return [...names, ...extra].map((name) => ({ value: name, label: name }));
  }, [names, known]);

  async function saveToDictionary(name: string): Promise<boolean> {
    const clean = cleanDictionaryName(name);
    if (!clean) return false;
    if (names.some((item) => sameName(item, clean))) return true;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/library/dictionaries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', directions: [...names, clean] }) });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || 'Не вдалося додати напрямок у довідник.');
      setAdded((current) => [...current, clean]);
      return true;
    } catch (reason) {
      setError(humanError(reason, 'Не вдалося додати напрямок у довідник.'));
      return false;
    } finally { setBusy(false); }
  }

  const similarTo = (value: string) => {
    let best: { name: string; score: number } | null = null;
    for (const name of names) {
      const score = Math.max(nameSimilarity(name, value), name.toLocaleLowerCase('uk-UA').includes(value.toLocaleLowerCase('uk-UA')) || value.toLocaleLowerCase('uk-UA').includes(name.toLocaleLowerCase('uk-UA')) ? SIMILAR_NAME_THRESHOLD : 0);
      if (score >= SIMILAR_NAME_THRESHOLD && (!best || score > best.score)) best = { name, score };
    }
    return best?.name ?? null;
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <MultiSelect
        id={id}
        options={options}
        values={known}
        onChange={(next) => onChange([...next, ...unknown])}
        onCreate={(name) => { void saveToDictionary(name); }}
        disabled={disabled || busy}
        placeholder={loaded ? 'Додати напрямок' : 'Завантажую довідник…'}
        searchPlaceholder="Пошук або новий напрямок"
        createLabel="Додати в довідник"
      />
      {error || dictionary.error ? <p role="alert" className="m-0 text-xs text-hot">{error || dictionary.error}</p> : null}
      {unknown.length ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Напрямки, яких немає в довіднику">
          {unknown.map((value) => {
            const similar = similarTo(value);
            return (
              <li key={value} className="flex flex-col gap-2 rounded-inner border border-dashed border-line-strong px-3 py-2.5">
                <p className="m-0 flex flex-wrap items-baseline gap-x-2 text-sm"><span className="font-medium">{value}</span><span className="text-xs text-ink-2">немає в довіднику</span></p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" disabled={disabled || busy} onClick={() => void saveToDictionary(value)}>Додати в довідник</Button>
                  {similar ? <Button variant="outline" size="sm" disabled={disabled || busy} onClick={() => onChange([...known.filter((item) => !sameName(item, similar)), similar, ...unknown.filter((item) => item !== value)])}>Замінити на «{similar}»</Button> : null}
                  <Button variant="ghost" size="sm" disabled={disabled || busy} onClick={() => onChange([...known, ...unknown.filter((item) => item !== value)])}>Прибрати</Button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
