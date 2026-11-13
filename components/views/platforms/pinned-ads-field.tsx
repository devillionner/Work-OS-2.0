'use client';

import { useMemo } from 'react';
import { MultiSelect, type SearchOption } from '@/components/ui/combobox';
import { useRemote } from '@/components/views/shared/use-remote';
import type { PoolView } from '@/components/views/platforms/pool-types';

type LibraryPayload = { items: Array<{ id: string; title: string; platforms: string[]; archivedAt?: number | null }> };

/**
 * «Лише ці оголошення»: вибір конкретних оголошень Бібліотеки (для цієї платформи) і, у Telegram, текстів пулу. MultiSelect із пошуком,
 * вибране чіпами з «×». Задано — чат отримує лише їх по черзі, це правило сильніше за «Лише ці напрямки».
 */
export function PinnedAdsField({ id, platform, values, onChange, disabled }: { id: string; platform: string; values: string[]; onChange: (values: string[]) => void; disabled?: boolean }) {
  const library = useRemote<LibraryPayload>('/api/library?kind=advertisement', { revalidateOnEnable: true, fallback: 'Не вдалося завантажити оголошення.' });
  const pool = useRemote<{ pool: PoolView }>(platform === 'telegram' ? '/api/messenger-automation?telegramPool=1' : null, { fallback: 'Не вдалося прочитати пул оголошень.' });
  const options: SearchOption[] = useMemo(() => {
    const own = (library.data?.items ?? [])
      .filter((item) => !item.archivedAt && (!item.platforms?.length || item.platforms.some((value) => value.toLowerCase() === platform)))
      .map((item) => ({ value: item.id, label: item.title || 'Без назви', hint: 'Бібліотека' }));
    const texts = (pool.data?.pool.items ?? []).filter((item) => !item.expired)
      .map((item) => ({ value: item.id, label: item.snippet, hint: `Пул Telegram${item.direction ? ` · ${item.direction}` : ''}` }));
    const known = new Set([...own, ...texts].map((option) => option.value));
    // Закріплене, чого вже немає в списках (архів, замінений пул): лишається видимим, щоб його можна було прибрати.
    const missing = values.filter((value) => !known.has(value)).map((value) => ({ value, label: 'Оголошення недоступне', hint: 'в архіві чи прибране' }));
    return [...own, ...texts, ...missing];
  }, [library.data, pool.data, platform, values]);
  return (
    <MultiSelect id={id} options={options} values={values} onChange={onChange} disabled={disabled} placeholder="Додати оголошення" searchPlaceholder="Пошук оголошення" emptyText="Оголошень не знайдено" />
  );
}
