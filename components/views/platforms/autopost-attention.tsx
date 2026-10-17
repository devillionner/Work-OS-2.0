'use client';

import { Button } from '@/components/ui/button';
import type { WhatsAppAutopostProgress } from '@/components/views/platforms/autopost-card';
import { autopostReasonText } from '@/components/views/platforms/autopost-reasons';

export type AutopostAttentionItem = { jobId: string; chatId: string; name: string; errorCode: string; updatedAt: number };
export type AutopostDecision = 'archive' | 'snooze' | 'retry';

/** Підсумок дня по чатах, які автопост закрив сам: у яку чергу вони пішли й чому. Порожні частини не показуються. */
export function AutopostOutcomeSummary({ progress }: { progress: WhatsAppAutopostProgress | null }) {
  const settled = progress?.settled;
  if (!settled) return null;
  const parts: Array<[string, number]> = [
    ['В архів', settled.archived],
    ['В «Очікування»', settled.waiting],
    ['Відкладено на завтра', settled.snoozed],
    ['Пропущено на сьогодні', settled.skipped],
  ];
  const shown = parts.filter(([, count]) => count > 0);
  if (!shown.length) return null;
  return (
    <p className="m-0 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2" aria-label="Що автопост зробив із чатами без відправки">
      {shown.map(([label, count]) => <span key={label}>{label} <b className="font-mono font-normal text-ink">{count}</b></span>)}
    </p>
  );
}

/** Чати, які автопост не чіпав, бо незрозуміло що сталося: три дії на вибір власника. */
export function AutopostAttentionList({ items, busy, onDecide }: {
  items: AutopostAttentionItem[];
  busy: boolean;
  onDecide: (item: AutopostAttentionItem, decision: AutopostDecision) => void;
}) {
  if (!items.length) return null;
  return (
    <section className="flex flex-col gap-2" aria-label="Чати, що потребують рішення">
      <h3 className="m-0 text-sm font-medium">Потребують рішення <span className="font-mono font-normal text-ink-2">{items.length}</span></h3>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {items.map((item) => (
          <li key={item.jobId} className="flex flex-col gap-3 rounded-inner border border-line bg-sunken px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="m-0 truncate text-sm font-medium" title={item.name}>{item.name}</p>
              <p className="m-0 mt-0.5 text-xs text-ink-2">{autopostReasonText(item.errorCode)}</p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={busy} onClick={() => onDecide(item, 'retry')}>Спробувати ще</Button>
              <Button variant="outline" size="sm" disabled={busy} title="Чат повернеться в чергу завтра" onClick={() => onDecide(item, 'snooze')}>Відкласти</Button>
              <Button variant="ghost" size="sm" tone="danger" disabled={busy} onClick={() => onDecide(item, 'archive')}>В архів</Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
