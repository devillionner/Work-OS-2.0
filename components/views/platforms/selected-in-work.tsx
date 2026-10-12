'use client';

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LIST_PAGE, statusText, workBreakdown } from '@/components/views/platforms/selected-model';
import { SelectedRow } from '@/components/views/platforms/selected-rows';
import { cn } from '@/lib/utils';
import type { SelectedChatView } from '@/lib/chats/telegram-selected';

function Pager({ page, total, onPage }: { page: number; total: number; onPage: (page: number) => void }) {
  if (total <= LIST_PAGE) return null;
  return (
    <div className="flex items-center justify-between gap-3 px-1 pt-1">
      <Button variant="outline" size="sm" disabled={page === 0} onClick={() => onPage(page - 1)}>Назад</Button>
      <span className="font-mono text-xs tabular-nums text-ink-2">{page * LIST_PAGE + 1}–{Math.min((page + 1) * LIST_PAGE, total)} із {total}</span>
      <Button variant="outline" size="sm" disabled={(page + 1) * LIST_PAGE >= total} onClick={() => onPage(page + 1)}>Далі</Button>
    </div>
  );
}

type GroupProps = {
  title: string | null;
  items: SelectedChatView[];
  position: Map<string, number>;
  accountName: (id: string | null) => string | null;
  onRestore?: (item: SelectedChatView) => void;
  busy: string | null;
};

/** Група рядків зі сторінками по 50: у DOM лишається лише видима сторінка. */
function Group({ title, items, position, accountName, onRestore, busy }: GroupProps) {
  const [requested, setPage] = useState(0);
  const page = Math.min(requested, Math.max(0, Math.ceil(items.length / LIST_PAGE) - 1));
  return (
    <div className="flex flex-col gap-1">
      {title ? <h4 className="m-0 px-3 pt-1 text-xs font-normal text-ink-2">{title}</h4> : null}
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {items.slice(page * LIST_PAGE, (page + 1) * LIST_PAGE).map((item) => (
          <SelectedRow key={item.link} item={item} position={position.get(item.link) ?? 0} status={onRestore ? undefined : statusText(item, accountName)} busy={busy === item.link} onRestore={onRestore ? () => onRestore(item) : undefined} />
        ))}
      </ul>
      <Pager page={page} total={items.length} onPage={setPage} />
    </div>
  );
}

/**
 * «Уже в Work OS · N»: один згорнутий рядок із розбивкою за статусами. Розгортання показує компактний список зі статусом і акаунтом
 * (сторінки по 50) і групу «Пропущені» з дією «Повернути». Стан згортання зберігається.
 */
export function InWorkSection({ inWork, skipped, position, accountName, open, onToggle, onRestore, busy }: {
  inWork: SelectedChatView[];
  skipped: SelectedChatView[];
  position: Map<string, number>;
  accountName: (id: string | null) => string | null;
  open: boolean;
  onToggle: () => void;
  onRestore: (item: SelectedChatView) => void;
  busy: string | null;
}) {
  if (!inWork.length && !skipped.length) return null;
  const breakdown = [inWork.length ? workBreakdown(inWork) : '', skipped.length && inWork.length ? `пропущено ${skipped.length}` : ''].filter(Boolean).join(' · ');
  return (
    <section aria-label="Уже в Work OS" className="flex flex-col gap-1 border-t border-line pt-2">
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex min-h-11 w-full flex-wrap items-center gap-x-3 gap-y-0.5 rounded-inner px-3 py-1.5 text-left transition-colors duration-150 hover:bg-raised">
        <ChevronRight aria-hidden="true" strokeWidth={1.5} className={cn('size-4 shrink-0 text-ink-2 transition-transform duration-150', open && 'rotate-90')} />
        <span className="text-sm font-medium">{inWork.length ? `Уже в Work OS · ${inWork.length}` : `Пропущені · ${skipped.length}`}</span>
        {breakdown ? <span className="min-w-0 text-xs text-ink-2">{breakdown}</span> : null}
      </button>
      {open ? (
        <div className="flex flex-col gap-3">
          {skipped.length ? <Group title={inWork.length ? `Пропущені · ${skipped.length}` : null} items={skipped} position={position} accountName={accountName} onRestore={onRestore} busy={busy} /> : null}
          {inWork.length ? <Group title={skipped.length ? `У Work OS · ${inWork.length}` : null} items={inWork} position={position} accountName={accountName} busy={busy} /> : null}
        </div>
      ) : null}
    </section>
  );
}
