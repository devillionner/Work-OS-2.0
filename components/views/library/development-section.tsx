'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { useDragSort } from '@/components/motion/use-drag-sort';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { EmptyState } from '@/components/ui/empty-state';
import { Ghost } from '@/components/ui/ghost';
import { humanError } from '@/components/ui/human-error';
import { Segmented } from '@/components/ui/segmented';
import { useToast } from '@/components/ui/toast';
import { useRemote } from '@/components/views/shared/use-remote';
import { DEV_PRIORITY_LABEL, DEV_STATUSES, DEV_STATUS_LABEL, DEV_TYPE_LABEL, checklistProgress, type DevItem, type DevStatus } from '@/lib/dev-items';
import { cn } from '@/lib/utils';
import { DevItemPanel } from './dev-item-panel';

type Mode = 'board' | 'list';
type Editing = { item: DevItem | null; status: DevStatus; nonce: number } | null;

function matches(item: DevItem, query: string): boolean {
  if (!query) return true;
  const haystack = `${item.title} ${item.body} ${item.notes} ${item.checklist.map((entry) => entry.text).join(' ')}`.toLocaleLowerCase('uk-UA');
  return query.toLocaleLowerCase('uk-UA').split(/\s+/).every((word) => haystack.includes(word));
}

function Card({ item, canDrag, onOpen }: { item: DevItem; canDrag: boolean; onOpen: () => void }) {
  const progress = checklistProgress(item.checklist);
  return (
    <li data-sort-id={item.id} data-sort-group={item.status} data-flip-id={item.id} className={cn('rounded-inner border border-line bg-solid transition-colors duration-200 data-[over]:border-line-strong', canDrag && 'cursor-grab touch-pan-y active:cursor-grabbing')}>
      <button type="button" onClick={(event) => { if (!canDrag || event.detail === 0) onOpen(); }} aria-label={`Відкрити запис ${item.title}`} className="flex w-full flex-col gap-2 p-3 text-left outline-offset-4">
        <span className="flex items-center justify-between gap-2 text-[11px] text-ink-2">
          <span>{DEV_TYPE_LABEL[item.type]}</span>
          {item.priority === 'high' ? <span className="inline-flex items-center gap-1.5"><i aria-hidden="true" className="size-1.5 rounded-full bg-hot" />{DEV_PRIORITY_LABEL.high}</span> : item.priority === 'low' ? <span>{DEV_PRIORITY_LABEL.low}</span> : null}
        </span>
        <span className="line-clamp-3 text-sm font-medium leading-snug">{item.title}</span>
        {progress.total ? (
          <span className="flex items-center gap-2 text-[11px] text-ink-2">
            <span aria-hidden="true" className="h-1 flex-1 overflow-hidden rounded-full bg-raised"><span className="block h-full rounded-full bg-ink-2" style={{ width: `${progress.ratio * 100}%` }} /></span>
            <span className="font-mono">{progress.done} / {progress.total}</span>
          </span>
        ) : null}
        {item.photos.length ? <span className="text-[11px] text-ink-2">Фото: {item.photos.length}</span> : null}
      </button>
    </li>
  );
}

/** «Розробка»: ідеї, баги й покращення. Дошка за статусами з перетягуванням і список; запис відкривається в Inspector. */
export default function DevelopmentSection({ active, query }: { active: boolean; query: string }) {
  const toast = useToast();
  const [mode, setMode] = useState<Mode>('board');
  const [archived, setArchived] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [editing, setEditing] = useState<Editing>(null);
  const [local, setLocal] = useState<DevItem[] | null>(null);
  const board = useRef<HTMLDivElement>(null);
  const remote = useRemote<{ items?: DevItem[] }>(`/api/dev-items?archived=${archived}`, { refresh, enabled: active, keepPrevious: true, fallback: 'Не вдалося завантажити записи.' });
  const reload = useCallback(() => setRefresh((value) => value + 1), []);
  // Свіжі дані з сервера замінюють оптимістичний порядок після перетягування.
  useEffect(() => { queueMicrotask(() => setLocal(null)); }, [remote.data]);

  const loaded = remote.data?.items && !remote.stale ? remote.data.items : null;
  const all = local ?? loaded;
  const items = useMemo(() => (all ? all.filter((item) => matches(item, query)) : null), [all, query]);
  const canDrag = !archived && mode === 'board';

  const { capture } = useDragSort({
    root: board,
    enabled: canDrag && Boolean(items?.length),
    signature: items?.map((item) => `${item.id}:${item.status}`).join('|') ?? '',
    dragClickables: true,
    onClick: (id) => { const found = items?.find((item) => item.id === id); if (found) setEditing({ item: found, status: found.status, nonce: 0 }); },
    onDrop: ({ id, toGroup, beforeId }) => {
      if (!all) return;
      const status = DEV_STATUSES.find((value) => value === toGroup);
      const moved = all.find((item) => item.id === id);
      if (!status || !moved) return;
      const rest = all.filter((item) => item.id !== id);
      const index = beforeId ? rest.findIndex((item) => item.id === beforeId) : -1;
      const next = [...rest];
      next.splice(index < 0 ? rest.length : index, 0, { ...moved, status });
      setLocal(next);
      void fetch('/api/dev-items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'move', id, status, beforeId }) })
        .then(async (response) => { if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error || 'Не вдалося перемістити запис.'); reload(); })
        .catch((reason: unknown) => { capture(); setLocal(null); reload(); toast.push({ message: humanError(reason, 'Не вдалося перемістити запис.'), tone: 'hot' }); });
    },
  });

  const open = (item: DevItem | null, status: DevStatus = 'idea') => setEditing((current) => ({ item, status, nonce: (current?.nonce ?? 0) + 1 }));
  const byStatus = (status: DevStatus) => (items ?? []).filter((item) => item.status === status);

  return (
    <div className="flex flex-col gap-4" aria-busy={remote.loading}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Segmented<Mode> label="Вигляд розробки" size="sm" value={mode} onValueChange={setMode} items={[{ value: 'board', label: 'Дошка' }, { value: 'list', label: 'Список' }]} />
        <Chip pressed={archived} onClick={() => { setArchived((value) => !value); setEditing(null); }}>{archived ? 'Показати активні' : 'Архів'}</Chip>
        {archived ? null : <Button variant="action" size="sm" onClick={() => open(null)}><Plus aria-hidden="true" strokeWidth={1.5} />Додати запис</Button>}
        {items ? <span className="ml-auto text-sm text-ink-2">Записів: <span className="font-mono text-ink">{items.length}</span></span> : null}
      </div>

      {remote.error && !all ? (
        <div className="flex flex-wrap items-center gap-3"><p role="alert" className="m-0 text-sm text-hot">{remote.error}</p><Button variant="outline" size="sm" onClick={reload}>Спробувати ще раз</Button></div>
      ) : !items ? (
        <div aria-busy="true" className="grid grid-cols-1 gap-3 @4xl:grid-cols-4">{[0, 1, 2, 3].map((value) => <Ghost key={value} className="h-[320px] rounded-card" />)}</div>
      ) : mode === 'board' && !archived ? (
        <div ref={board} className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-3 hide-scrollbar @4xl:snap-none">
          {DEV_STATUSES.map((status) => {
            const column = byStatus(status);
            return (
              <section key={status} data-sort-group={status} aria-label={DEV_STATUS_LABEL[status]} className="flex w-[78vw] shrink-0 snap-start flex-col gap-2 rounded-card border border-line bg-sunken p-2.5 @4xl:w-0 @4xl:min-w-[11.75rem] @4xl:flex-1">
                <header className="flex items-center justify-between gap-2 px-2 pb-1 pt-1.5">
                  <h3 className="m-0 text-sm font-medium">{DEV_STATUS_LABEL[status]}</h3>
                  <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-raised px-1.5 font-mono text-[11px] text-ink-2">{column.length}</span>
                </header>
                <ul className="m-0 flex min-h-12 list-none flex-col gap-2 p-0">
                  {column.map((item) => <Card key={item.id} item={item} canDrag={canDrag} onOpen={() => open(item)} />)}
                </ul>
                <Button variant="ghost" size="sm" className="justify-start" onClick={() => open(null, status)}><Plus aria-hidden="true" strokeWidth={1.5} />Додати</Button>
              </section>
            );
          })}
        </div>
      ) : items.length === 0 ? (
        <EmptyState text={archived ? 'В архіві немає записів.' : query ? 'За цим пошуком записів немає.' : 'Записів ще немає. Додай ідею, баг чи покращення.'} />
      ) : (
        <ul aria-label="Записи розробки" className="m-0 flex list-none flex-col gap-2 p-0">
          {[...items].sort((a, b) => DEV_STATUSES.indexOf(a.status) - DEV_STATUSES.indexOf(b.status) || a.position - b.position).map((item) => {
            const progress = checklistProgress(item.checklist);
            return (
              <li key={item.id}>
                <button type="button" onClick={() => open(item)} aria-label={`Відкрити запис ${item.title}`} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 rounded-inner border border-line bg-sunken px-4 py-3 text-left transition-colors duration-200 hover:bg-raised">
                  <span className="min-w-0 truncate text-sm font-medium">{item.title}</span>
                  <span className="text-xs text-ink-2">{DEV_STATUS_LABEL[item.status]}</span>
                  <span className="truncate text-xs text-ink-2">{DEV_TYPE_LABEL[item.type]}{item.priority === 'high' ? ` · ${DEV_PRIORITY_LABEL.high.toLowerCase()} пріоритет` : ''}{item.photos.length ? ` · фото ${item.photos.length}` : ''}</span>
                  <span className="font-mono text-xs text-ink-2">{progress.total ? `${progress.done} / ${progress.total}` : ''}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {mode === 'board' && !archived && items?.length ? <p className="m-0 text-xs text-ink-3">Записи можна перетягувати між колонками й змінювати їхній порядок.</p> : null}

      {editing ? (
        <DevItemPanel key={editing.item?.id ?? `new-${editing.nonce}`} item={editing.item} defaultStatus={editing.status} onClose={() => setEditing(null)} onChanged={reload} />
      ) : null}
    </div>
  );
}
