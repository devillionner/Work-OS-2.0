'use client';

import { ExternalLink, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatLast } from '@/components/views/platforms/selected-model';
import { cn } from '@/lib/utils';
import type { SelectedChatView } from '@/lib/chats/telegram-selected';

type Props = {
  item: SelectedChatView;
  /** Номер чату у файлі. */
  position: number;
  /** Текст статусу для чатів, що вже є в Work OS. */
  status?: string;
  busy?: boolean;
  /** Є лише в нових чатів: «У чергу» і «Пропустити». */
  onAdd?: () => void;
  onSkip?: () => void;
  /** Є лише в пропущених. */
  onRestore?: () => void;
};

function Link({ item, className }: { item: SelectedChatView; className?: string }) {
  return (
    <a href={item.link} target="_blank" rel="noreferrer" aria-label={`Відкрити чат «${item.title}»`} title={item.link.replace(/^https:\/\//, '')} className={cn('inline-flex shrink-0 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-raised hover:text-ink', className)}>
      <ExternalLink aria-hidden="true" strokeWidth={1.5} className="size-3.5" />
    </a>
  );
}

/**
 * Рядок відібраного чату: номер у файлі, назва, повідомлення й дата (mono), посилання та дії. На широкій колонці це один рядок,
 * на вузькій — два (назва, під нею лічильники), а дії лишаються праворуч завбільшки з палець.
 */
export function SelectedRow({ item, position, status, busy = false, onAdd, onSkip, onRestore }: Props) {
  const last = formatLast(item.last);
  return (
    <li data-flip-id={item.link} className={cn('flex min-h-11 items-center gap-2 rounded-inner px-2 py-1.5 @xl:gap-3 @xl:px-3 transition-colors duration-150 hover:bg-raised', busy && 'opacity-60')}>
      <span className="w-7 shrink-0 text-right font-mono text-xs tabular-nums text-ink-2 @xl:w-9">{position}</span>
      <div className="min-w-0 flex-1">
        <p className="m-0 text-sm font-medium @max-xl:line-clamp-2 @max-xl:break-words @xl:truncate" title={item.title}>{item.title}</p>
        <p className="m-0 flex min-w-0 flex-wrap items-center gap-x-2 font-mono text-[11px] tabular-nums text-ink-2 @xl:hidden">
          <span className="shrink-0">{item.count} повід.</span>
          {last ? <span className="shrink-0">{formatLast(item.last, '2-digit')}</span> : null}
          {status ? <span className="min-w-0 truncate font-sans">{status}</span> : null}
          <Link item={item} className="-my-1.5 size-7" />
        </p>
      </div>
      <Link item={item} className="hidden size-8 @xl:inline-flex" />
      <span className="hidden w-16 shrink-0 text-right font-mono text-xs tabular-nums @xl:block" title="Повідомлень у групі">{item.count}</span>
      <span className="hidden w-24 shrink-0 text-right font-mono text-xs tabular-nums text-ink-2 @xl:block" title="Останнє повідомлення">{last ?? '—'}</span>
      <div className="flex shrink-0 items-center justify-end gap-2 @xl:w-[11.5rem]">
        {status ? <span className="hidden min-w-0 truncate text-right text-xs text-ink-2 @xl:block" title={status}>{status}</span> : null}
        {onAdd ? (
          <Button variant="outline" size="sm" disabled={busy} title="Додати чат у чергу приєднання" aria-label={`Додати «${item.title}» у чергу`} onClick={onAdd} className="shrink-0 @max-xl:w-11 @max-xl:px-0 @xl:min-w-[6.75rem]">
            <Plus aria-hidden="true" strokeWidth={1.5} /><span className="sr-only @xl:not-sr-only">У чергу</span>
          </Button>
        ) : null}
        {onSkip ? (
          <Button variant="icon" size="sm" disabled={busy} title="Пропустити: чат більше не потрапляє в партії цього списку" aria-label={`Пропустити «${item.title}»`} onClick={onSkip} className="shrink-0">
            <X aria-hidden="true" strokeWidth={1.5} />
          </Button>
        ) : null}
        {onRestore ? <Button variant="ghost" size="sm" disabled={busy} title="Повернути чат у партії" aria-label={`Повернути «${item.title}» у партії`} onClick={onRestore} className="shrink-0">Повернути</Button> : null}
      </div>
    </li>
  );
}
