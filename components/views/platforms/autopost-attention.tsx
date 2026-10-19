'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { autopostReasonGroup, autopostReasonText } from '@/components/views/platforms/autopost-reasons';

export type AutopostAttentionItem = { jobId: string; chatId: string; name: string; errorCode: string; updatedAt: number };
export type AutopostDecision = 'archive' | 'snooze' | 'retry' | 'check';

type Pending = { kind: 'retry'; item: AutopostAttentionItem } | { kind: 'archive'; items: AutopostAttentionItem[] };

/**
 * Чати, які автопост не чіпав, бо незрозуміло що сталося, лише з сьогоднішніх партій (з новим днем список очищується сам, чати не
 * змінюються). Групи за причиною згорнуті; на групі масові дії, у розгорнутій по чату. Для «Не вдалося підтвердити» є «Перевірити»:
 * лише відкрити чат і подивитись, чи повідомлення вже є. «Спробувати ще» там лише з підтвердженням: можливий дубль.
 */
export function AutopostAttentionList({ items, busy, canVerify, onDecide, onDecideMany }: {
  items: AutopostAttentionItem[];
  busy: boolean;
  /** Перевірку наявного повідомлення вміє лише адаптер Viber. */
  canVerify: boolean;
  onDecide: (item: AutopostAttentionItem, decision: AutopostDecision) => void;
  onDecideMany: (items: AutopostAttentionItem[], decision: Exclude<AutopostDecision, 'retry'>) => void;
}) {
  const [pending, setPending] = useState<Pending | null>(null);
  if (!items.length) return null;
  const groups = new Map<string, { label: string; checkable: boolean; items: AutopostAttentionItem[] }>();
  for (const item of items) {
    const group = autopostReasonGroup(item.errorCode);
    const entry = groups.get(group.key) ?? { label: group.label, checkable: group.checkable && canVerify, items: [] };
    entry.items.push(item);
    groups.set(group.key, entry);
  }
  const retry = (item: AutopostAttentionItem) => (autopostReasonGroup(item.errorCode).checkable ? setPending({ kind: 'retry', item }) : onDecide(item, 'retry'));

  return (
    <section className="flex flex-col gap-2 pb-24 sm:pb-0" aria-label="Чати, що потребують рішення">
      <h3 className="m-0 text-sm font-medium">Потребують рішення сьогодні <span className="font-mono font-normal tabular-nums text-ink-2">{items.length}</span></h3>
      {[...groups.entries()].map(([key, group]) => (
        <details key={key} className="group rounded-inner border border-line bg-sunken">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm [&::-webkit-details-marker]:hidden">
            <span className="min-w-0 truncate">{group.label}</span>
            <span className="font-mono tabular-nums text-ink-2">{group.items.length}</span>
          </summary>
          <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3">
            {group.checkable ? <Button variant="outline" size="sm" disabled={busy} title="Відкриє кожен чат і лише перевірить, чи є в ньому повідомлення" onClick={() => onDecideMany(group.items, 'check')}>Перевірити всі</Button> : null}
            <Button variant="outline" size="sm" disabled={busy} title="Чати повернуться в чергу завтра" onClick={() => onDecideMany(group.items, 'snooze')}>Відкласти всі</Button>
            <Button variant="ghost" size="sm" tone="danger" disabled={busy} onClick={() => setPending({ kind: 'archive', items: group.items })}>В архів усі</Button>
          </div>
          <ul className="m-0 flex list-none flex-col gap-2 p-0 px-3 pb-3">
            {group.items.map((item) => (
              <li key={item.jobId} className="flex flex-col gap-2 rounded-inner border border-line px-3 py-2.5">
                <div className="min-w-0">
                  <p className="m-0 truncate text-sm font-medium" title={item.name}>{item.name}</p>
                  <p className="m-0 mt-0.5 text-xs text-ink-2">{autopostReasonText(item.errorCode)}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {group.checkable ? <Button variant="outline" size="sm" disabled={busy} onClick={() => onDecide(item, 'check')}>Перевірити</Button> : null}
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => retry(item)}>Спробувати ще</Button>
                  <Button variant="outline" size="sm" disabled={busy} title="Чат повернеться в чергу завтра" onClick={() => onDecide(item, 'snooze')}>Відкласти</Button>
                  <Button variant="ghost" size="sm" tone="danger" disabled={busy} onClick={() => setPending({ kind: 'archive', items: [item] })}>В архів</Button>
                </div>
              </li>
            ))}
          </ul>
        </details>
      ))}
      <ConfirmDialog
        open={pending !== null}
        title={pending?.kind === 'retry' ? 'Можливий дубль' : pending && pending.items.length > 1 ? `Перемістити в архів чатів: ${pending.items.length}` : 'Перемістити чат в архів'}
        description={pending?.kind === 'retry'
          ? 'Повідомлення могло дійти до чату, просто автопост цього не побачив. Повторна відправка може дати дубль. Спершу краще натиснути «Перевірити».'
          : 'Чати зникнуть із черг публікації й підуть в архів.'}
        confirmLabel={pending?.kind === 'retry' ? 'Все одно спробувати ще' : 'В архів'}
        destructive={pending?.kind === 'archive'}
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const action = pending;
          setPending(null);
          if (!action) return;
          if (action.kind === 'retry') onDecide(action.item, 'retry');
          else if (action.items.length === 1) onDecide(action.items[0], 'archive');
          else onDecideMany(action.items, 'archive');
        }}
      />
    </section>
  );
}
