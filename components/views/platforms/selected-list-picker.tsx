'use client';

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Check, Ellipsis, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { useToast } from '@/components/ui/toast';
import type { SelectedListInfo } from '@/lib/chats/telegram-selected';
import { cn } from '@/lib/utils';

/** Стовпчик у лівій колонці на ПК, горизонтальна стрічка зі scroll-snap на телефоні. */
export type PickerLayout = 'column' | 'strip';

const ICON_BUTTON = 'inline-flex size-7 shrink-0 items-center justify-center rounded-full transition-[opacity,background-color,color] duration-150 [@media(pointer:coarse)]:size-9';

type ItemProps = {
  item: SelectedListInfo;
  pressed: boolean;
  layout: PickerLayout;
  deletable: boolean;
  onSelect: () => void;
  onRename: (name: string) => Promise<string>;
  onDelete: () => void;
};

/**
 * Рядок списку: назва й лічильник, праворуч усередині — олівець перейменування (при наведенні; на дотик завжди) і «⋯» з видаленням.
 * Перейменування прямо в рядку: Enter або галочка підтверджує, Esc або X скасовує, порожню назву не зберігаємо.
 */
function ListItem({ item, pressed, layout, deletable, onSelect, onRename, onDelete }: ItemProps) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.name);
  const [busy, setBusy] = useState(false);
  const column = layout === 'column';

  useEffect(() => {
    if (!editing) return;
    input.current?.focus();
    input.current?.select();
  }, [editing]);

  const start = () => { setDraft(item.name); setEditing(true); };
  const cancel = () => { setEditing(false); setDraft(item.name); };
  const confirm = async (event?: FormEvent) => {
    event?.preventDefault();
    const name = draft.trim();
    if (!name || busy) return;
    if (name === item.name) { setEditing(false); return; }
    setBusy(true);
    const error = await onRename(name);
    setBusy(false);
    if (error) { toast.push({ message: error, tone: 'hot' }); return; }
    setEditing(false);
  };
  const keys = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); }
  };

  if (editing) {
    return (
      <li className={column ? 'w-full' : 'shrink-0 snap-start'}>
        <form onSubmit={(event) => void confirm(event)} className={cn('flex h-10 items-center gap-1 rounded-full border border-line-strong pl-3.5 pr-1.5 [@media(pointer:coarse)]:h-11', column && 'w-full')}>
          <input
            ref={input}
            value={draft}
            maxLength={40}
            disabled={busy}
            aria-label="Назва списку"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={keys}
            style={column ? undefined : { width: `${Math.min(24, Math.max(9, draft.length + 1))}ch` }}
            className="min-w-0 flex-1 bg-transparent text-[13px] font-medium text-ink outline-none [@media(pointer:coarse)]:text-base"
          />
          <button type="button" aria-label="Скасувати" title="Скасувати" disabled={busy} onClick={cancel} onKeyDown={keys} className={cn(ICON_BUTTON, 'text-ink-2 hover:bg-raised hover:text-ink')}><X aria-hidden="true" strokeWidth={1.5} className="size-3.5" /></button>
          <button type="submit" aria-label="Підтвердити" title="Підтвердити" disabled={busy || !draft.trim()} onKeyDown={keys} className={cn(ICON_BUTTON, 'bg-action text-action-ink disabled:opacity-45')}><Check aria-hidden="true" strokeWidth={1.5} className="size-3.5" /></button>
        </form>
      </li>
    );
  }

  const hover = pressed ? 'hover:bg-action-ink/10' : 'hover:bg-raised';
  return (
    <li className={column ? 'w-full' : 'shrink-0 snap-start'}>
      <div className={cn('group flex h-10 items-center gap-0.5 rounded-full border pr-1.5 text-[13px] font-medium transition-colors duration-200 [@media(pointer:coarse)]:h-11', column && 'w-full', pressed ? 'border-transparent bg-action text-action-ink' : 'border-line text-ink-2 hover:bg-raised hover:text-ink')}>
        <button type="button" aria-pressed={pressed} onClick={onSelect} className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-full pl-3.5 pr-2 text-left active:scale-[0.985]">
          <span className="min-w-0 truncate">{item.name}</span>
          <span className="ml-auto font-mono text-[11px] opacity-70">{item.count}</span>
        </button>
        <button
          type="button"
          aria-label={`Редагувати назву: ${item.name}`}
          title="Редагувати назву"
          onClick={start}
          className={cn(ICON_BUTTON, hover, 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100')}
        >
          <Pencil aria-hidden="true" strokeWidth={1.5} className="size-3.5" />
        </button>
        {deletable ? (
          <Menu>
            <MenuTrigger render={<button type="button" aria-label={`Ще дії для списку «${item.name}»`} className={cn(ICON_BUTTON, hover)} />}><Ellipsis aria-hidden="true" strokeWidth={1.5} className="size-4" /></MenuTrigger>
            <MenuContent align="end">
              <MenuItem onClick={onDelete}><Trash2 aria-hidden="true" strokeWidth={1.5} />Видалити список</MenuItem>
            </MenuContent>
          </Menu>
        ) : null}
      </div>
    </li>
  );
}

/** Списки «Відібрані» Telegram: вибір, перейменування в рядку, меню видалення й «+ Новий список». */
export function SelectedListPicker({ lists, listId, layout, onSelect, onCreate, onRename, onDelete }: {
  lists: SelectedListInfo[];
  listId: string | null;
  layout: PickerLayout;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => Promise<string>;
  onDelete: (id: string) => void;
}) {
  const strip = layout === 'strip';
  const root = useRef<HTMLUListElement>(null);

  // У стрічці вибраний (або щойно створений) список мусить лишатися на видноті цілком; з початком чіпа збігається і точка scroll-snap.
  useEffect(() => {
    const box = root.current;
    const node = box?.querySelector('[aria-pressed="true"]')?.closest('li');
    if (!strip || !box || !node) return;
    const item = node.getBoundingClientRect();
    const frame = box.getBoundingClientRect();
    if (item.left < frame.left || item.right > frame.right) node.scrollIntoView({ inline: 'start', block: 'nearest' });
  }, [strip, listId, lists.length]);

  return (
    <ul
      ref={root}
      aria-label="Списки «Відібрані»"
      className={cn('m-0 list-none p-0', strip ? 'hide-scrollbar -mx-1 flex snap-x snap-mandatory scroll-px-1 gap-2 overflow-x-auto px-1 py-1' : 'flex flex-col gap-2')}
    >
      {lists.map((item) => (
        <ListItem
          key={item.id}
          item={item}
          pressed={item.id === listId}
          layout={layout}
          deletable={lists.length > 1}
          onSelect={() => onSelect(item.id)}
          onRename={(name) => onRename(item.id, name)}
          onDelete={() => onDelete(item.id)}
        />
      ))}
      <li className={strip ? 'shrink-0 snap-start' : 'w-full'}>
        <button
          type="button"
          onClick={onCreate}
          className={cn('flex h-10 items-center gap-2 rounded-full border border-dashed border-line-strong px-3.5 text-[13px] font-medium text-ink-2 transition-colors duration-200 hover:bg-raised hover:text-ink active:scale-[0.985] [@media(pointer:coarse)]:h-11', !strip && 'w-full')}
        >
          <Plus aria-hidden="true" strokeWidth={1.5} className="size-3.5" />Новий список
        </button>
      </li>
    </ul>
  );
}
