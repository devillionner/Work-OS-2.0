'use client';

import type { ReactNode } from 'react';
import { isSnoozed, type Chat } from '@/components/views/platforms/use-platforms';

/**
 * Черга «Для публікації»: спершу чати, доступні просто зараз, а опубліковані сьогодні й відкладені сховані нижче під згортками,
 * щоб ті, що справді можна публікувати, не губились серед уже зроблених.
 */
export function ReadyGroups({ chats, clock, renderRow }: { chats: Chat[]; clock: number; renderRow: (chat: Chat) => ReactNode }) {
  const available: Chat[] = [];
  const published: Chat[] = [];
  const snoozed: Chat[] = [];
  for (const chat of chats) (chat.publishedToday ? published : isSnoozed(chat, clock) ? snoozed : available).push(chat);
  const list = (items: Chat[]) => <ul className="m-0 flex list-none flex-col gap-2 p-0">{items.map((chat) => renderRow(chat))}</ul>;
  const fold = (label: string, items: Chat[]) => items.length ? (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-2 py-1 text-sm text-ink-2 [&::-webkit-details-marker]:hidden">
        {label} <span className="font-mono tabular-nums">{items.length}</span>
      </summary>
      <div className="mt-2">{list(items)}</div>
    </details>
  ) : null;
  return (
    <div className="flex flex-col gap-3">
      <h3 className="m-0 text-sm font-medium">Доступні зараз <span className="font-mono font-normal tabular-nums text-ink-2">{available.length}</span></h3>
      {available.length ? list(available) : <p className="m-0 text-sm text-ink-2">Сьогодні всі чати цієї черги вже опубліковані або відкладені.</p>}
      {fold('Опубліковано сьогодні', published)}
      {fold('Відкладені', snoozed)}
    </div>
  );
}
