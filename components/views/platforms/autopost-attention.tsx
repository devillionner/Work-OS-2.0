'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { autopostReasonGroup, autopostReasonText } from '@/components/views/platforms/autopost-reasons';
import { isSameName, isSimilarName } from '@/lib/name-similarity';

export type AutopostAttentionItem = { jobId: string; chatId: string; name: string; errorCode: string; updatedAt: number; /** Назва чату, яку бачив месенджер (для «Не той чат»). */ observed: string | null };
export type AutopostDecision = 'archive' | 'snooze' | 'retry' | 'check' | 'rename';

type Pending = { kind: 'retry'; item: AutopostAttentionItem } | { kind: 'archive'; items: AutopostAttentionItem[] };

/**
 * Чати, які автопост не чіпав, бо незрозуміло що сталося, лише з сьогоднішніх партій (з новим днем список очищується сам, чати не
 * змінюються). Групи за причиною згорнуті (шеврон, число й підпис «розгорнути»); на групі масові дії, у розгорнутій по чату.
 * «Не вдалося підтвердити» — «Перевірити» (лише відкрити чат і подивитись) і «Спробувати ще» з підтвердженням «Можливий дубль».
 * «Повідомлення не знайдено» — «Опублікувати ще раз» без попередження: перевірка вже показала, що дубля немає.
 * «Не той чат» — «У Work OS: X · у месенджері: Y» і «Це той самий чат: оновити назву й опублікувати».
 */
export function AutopostAttentionList({ items, busy, canVerify, onDecide, onDecideMany }: {
  items: AutopostAttentionItem[];
  busy: boolean;
  /** Чи вміє адаптер платформи лише перевірити наявне повідомлення (Viber і WhatsApp вміють). */
  canVerify: boolean;
  onDecide: (item: AutopostAttentionItem, decision: AutopostDecision) => void;
  onDecideMany: (items: AutopostAttentionItem[], decision: Exclude<AutopostDecision, 'retry'>) => void;
}) {
  const [pending, setPending] = useState<Pending | null>(null);
  if (!items.length) return null;
  const groups = new Map<string, { label: string; checkable: boolean; renameable: boolean; missing: boolean; items: AutopostAttentionItem[] }>();
  for (const item of items) {
    const group = autopostReasonGroup(item.errorCode);
    const entry = groups.get(group.key) ?? { label: group.label, checkable: group.checkable && canVerify, renameable: Boolean(group.renameable), missing: group.key === 'missing', items: [] };
    entry.items.push(item);
    groups.set(group.key, entry);
  }
  const retry = (item: AutopostAttentionItem) => (autopostReasonGroup(item.errorCode).risky ? setPending({ kind: 'retry', item }) : onDecide(item, 'retry'));
  // Назва з месенджера відома, лише коли вона відрізняється від нашої: збіг означає, що runner її не зчитав (старий запис).
  const knownObserved = (item: AutopostAttentionItem) => (item.observed && !isSameName(item.name, item.observed) ? item.observed : null);
  const similar = (list: AutopostAttentionItem[]) => list.filter((item) => { const observed = knownObserved(item); return observed && isSimilarName(item.name, observed); });

  return (
    <section className="flex flex-col gap-2 pb-24 sm:pb-0" aria-label="Чати, що потребують рішення">
      <h3 className="m-0 text-sm font-medium">Потребують рішення сьогодні <span className="font-mono font-normal tabular-nums text-ink-2">{items.length}</span></h3>
      {[...groups.entries()].map(([key, group]) => {
        const renameable = similar(group.items);
        return (
          <details key={key} className="group rounded-inner border border-line bg-sunken">
            <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm [&::-webkit-details-marker]:hidden">
              <ChevronDown aria-hidden="true" strokeWidth={1.5} className="size-4 shrink-0 text-ink-2 transition-transform group-open:rotate-180" />
              <span className="min-w-0 flex-1 truncate">{group.label}</span>
              <span className="font-mono tabular-nums text-ink-2">{group.items.length}</span>
              <span className="text-xs text-ink-3 group-open:hidden">розгорнути</span>
            </summary>
            <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3">
              {group.checkable ? <Button variant="outline" size="sm" disabled={busy} title="Відкриє кожен чат і лише перевірить, чи є в ньому повідомлення" onClick={() => onDecideMany(group.items, 'check')}>{group.missing ? 'Перевірити ще раз усі' : 'Перевірити всі'}</Button> : null}
              {group.renameable && renameable.length ? <Button variant="outline" size="sm" disabled={busy} title="Лише чати, де назви схожі" onClick={() => onDecideMany(renameable, 'rename')}>Оновити назви й опублікувати ({renameable.length})</Button> : null}
              <Button variant="outline" size="sm" disabled={busy} title="Чати повернуться в чергу завтра" onClick={() => onDecideMany(group.items, 'snooze')}>Відкласти всі</Button>
              <Button variant="ghost" size="sm" tone="danger" disabled={busy} onClick={() => setPending({ kind: 'archive', items: group.items })}>В архів усі</Button>
            </div>
            <ul className="m-0 flex list-none flex-col gap-2 p-0 px-3 pb-3">
              {group.items.map((item) => (
                <li key={item.jobId} className="flex flex-col gap-2 rounded-inner border border-line px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="m-0 truncate text-sm font-medium" title={item.name}>{item.name}</p>
                    {group.renameable && knownObserved(item) ? (
                      <p className="m-0 mt-0.5 text-xs text-ink-2">У Work OS: {item.name} · у месенджері: <span className="text-ink">{knownObserved(item)}</span></p>
                    ) : <p className="m-0 mt-0.5 text-xs text-ink-2">{autopostReasonText(item.errorCode)}</p>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {group.renameable && knownObserved(item) ? <Button variant="outline" size="sm" disabled={busy} onClick={() => onDecide(item, 'rename')}>Це той самий чат: оновити назву й опублікувати</Button> : null}
                    {group.checkable ? <Button variant="outline" size="sm" disabled={busy} onClick={() => onDecide(item, 'check')}>{group.missing ? 'Перевірити ще раз' : 'Перевірити'}</Button> : null}
                    {group.renameable && knownObserved(item) ? null : <Button variant="outline" size="sm" disabled={busy} onClick={() => retry(item)}>{group.missing ? 'Опублікувати ще раз' : 'Спробувати ще'}</Button>}
                    <Button variant="outline" size="sm" disabled={busy} title="Чат повернеться в чергу завтра" onClick={() => onDecide(item, 'snooze')}>Відкласти</Button>
                    <Button variant="ghost" size="sm" tone="danger" disabled={busy} onClick={() => setPending({ kind: 'archive', items: [item] })}>В архів</Button>
                  </div>
                </li>
              ))}
            </ul>
          </details>
        );
      })}
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
