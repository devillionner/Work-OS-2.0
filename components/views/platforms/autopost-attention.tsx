'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { PHOTO_FAILURE_CODES, autopostReasonGroup, autopostReasonText } from '@/components/views/platforms/autopost-reasons';
import { isSameName, isSimilarName } from '@/lib/name-similarity';

export type AutopostAttentionItem = { jobId: string; chatId: string; name: string; errorCode: string; updatedAt: number; /** Назва чату, яку бачив месенджер (для «Не той чат»). */ observed: string | null;
  /** Збій стався до «Надіслати» (з результату задачі): повтор не може дати дубль, тож для групи є масове «Спробувати ще всі». */
  beforeSend: boolean };
export type AutopostDecision = 'archive' | 'snooze' | 'retry' | 'retry_nophoto' | 'check' | 'rename';
/** Відкласти: на скільки діб (1 — до завтра, 3, 7). */
export type DecideOptions = { days?: 1 | 3 | 7 };

type Pending = { kind: 'retry'; item: AutopostAttentionItem; decision: 'retry' | 'retry_nophoto' } | { kind: 'archive'; items: AutopostAttentionItem[] };
const SNOOZE_CHOICES: Array<{ days: 1 | 3 | 7; label: string }> = [{ days: 1, label: 'До завтра' }, { days: 3, label: 'На 3 дні' }, { days: 7, label: 'На тиждень' }];

/** «Відкласти ▾»: меню з терміном; на групі те саме для всіх чатів. */
function SnoozeMenu({ label, title, disabled, onPick }: { label: string; title: string; disabled: boolean; onPick: (options: DecideOptions) => void }) {
  return (
    <Menu>
      <MenuTrigger render={<Button variant="outline" size="sm" disabled={disabled} title={title} />}>{label}<ChevronDown aria-hidden="true" strokeWidth={1.5} /></MenuTrigger>
      <MenuContent align="start">
        {SNOOZE_CHOICES.map((choice) => <MenuItem key={choice.days} onClick={() => onPick({ days: choice.days })}>{choice.label}</MenuItem>)}
      </MenuContent>
    </Menu>
  );
}

/**
 * Чати, які автопост не чіпав, бо незрозуміло що сталося, лише з сьогоднішніх партій (з новим днем список очищується сам, чати не
 * змінюються). Групи за причиною згорнуті (шеврон, число й підпис «розгорнути»); на групі масові дії, у розгорнутій по чату.
 * «Не вдалося підтвердити» — «Перевірити» (лише відкрити чат і подивитись) і «Спробувати ще» з підтвердженням «Можливий дубль».
 * «Повідомлення не знайдено» — «Опублікувати ще раз» без попередження: перевірка вже показала, що дубля немає.
 * «Не той чат» — «У Work OS: X · у месенджері: Y» і «Це той самий чат: оновити назву й опублікувати».
 */
const MESSENGER_NAMES = { viber: 'Viber', whatsapp: 'WhatsApp', telegram: 'Telegram' } as const;

export function AutopostAttentionList({ items, busy, canVerify, messenger, onDecide, onDecideMany }: {
  items: AutopostAttentionItem[];
  busy: boolean;
  /** Чи вміє адаптер платформи лише перевірити наявне повідомлення (Viber і WhatsApp вміють). */
  canVerify: boolean;
  /** Платформа списку: у «Не той чат» назва з месенджера підписується його іменем («у Viber: …»). */
  messenger?: keyof typeof MESSENGER_NAMES;
  onDecide: (item: AutopostAttentionItem, decision: AutopostDecision, options?: DecideOptions) => void;
  onDecideMany: (items: AutopostAttentionItem[], decision: AutopostDecision, options?: DecideOptions) => void;
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
  // Повтор по одному чату: після відправки без підтвердження (повідомлення могло піти) — лише з підтвердженням «Можливий дубль».
  const retry = (item: AutopostAttentionItem, decision: 'retry' | 'retry_nophoto' = 'retry') => (needsConfirm(item) ? setPending({ kind: 'retry', item, decision }) : onDecide(item, decision));
  const needsConfirm = (item: AutopostAttentionItem) => { const group = autopostReasonGroup(item.errorCode); return Boolean(group.risky) || (!item.beforeSend && group.key !== 'missing'); };
  // Назва з месенджера відома, лише коли вона відрізняється від нашої: збіг означає, що runner її не зчитав (старий запис).
  const knownObserved = (item: AutopostAttentionItem) => (item.observed && !isSameName(item.name, item.observed) ? item.observed : null);
  const similar = (list: AutopostAttentionItem[]) => list.filter((item) => { const observed = knownObserved(item); return observed && isSimilarName(item.name, observed); });

  return (
    <section id="autopost-decisions" className="flex flex-col gap-2 pb-24 sm:pb-0" aria-label="Чати, що потребують рішення">
      <h3 className="m-0 text-sm font-medium">Потребують рішення сьогодні <span className="font-mono font-normal tabular-nums text-ink-2">{items.length}</span></h3>
      {[...groups.entries()].map(([key, group]) => {
        const renameable = similar(group.items);
        // Масовий повтор лише там, де збій був до «Надіслати» (ознака з результату задачі), без попередження про дубль.
        // «Не той чат» із відомою назвою з месенджера: повтор без зміни назви гарантовано дасть той самий збій, тож масового «Спробувати ще» для таких немає.
        const safe = group.items.filter((item) => item.beforeSend && !(group.renameable && knownObserved(item)));
        const noPhoto = safe.filter((item) => PHOTO_FAILURE_CODES.has(item.errorCode));
        return (
          <details key={key} className="group rounded-inner border border-line bg-sunken">
            <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm [&::-webkit-details-marker]:hidden">
              <ChevronDown aria-hidden="true" strokeWidth={1.5} className="size-4 shrink-0 text-ink-2 transition-transform group-open:rotate-180" />
              <span className="min-w-0 flex-1 truncate">{group.label}</span>
              <span className="font-mono tabular-nums text-ink-2">{group.items.length}</span>
              <span className="text-xs text-ink-3 group-open:hidden">розгорнути</span>
            </summary>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3">
              <div className="flex flex-wrap gap-2">
                {safe.length ? <Button variant="action" size="sm" disabled={busy} title={safe.length < group.items.length ? 'Лише чати, де збій був до «Надіслати»: дубля не буде' : 'Збій був до «Надіслати», дубля не буде'} onClick={() => onDecideMany(safe, 'retry')}>Спробувати ще всі ({safe.length})</Button> : null}
                {group.missing ? <Button variant="action" size="sm" disabled={busy} title="Перевірка показала, що повідомлення в цих чатах немає, тож дубля не буде" onClick={() => onDecideMany(group.items, 'retry')}>Опублікувати ще раз усі</Button> : null}
                {noPhoto.length ? <Button variant="outline" size="sm" disabled={busy} title="Той самий текст без фото, лише цього разу: налаштування фото не змінюються" onClick={() => onDecideMany(noPhoto, 'retry_nophoto')}>Спробувати всі без фото ({noPhoto.length})</Button> : null}
                {group.checkable ? <Button variant="outline" size="sm" disabled={busy} title="Відкриє кожен чат і лише перевірить, чи є в ньому повідомлення" onClick={() => onDecideMany(group.items, 'check')}>{group.missing ? 'Перевірити ще раз усі' : 'Перевірити всі'}</Button> : null}
                {group.renameable && renameable.length ? <Button variant="outline" size="sm" disabled={busy} title="Лише чати, де назви схожі" onClick={() => onDecideMany(renameable, 'rename')}>Оновити назви й опублікувати ({renameable.length})</Button> : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <SnoozeMenu label="Відкласти всі" title="Чати повернуться в чергу після вибраного терміну" disabled={busy} onPick={(options) => onDecideMany(group.items, 'snooze', options)} />
                <Button variant="ghost" size="sm" tone="danger" disabled={busy} onClick={() => setPending({ kind: 'archive', items: group.items })}>В архів усі</Button>
              </div>
            </div>
            <ul className="m-0 flex list-none flex-col gap-2 p-0 px-3 pb-3">
              {group.items.map((item) => (
                <li key={item.jobId} className="flex flex-col gap-2 rounded-inner border border-line px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="m-0 truncate text-sm font-medium" title={item.name}>{item.name}</p>
                    {group.renameable && knownObserved(item) ? (
                      <p className="m-0 mt-0.5 text-xs text-ink-2">У Work OS: {item.name} · у {messenger ? MESSENGER_NAMES[messenger] : 'месенджері'}: <span className="text-ink">{knownObserved(item)}</span></p>
                    ) : <p className="m-0 mt-0.5 text-xs text-ink-2">{autopostReasonText(item.errorCode)}</p>}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap gap-2">
                      {group.renameable && knownObserved(item) ? <Button variant="outline" size="sm" className="h-auto min-h-8 max-w-full whitespace-normal py-2 text-center" disabled={busy} onClick={() => onDecide(item, 'rename')}>Це той самий чат: оновити назву й опублікувати</Button> : null}
                      {group.checkable ? <Button variant="outline" size="sm" disabled={busy} onClick={() => onDecide(item, 'check')}>{group.missing ? 'Перевірити ще раз' : 'Перевірити'}</Button> : null}
                      {group.renameable && knownObserved(item) ? null : <Button variant="outline" size="sm" disabled={busy} onClick={() => retry(item)}>{group.missing ? 'Опублікувати ще раз' : 'Спробувати ще'}</Button>}
                      {PHOTO_FAILURE_CODES.has(item.errorCode) ? <Button variant="outline" size="sm" disabled={busy} title="Той самий текст без фото, лише цього разу" onClick={() => retry(item, 'retry_nophoto')}>Без фото</Button> : null}
                    </div>
                    <div className="flex gap-2">
                      <SnoozeMenu label="Відкласти" title="Чат повернеться в чергу після вибраного терміну" disabled={busy} onPick={(options) => onDecide(item, 'snooze', options)} />
                      <Button variant="ghost" size="sm" tone="danger" disabled={busy} onClick={() => setPending({ kind: 'archive', items: [item] })}>В архів</Button>
                    </div>
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
        confirmLabel={pending?.kind === 'retry' ? (pending.decision === 'retry_nophoto' ? 'Все одно спробувати без фото' : 'Все одно спробувати ще') : 'В архів'}
        destructive={pending?.kind === 'archive'}
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const action = pending;
          setPending(null);
          if (!action) return;
          if (action.kind === 'retry') onDecide(action.item, action.decision);
          else if (action.items.length === 1) onDecide(action.items[0], 'archive');
          else onDecideMany(action.items, 'archive');
        }}
      />
    </section>
  );
}
