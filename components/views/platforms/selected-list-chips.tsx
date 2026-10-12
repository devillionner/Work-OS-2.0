'use client';

import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { Check, Pencil, Plus, X } from 'lucide-react';
import { Chip } from '@/components/ui/chip';
import { useToast } from '@/components/ui/toast';
import type { SelectedListInfo } from '@/lib/chats/telegram-selected';
import { cn } from '@/lib/utils';

/** Кнопка-профіль списку: назва й лічильник; при наведенні (на телефоні завжди) праворуч з'являється олівець перейменування. */
function ListChip({ item, pressed, onSelect, onRename }: { item: SelectedListInfo; pressed: boolean; onSelect: () => void; onRename: (name: string) => Promise<string> }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.name);
  const [busy, setBusy] = useState(false);

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
      <form onSubmit={(event) => void confirm(event)} className="inline-flex h-8 items-center gap-0.5 rounded-full border border-line-strong pl-3.5 pr-1 [@media(pointer:coarse)]:h-11">
        <input
          ref={(node) => { node?.focus(); node?.select(); }}
          value={draft}
          maxLength={40}
          disabled={busy}
          aria-label="Назва списку"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={keys}
          style={{ width: `${Math.min(24, Math.max(9, draft.length + 1))}ch` }}
          className="min-w-0 bg-transparent text-[13px] font-medium text-ink outline-none [@media(pointer:coarse)]:text-base"
        />
        <button type="button" aria-label="Скасувати" disabled={busy} onClick={cancel} onKeyDown={keys} className="inline-flex size-6 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-raised hover:text-ink [@media(pointer:coarse)]:size-9"><X aria-hidden="true" strokeWidth={1.5} className="size-3.5" /></button>
        <button type="submit" aria-label="Підтвердити" disabled={busy || !draft.trim()} onKeyDown={keys} className="inline-flex size-6 items-center justify-center rounded-full bg-action text-action-ink transition-opacity disabled:opacity-45 [@media(pointer:coarse)]:size-9"><Check aria-hidden="true" strokeWidth={2} className="size-3.5" /></button>
      </form>
    );
  }

  return (
    <span className={cn('group inline-flex h-8 items-center rounded-full border text-[13px] font-medium transition-colors duration-200 [@media(pointer:coarse)]:h-11', pressed ? 'border-transparent bg-action text-action-ink' : 'border-line text-ink-2 hover:bg-raised hover:text-ink')}>
      <button type="button" aria-pressed={pressed} onClick={onSelect} className="inline-flex h-full items-center gap-2 rounded-full pl-3.5 pr-2 active:scale-[0.985]">
        {item.name}
        <span className="font-mono text-[11px] opacity-70">{item.count}</span>
      </button>
      <button
        type="button"
        aria-label={`Редагувати назву: ${item.name}`}
        onClick={start}
        className="mr-1 inline-flex size-6 items-center justify-center rounded-full opacity-0 transition-opacity duration-150 hover:bg-raised focus-visible:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:size-9 [@media(pointer:coarse)]:opacity-100"
      >
        <Pencil aria-hidden="true" strokeWidth={1.5} className="size-3.5" />
      </button>
    </span>
  );
}

/** Списки «Відібрані» Telegram у лівій колонці: профілі зі зміною назви й «+ Новий список». */
export function SelectedListChips({ lists, listId, active, onSelect, onCreate, onRename }: {
  lists: SelectedListInfo[];
  listId: string | null;
  active: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => Promise<string>;
}) {
  return (
    <>
      {lists.map((item) => <ListChip key={item.id} item={item} pressed={active && item.id === listId} onSelect={() => onSelect(item.id)} onRename={(name) => onRename(item.id, name)} />)}
      <Chip onClick={onCreate}><Plus aria-hidden="true" strokeWidth={1.5} className="size-3.5" />Новий список</Chip>
    </>
  );
}
