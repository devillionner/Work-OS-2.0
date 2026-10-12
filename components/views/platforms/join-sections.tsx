'use client';

import type { ReactNode } from 'react';
import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import type { Chat, JoinSections as JoinCounts } from '@/components/views/platforms/use-platforms';

const PARTY = 5;

/** Блоки по 5 рядків через порожній рядок: так посилання зручно вставляти в Telegram партіями. */
export function copyBlocks(lines: readonly string[]): string {
  const blocks: string[] = [];
  for (let index = 0; index < lines.length; index += PARTY) blocks.push(lines.slice(index, index + PARTY).join('\n'));
  return blocks.join('\n\n');
}

type Props = {
  /** Черга вибраного акаунта (відібрані кнопкою «+»). */
  candidates: Chat[];
  /** Уже завантажені «Нові чати». */
  pool: Chat[];
  counts: JoinCounts;
  /** Скільки «Нових чатів» усього (за пошуком, якщо він активний). */
  poolTotal: number;
  searching: boolean;
  renderRow: (chat: Chat, section: 'queue' | 'pool') => ReactNode;
  onShowMore: () => void;
};

/**
 * Telegram «Для приєднання» за Prototype Checker: угорі черга потенційного додавання вибраного акаунта (з неї приєднуються),
 * нижче всі нові чати партіями по 5 з кнопкою «+ У чергу». Копіювання черги: лише посилання або назви + посилання.
 */
export function JoinSections({ candidates, pool, counts, poolTotal, searching, renderRow, onShowMore }: Props) {
  const toast = useToast();

  const copyQueue = async (named: boolean) => {
    const lines = candidates.map((chat) => (named ? `${chat.name.trim()} — ${chat.link.trim()}` : chat.link.trim()));
    try {
      await navigator.clipboard.writeText(copyBlocks(lines));
      toast.push({ message: `Скопійовано ${lines.length}.` });
    } catch {
      toast.push({ message: 'Не вдалося скопіювати.', tone: 'hot' });
    }
  };

  const parties: Array<{ number: number; from: number; to: number; chats: Chat[] }> = [];
  for (let index = 0; index < pool.length; index += PARTY) {
    const number = index / PARTY + 1;
    parties.push({ number, from: index + 1, to: Math.min(index + PARTY, poolTotal), chats: pool.slice(index, index + PARTY) });
  }
  const remaining = Math.max(0, poolTotal - pool.length);

  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="join-queue-title" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex items-baseline gap-2">
            <h3 id="join-queue-title" className="m-0 text-[15px] font-medium">Черга приєднання</h3>
            <span className="font-mono text-xs text-ink-2">{candidates.length} з {counts.queue}</span>
          </div>
          {candidates.length ? (
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="sm" title="Скопіювати посилання черги блоками по 5" onClick={() => void copyQueue(false)}><Copy aria-hidden="true" strokeWidth={1.5} />Посилання</Button>
              <Button variant="ghost" size="sm" title="Скопіювати назви й посилання черги блоками по 5" onClick={() => void copyQueue(true)}>Назви + посилання</Button>
            </div>
          ) : null}
        </div>
        {candidates.length ? (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">{candidates.map((chat) => renderRow(chat, 'queue'))}</ul>
        ) : (
          <p className="m-0 rounded-inner border border-dashed border-line-strong px-4 py-4 text-sm text-ink-2">{searching ? 'У черзі нічого не знайдено.' : 'Черга порожня. Відберіть чати кнопкою + у списку нижче.'}</p>
        )}
      </section>

      <section aria-labelledby="join-new-title" className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <h3 id="join-new-title" className="m-0 text-[15px] font-medium">Нові чати</h3>
          <span className="font-mono text-xs text-ink-2">{searching ? `${poolTotal} з ${counts.pool}` : counts.pool}</span>
        </div>
        {parties.length ? parties.map((party) => (
          <div key={party.number} className="flex flex-col gap-2">
            <h4 className="m-0 flex items-baseline gap-2 px-1 pt-1 text-xs font-normal text-ink-2"><span className="text-ink">Партія {party.number}</span><span className="font-mono">№ {party.from}–{party.to}</span></h4>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">{party.chats.map((chat) => renderRow(chat, 'pool'))}</ul>
          </div>
        )) : <EmptyState text={searching ? 'Серед нових чатів нічого не знайдено.' : 'Нових чатів немає. Додай їх кнопкою «Додати чати».'} />}
        {remaining > 0 ? <Button variant="outline" onClick={onShowMore}>Показати ще ({remaining})</Button> : null}
      </section>
    </div>
  );
}
