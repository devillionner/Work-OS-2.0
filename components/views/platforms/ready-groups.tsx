'use client';

import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { isSnoozed, type Chat } from '@/components/views/platforms/use-platforms';
import { noReadyText, type AutopostBucket, type AutopostPlan } from '@/components/views/platforms/autopost-panel';
import { autopostReasonGroup, autopostReasonText, dayLabel } from '@/components/views/platforms/autopost-reasons';
import { isSameName } from '@/lib/name-similarity';

/** Що додатково показує рядок у групі: пояснення, чому чат тут, і чи публікація вручну лишається другорядною дією. */
export type RowExtra = { note?: string; manual?: boolean };

const GROUPS: Array<{ key: AutopostBucket; label: string; open?: boolean }> = [
  { key: 'ready', label: 'Готові', open: true },
  { key: 'thread', label: 'Вибрати гілку' },
  { key: 'toolong', label: 'Текст задовгий для підпису до фото' },
  { key: 'decision', label: 'Потребують рішення' },
  { key: 'tried', label: 'Уже пробували сьогодні без відправки' },
  { key: 'queued', label: 'В черзі автопосту' },
  { key: 'schedule', label: 'У розкладі Telegram на сьогодні' },
  { key: 'published', label: 'Опубліковано сьогодні' },
  { key: 'rules', label: 'Чекають за правилами частоти' },
  { key: 'snoozed', label: 'Відкладені' },
  { key: 'other', label: 'Інші' },
];

/** Пояснення в рядку за групою: чому чат не готовий і що з ним буде. */
function noteFor(bucket: AutopostBucket, reason: AutopostPlan['reasons'][string] | undefined, name: string): string | undefined {
  if (bucket === 'decision') {
    const group = autopostReasonGroup(reason?.code);
    return group.renameable && reason?.observed && !isSameName(name, reason.observed) ? `${group.label}: у месенджері «${reason.observed}»` : autopostReasonText(reason?.code);
  }
  if (bucket === 'thread') return 'У чаті є гілки: вибери, куди публікувати, на вкладці «Автопост».';
  if (bucket === 'toolong') return 'Текст із Бібліотеки довший за 1024 символи: з фото він не влізе в підпис. Скороти текст або прибери фото.';
  if (bucket === 'schedule') return 'Чат стоїть у розкладі, автопост його не бере.';
  if (bucket === 'tried') return reason?.code ? `Автопост не відправив: ${autopostReasonText(reason.code)} Повтор завтра.` : 'Автопост пробував сьогодні, відправки не було. Повтор завтра.';
  if (bucket === 'rules') return reason?.next ? `Стане доступним ${dayLabel(reason.next)}` : undefined;
  return undefined;
}

/**
 * Черга «Для публікації»: кожен чат стоїть рівно в одній групі. Для Viber і WhatsApp групи й числа беруться з плану автопосту
 * (`plan.buckets`, той самий розклад, що в чіпі черги, «Огляді» й картці автопосту); для Telegram плану немає, тож групи
 * складаються з самого списку. «Готові» розгорнуті, решта під згортками з числом.
 */
export function ReadyGroups({ chats, clock, plan, complete, renderRow, onOpenDecisions }: {
  chats: Chat[];
  clock: number;
  plan: AutopostPlan | null;
  /** У списку всі чати черги (не лише сторінка): тоді числа заголовків — із плану. */
  complete: boolean;
  renderRow: (chat: Chat, extra?: RowExtra) => ReactNode;
  onOpenDecisions?: () => void;
}) {
  const grouped = new Map<AutopostBucket, Chat[]>();
  for (const chat of chats) {
    const planned = plan?.buckets[chat.id];
    const bucket: AutopostBucket = planned ?? (chat.publishedToday ? 'published' : isSnoozed(chat, clock) ? 'snoozed' : 'ready');
    const items = grouped.get(bucket) ?? [];
    items.push(chat);
    grouped.set(bucket, items);
  }
  const countOf = (key: AutopostBucket) => (plan && complete ? (key === 'published' ? plan.publishedToday : key === 'thread' || key === 'schedule' ? plan[key] ?? 0 : key === 'toolong' ? plan.tooLong ?? 0 : plan[key]) ?? 0 : grouped.get(key)?.length ?? 0) as number;
  const list = (key: AutopostBucket, items: Chat[]) => (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {items.map((chat) => renderRow(chat, { note: plan ? noteFor(key, plan.reasons[chat.id], chat.name) : undefined, manual: key !== 'ready' }))}
    </ul>
  );

  const ready = grouped.get('ready') ?? [];
  return (
    <div className="flex flex-col gap-3">
      <h3 className="m-0 text-sm font-medium">Готові <span className="font-mono font-normal tabular-nums text-ink-2">{countOf('ready')}</span></h3>
      {ready.length ? list('ready', ready) : <p className="m-0 text-sm text-ink-2">{plan ? noReadyText(plan) : 'Сьогодні всі чати цієї черги вже опубліковані або відкладені.'}</p>}
      {GROUPS.filter((group) => group.key !== 'ready').map((group) => {
        const items = grouped.get(group.key) ?? [];
        if (!items.length) return null;
        return (
          <details key={group.key} className="group">
            <summary className="flex cursor-pointer list-none items-center gap-2 py-1 text-sm text-ink-2 [&::-webkit-details-marker]:hidden">
              <ChevronDown aria-hidden="true" strokeWidth={1.5} className="size-4 shrink-0 transition-transform group-open:rotate-180" />
              <span className="min-w-0 truncate">{group.label}</span>
              <span className="font-mono tabular-nums">{countOf(group.key)}</span>
              {group.key === 'rules' && plan?.rulesNextDate ? <span className="text-xs text-ink-3">найближча — {dayLabel(plan.rulesNextDate)}</span> : null}
              <span className="ml-auto text-xs text-ink-3 group-open:hidden">розгорнути</span>
            </summary>
            {(group.key === 'decision' || group.key === 'thread') && onOpenDecisions ? <div className="mt-1"><Button variant="outline" size="sm" onClick={onOpenDecisions}>Розібрати на вкладці «Автопост»</Button></div> : null}
            <div className="mt-2">{list(group.key, items)}</div>
          </details>
        );
      })}
    </div>
  );
}
