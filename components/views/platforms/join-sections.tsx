'use client';

import type { ReactNode } from 'react';
import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import type { Chat, JoinSections as JoinCounts } from '@/components/views/platforms/use-platforms';
import { DuplicateRows } from '@/components/views/platforms/duplicate-frame';
import type { TelegramAccount } from '@/components/views/platforms/telegram-accounts';

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
  renderRow: (chat: Chat, section: 'queue' | 'pool', extra?: { note?: string }) => ReactNode;
  onShowMore: () => void;
  /** Лічильник приєднань вибраного акаунта й перерва (ті самі дані, що в картці «Telegram-акаунти»). */
  account?: TelegramAccount;
  breakSeconds?: number;
  busy?: boolean;
  onStartBreak?: (accountId: string, minutes: number) => void;
};

const formatDuration = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

/** Один рядок над чергою: «Приєднано 3 із 5», коли пора — «Почати 10 хв»; під час перерви — її таймер. */
function JoinPace({ account, breakSeconds, busy, onStartBreak }: { account: TelegramAccount; breakSeconds: number; busy: boolean; onStartBreak?: (accountId: string, minutes: number) => void }) {
  const due = account.joinStreak >= account.joinBatchSize;
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2" aria-live="polite">
      {breakSeconds ? (
        <span>Перерва <span className="font-mono tabular-nums text-ink">{formatDuration(breakSeconds)}</span></span>
      ) : (
        <span className={due ? 'text-warn' : undefined}>Приєднано <span className={due ? 'font-mono tabular-nums' : 'font-mono tabular-nums text-ink'}>{account.joinStreak}</span> із <span className={due ? 'font-mono tabular-nums' : 'font-mono tabular-nums text-ink'}>{account.joinBatchSize}</span>{due ? ' · час перерви' : ''}</span>
      )}
      {!breakSeconds && due && onStartBreak ? <Button variant="action" size="sm" disabled={busy} onClick={() => onStartBreak(account.id, account.breakMinutes)}>Почати {account.breakMinutes} хв</Button> : null}
    </div>
  );
}

/**
 * Telegram «Для приєднання» за Prototype Checker: угорі черга потенційного додавання вибраного акаунта (з неї приєднуються),
 * нижче всі нові чати партіями по 5 з кнопкою «+ У чергу». Копіювання черги: лише посилання або назви + посилання.
 */
export function JoinSections({ candidates, pool, counts, poolTotal, searching, renderRow, onShowMore, account, breakSeconds = 0, busy = false, onStartBreak }: Props) {
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
        {account ? <JoinPace account={account} breakSeconds={breakSeconds} busy={busy} onStartBreak={onStartBreak} /> : null}
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
          <ul className="m-0 flex list-none flex-col gap-2 p-0"><DuplicateRows items={candidates.map((chat) => ({ value: chat, id: chat.id, dup: chat.dup }))} renderItem={(chat, note) => renderRow(chat, 'queue', note ? { note } : undefined)} /></ul>
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
            <ul className="m-0 flex list-none flex-col gap-2 p-0"><DuplicateRows items={party.chats.map((chat) => ({ value: chat, id: chat.id, dup: chat.dup }))} renderItem={(chat, note) => renderRow(chat, 'pool', note ? { note } : undefined)} /></ul>
          </div>
        )) : <EmptyState text={searching ? 'Серед нових чатів нічого не знайдено.' : 'Нових чатів немає. Додай їх кнопкою «Додати чати».'} />}
        {remaining > 0 ? <Button variant="outline" onClick={onShowMore}>Показати ще ({remaining})</Button> : null}
      </section>
    </div>
  );
}
