'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { useCommand } from '@/components/shell/command-bus';
import { useSearchIndex, type SearchItem } from '@/components/shell/search-index';
import { useShell } from '@/components/shell/shell-context';
import { useQueryParam } from '@/components/shell/url-state';
import { PHONE, useMediaQuery } from '@/components/shell/use-media';
import { TopbarControls } from '@/components/shell/view-pane';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Ghost } from '@/components/ui/ghost';
import { SearchField } from '@/components/ui/search-field';
import { Segmented } from '@/components/ui/segmented';
import { humanError } from '@/components/ui/human-error';
import type { LeadDetail } from '@/lib/leads/application/queries';
import { cn } from '@/lib/utils';
import { createBrowserCommandClient, getJson, labels, type LeadList, type Mutation } from './client';
import { LeadBoard } from './lead-board';
import { LeadEditor } from './lead-editor';
import { LeadInspector } from './lead-inspector';
import { ORDER_LABEL, readOrder, writeOrder, type LeadOrder } from './lead-order';
import { LeadTable, type ColumnSort, type ColumnSortKey } from './lead-table';
import { TodayStrip } from './today-strip';

const FILTERS = [
  ['active', 'Активні'],
  ['responses', 'Усі відгуки'],
  ['curator', 'У куратора'],
  ['needs-details', 'Потрібно уточнити'],
  ['overdue', 'Прострочені'],
  ['no-contact', 'Без контакту'],
  ['archived', 'Архів'],
] as const;
const MODE_KEY = 'work-os:leads-mode';
type Mode = 'board' | 'list';

function readMode(): Mode {
  try { return window.localStorage.getItem(MODE_KEY) === 'list' ? 'list' : 'board'; } catch { return 'board'; }
}

/** «Ліди»: дошка за етапами воронки або щільний список; картка ліда відкривається в Inspector (?lead=…). */
export default function LeadsView() {
  const { user, syncRevision, navigate } = useShell();
  const phone = useMediaQuery(PHONE);
  const pointerFine = useMediaQuery('(pointer: fine)');
  const [selected, setSelected] = useQueryParam('lead');
  const [mode, setMode] = useState<Mode>(readMode);
  const [order, setOrder] = useState<LeadOrder>(readOrder);
  const [columnSort, setColumnSort] = useState<ColumnSort | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>('active');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [list, setList] = useState<LeadList | null>(null);
  const [listError, setListError] = useState('');
  const [detail, setDetail] = useState<LeadDetail | null>(null);
  // Останні відкриті картки: повторне відкриття ліда й перечитування після дії показують їх одразу, а не привидів.
  const [seenDetails, setSeenDetails] = useState<Record<string, LeadDetail>>({});
  const [detailError, setDetailError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [creating, setCreating] = useState(false);
  const [postCommand] = useState(() => createBrowserCommandClient(user.email));
  const busy = useRef(false);
  const lastSync = useRef(syncRevision);
  const openedByPush = useRef(false);
  const boardCapture = useRef<(() => void) | null>(null);

  const reload = useCallback(() => setRefresh((value) => value + 1), []);

  useEffect(() => {
    const timer = window.setTimeout(() => { setQuery(search); setOffset(0); }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const controller = new AbortController();
    const url = `/api/leads?view=${encodeURIComponent(filter)}&search=${encodeURIComponent(query)}&offset=${offset}`;
    void getJson<LeadList>(url, controller.signal)
      .then((data) => { if (!controller.signal.aborted) { setList(data); setListError(''); } })
      .catch((error: unknown) => { if (!controller.signal.aborted) setListError(humanError(error, 'Не вдалося завантажити ліди.')); });
    return () => controller.abort();
  }, [filter, query, offset, refresh]);

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    void getJson<LeadDetail>(`/api/leads?id=${encodeURIComponent(selected)}`, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setDetail((current) => (current?.lead.id === data.lead.id && current.lead.version > data.lead.version ? current : data));
        setSeenDetails((current) => {
          const next = { ...current, [data.lead.id]: data };
          const ids = Object.keys(next);
          if (ids.length > 20) delete next[ids[0]];
          return next;
        });
        setDetailError('');
      })
      .catch((error: unknown) => { if (!controller.signal.aborted) setDetailError(humanError(error, 'Не вдалося завантажити картку ліда.')); });
    return () => controller.abort();
  }, [selected, refresh]);

  // Зміни з інших пристроїв приходять через знімок «Сьогодні» (live-канал): список і картка перечитуються один раз.
  useEffect(() => {
    if (lastSync.current === syncRevision) return;
    lastSync.current = syncRevision;
    queueMicrotask(reload);
  }, [syncRevision, reload]);

  useCommand('lead:create', () => setCreating(true));
  // «Усі · N» із «Сьогодні» відкриває ліди з потрібним фільтром.
  useCommand('leads:filter', (payload) => {
    const next = FILTERS.find(([key]) => key === payload)?.[0];
    if (next) { setFilter(next); setOffset(0); }
  });

  const openLead = useCallback((id: string) => {
    openedByPush.current = true;
    setDetailError('');
    setSelected(id, selected ? 'replace' : 'push');
  }, [selected, setSelected]);

  const closeLead = useCallback(() => {
    if (openedByPush.current) { openedByPush.current = false; window.history.back(); }
    else setSelected(null, 'replace');
  }, [setSelected]);

  const mutate: Mutation = async (action, data = {}, entityId) => {
    if (busy.current) throw new Error('Попередня дія ще зберігається.');
    const current = detail?.lead.id === selected ? detail : null;
    if (action !== 'create' && !current) throw new Error('Дочекайся завантаження картки.');
    busy.current = true;
    try {
      const id = await postCommand(action, data, action === 'create' ? undefined : current!.lead, entityId);
      setDetail((value) => (value?.lead.id === id ? null : value));
      if (id !== selected) setSelected(id, 'replace');
      reload();
    } catch (error) {
      reload();
      throw error;
    } finally {
      busy.current = false;
    }
  };

  // Перетягування картки між колонками: версія ліда береться свіжою, зміна — частковим update.
  const moveStage = useCallback(async (leadId: string, stage: string) => {
    const fresh = await getJson<LeadDetail>(`/api/leads?id=${encodeURIComponent(leadId)}`);
    await postCommand('update', { funnelStage: stage }, fresh.lead);
    reload();
  }, [postCommand, reload]);

  const current = selected && detail?.lead.id === selected ? detail : null;
  // Для показу береться свіжа або остання відома картка; для дій — лише свіжа (`current`), щоб не використати застарілу версію.
  const shown = current ?? (selected ? seenDetails[selected] ?? null : null);
  const rowName = list?.leads.find((lead) => lead.id === selected)?.name ?? 'Лід';

  const items = useMemo<SearchItem[]>(() => (list?.leads ?? []).map((lead) => ({
    id: `lead:${lead.id}`, group: 'Ліди', label: lead.name, hint: `${labels[lead.platform] ?? lead.platform}${lead.subject ? ` · ${lead.subject}` : ''}`, run: () => { navigate('leads'); openLead(lead.id); },
  })), [list, navigate, openLead]);
  useSearchIndex('leads', items);

  // Порядок за давністю діє на дошці завжди, а в списку — доки немає сортування за іншою колонкою.
  const orderActive = mode === 'board' || columnSort === null;
  const toggleOrder = () => {
    if (!orderActive) { setColumnSort(null); return; }
    boardCapture.current?.();
    const next: LeadOrder = order === 'newest' ? 'oldest' : 'newest';
    setOrder(next);
    writeOrder(next);
  };
  const sortByColumn = (key: ColumnSortKey) => setColumnSort((value) => (value?.key === key ? { key, dir: value.dir === 1 ? -1 : 1 } : { key, dir: 1 }));

  const changeMode = (next: Mode) => {
    setMode(next);
    try { window.localStorage.setItem(MODE_KEY, next); } catch { /* режим діє до перезавантаження */ }
  };

  return (
    <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-4 pb-6" aria-busy={!list && !listError}>
      <TopbarControls>
        <div className="shrink-0"><Segmented<Mode> label="Режим лідів" value={mode} onValueChange={changeMode} items={[{ value: 'board', label: 'Дошка' }, { value: 'list', label: 'Список' }]} /></div>
        {/* У вузькому слоті Topbar (на ПК з відкритим Inspector) кнопка порядку лишається іконкою, а пошук стискається. */}
        <Button variant="outline" size="sm" className={cn('shrink-0 @max-[30rem]/slot:w-8 @max-[30rem]/slot:px-0', !orderActive && 'text-ink-3')} onClick={toggleOrder} aria-label={orderActive ? ORDER_LABEL[order] : `${ORDER_LABEL[order]}, не діє: список відсортовано за колонкою`} title="Порядок за давністю відгуку">
          {order === 'newest' ? <ArrowDown aria-hidden="true" strokeWidth={1.5} /> : <ArrowUp aria-hidden="true" strokeWidth={1.5} />}<span className="@max-[30rem]/slot:sr-only">{ORDER_LABEL[order]}</span>
        </Button>
        <SearchField value={search} onValueChange={setSearch} placeholder="Ім’я, контакт, предмет, викладач" wrapperClassName="min-w-[88px] max-w-[320px] flex-1 @min-[30rem]/slot:min-w-[150px]" hotkey={!phone} />
      </TopbarControls>

      <TodayStrip refreshKey={refresh} onSelect={openLead} />

      <fieldset className="m-0 flex min-w-0 flex-wrap items-center gap-2 border-0 p-0">
        <legend className="sr-only">Фільтр лідів</legend>
        {FILTERS.map(([key, label]) => (
          <Chip key={key} pressed={filter === key} onClick={() => { setFilter(key); setOffset(0); }}>{label}</Chip>
        ))}
        {(filter !== 'active' || search || offset !== 0) ? (
          <Button variant="ghost" size="sm" onClick={() => { setFilter('active'); setSearch(''); setQuery(''); setOffset(0); }}><RotateCcw aria-hidden="true" strokeWidth={1.5} />Скинути</Button>
        ) : null}
        {list ? <span className="ml-auto text-sm text-ink-2">Знайдено: <span className="font-mono text-ink">{list.total}</span></span> : null}
      </fieldset>

      {listError ? (
        <div className="flex flex-wrap items-center gap-3"><p role="alert" className="m-0 text-sm text-hot">{listError}</p><Button variant="outline" size="sm" onClick={reload}>Повторити</Button></div>
      ) : !list ? (
        <div aria-busy="true" className="flex gap-3 overflow-hidden">{[0, 1, 2, 3].map((item) => <Ghost key={item} className="h-72 w-[272px] shrink-0 rounded-card" />)}</div>
      ) : mode === 'board' ? (
        <LeadBoard leads={list.leads} order={order} captureRef={boardCapture} selectedId={selected} canDrag={pointerFine && filter !== 'archived'} onOpen={openLead} onCreate={() => setCreating(true)} onMove={moveStage} />
      ) : (
        <LeadTable leads={list.leads} order={order} columnSort={columnSort} onToggleOrder={toggleOrder} onColumnSort={sortByColumn} selectedId={selected} onOpen={openLead} />
      )}

      {list && list.total > 50 ? (
        <div className="flex items-center justify-between gap-3">
          <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset((value) => Math.max(0, value - 50))}><ChevronLeft aria-hidden="true" strokeWidth={1.5} />Назад</Button>
          <span className="font-mono text-xs text-ink-2">{offset + 1}–{Math.min(offset + 50, list.total)} із {list.total}</span>
          <Button variant="outline" size="sm" disabled={offset + 50 >= list.total} onClick={() => setOffset((value) => value + 50)}>Далі<ChevronRight aria-hidden="true" strokeWidth={1.5} /></Button>
        </div>
      ) : null}

      <LeadInspector open={Boolean(selected)} onClose={closeLead} name={rowName} detail={shown} error={detailError} mutate={mutate} reload={reload} onChanged={reload} />
      {creating ? <LeadEditor close={() => setCreating(false)} save={async (data) => { await mutate('create', data); }} /> : null}
    </div>
  );
}
