'use client';

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCommand } from '@/components/shell/command-bus';
import { useShell } from '@/components/shell/shell-context';
import { PHONE, useMediaQuery } from '@/components/shell/use-media';
import { TopbarControls, useViewActive } from '@/components/shell/view-pane';
import { useDragSort } from '@/components/motion/use-drag-sort';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { EmptyState } from '@/components/ui/empty-state';
import { Ghost } from '@/components/ui/ghost';
import { humanError } from '@/components/ui/human-error';
import { SearchField } from '@/components/ui/search-field';
import { Segmented } from '@/components/ui/segmented';
import { useToast } from '@/components/ui/toast';
import { useRemote } from '@/components/views/shared/use-remote';
import { LIBRARY_ADVERTISEMENT_PLATFORMS } from '@/lib/library';
import { TEMPLATE_SCRIPTS } from '@/lib/script-fields';
import { AddCard, FolderCard } from './folder-card';
import { LibraryPanel } from './library-panel';
import { applyReorder, sortByOrder } from './order';
import { collectionLabel, COLLECTIONS, matchesPlatform, platformLabel, type Collection, type Item, type LibraryCollectionKey } from './types';

const DevelopmentSection = lazy(() => import('./development-section'));
const ConvertFieldsPanel = lazy(() => import('./convert-fields-panel'));
const ImportScripts = lazy(() => import('./import-scripts'));

const NO_ORDER: string[] = [];
type Editing = { item: Item | null; nonce: number } | null;
type ListPayload = { items?: Item[]; order?: string[] };

/** «Бібліотека»: сітка карток-папок за колекціями (порядок перетягується); редактор і історія матеріалу — в Inspector. */
export default function LibraryView() {
  const { syncRevision } = useShell();
  const active = useViewActive();
  const phone = useMediaQuery(PHONE);
  const toast = useToast();
  const [collection, setCollection] = useState<Collection>('advertisement');
  const [archived, setArchived] = useState(false);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [platform, setPlatform] = useState('all');
  const [refresh, setRefresh] = useState(0);
  const [editing, setEditing] = useState<Editing>(null);
  const [orderOverride, setOrderOverride] = useState<{ collection: Collection; ids: string[] } | null>(null);
  const [converting, setConverting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pendingOpen, setPendingOpen] = useState<string | null>(null);
  const grid = useRef<HTMLUListElement>(null);
  const seenRevision = useRef(syncRevision);
  const developing = collection === 'development';
  const libraryCollection = developing ? null : collection as LibraryCollectionKey;

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const url = useMemo(() => (developing ? null : `/api/library?${new URLSearchParams({ kind: 'all', collection, archived: String(archived), search: query })}`), [developing, collection, archived, query]);
  const list = useRemote<ListPayload>(url, { refresh, enabled: active, keepPrevious: true, fallback: 'Не вдалося завантажити бібліотеку.' });
  const reload = useCallback(() => setRefresh((value) => value + 1), []);

  // Зміни з інших пристроїв приходять через live-канал: перечитуємо раз, коли розділ активний.
  useEffect(() => {
    if (!active || seenRevision.current === syncRevision) return;
    seenRevision.current = syncRevision;
    queueMicrotask(reload);
  }, [active, syncRevision, reload]);

  // Після перечитування сервер уже знає збережений порядок: локальна правка більше не потрібна.
  useEffect(() => { queueMicrotask(() => setOrderOverride(null)); }, [list.data]);

  const openNew = useCallback(() => {
    if (archived || developing) return;
    setEditing((current) => ({ item: null, nonce: (current?.nonce ?? 0) + 1 }));
  }, [archived, developing]);
  useCommand('library:create', openNew);

  const items = list.data?.items ?? null;
  const showing = items !== null && !list.stale ? items.filter((item) => matchesPlatform(item, platform)) : null;
  const serverOrder = list.data?.order;
  const order = useMemo(() => (orderOverride && orderOverride.collection === collection ? orderOverride.ids : serverOrder ?? NO_ORDER), [orderOverride, collection, serverOrder]);
  const displayed = useMemo(() => (showing ? sortByOrder(showing, order) : null), [showing, order]);
  const filtered = platform !== 'all' || query !== '' || archived;
  const sortable = Boolean(displayed && displayed.length > 1);

  const { capture } = useDragSort({
    root: grid,
    enabled: sortable,
    signature: displayed?.map((item) => item.id).join('|') ?? '',
    onDrop: ({ id, beforeId }) => {
      if (!displayed || !libraryCollection) return;
      const next = applyReorder(order, displayed.map((item) => item.id), id, beforeId);
      setOrderOverride({ collection, ids: next });
      void fetch('/api/library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'order', collection: libraryCollection, ids: next }) })
        .then(async (response) => { if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error || 'Не вдалося зберегти порядок.'); })
        .catch((reason: unknown) => { capture(); setOrderOverride(null); toast.push({ message: humanError(reason, 'Не вдалося зберегти порядок.'), tone: 'hot' }); });
    },
  });

  const switchCollection = (next: Collection) => {
    setCollection(next);
    setArchived(false);
    setPlatform('all');
    setEditing(null);
  };

  const copy = async (item: Item, language: 'uk' | 'ru') => {
    const text = language === 'uk' ? item.ukText : item.ruText;
    try {
      await navigator.clipboard.writeText(text);
      toast.push({ message: `Скопійовано ${language === 'uk' ? 'UA' : 'RU'}.` });
    } catch {
      toast.push({ message: 'Не вдалося скопіювати текст.', tone: 'hot' });
    }
  };

  const post = async (body: Record<string, unknown>, fallback: string) => {
    const response = await fetch('/api/library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const value = await response.json().catch(() => ({})) as { error?: string; id?: string; created?: number; existing?: boolean };
    if (!response.ok) throw new Error(value.error || fallback);
    return value;
  };

  const seedTemplates = async () => {
    try {
      const result = await post({ action: 'seed_templates' }, 'Не вдалося створити шаблони.');
      toast.push({ message: result.created ? `Додано шаблонів: ${result.created}.` : 'Усі стандартні шаблони вже є.', tone: 'ok' });
      reload();
    } catch (reason) { toast.push({ message: humanError(reason, 'Не вдалося створити шаблони.'), tone: 'hot' }); }
  };

  const makePersonal = async (item: Item) => {
    try {
      const result = await post({ action: 'copy_personal', id: item.id }, 'Не вдалося створити власну версію.');
      toast.push({ message: result.existing ? 'Власна версія вже є. Відкриваю її.' : 'Власну версію створено в «Особистих скриптах».', tone: 'ok' });
      setEditing(null);
      setCollection('personal_script');
      setArchived(false);
      setPlatform('all');
      setPendingOpen(result.id ?? null);
      reload();
    } catch (reason) { toast.push({ message: humanError(reason, 'Не вдалося створити власну версію.'), tone: 'hot' }); }
  };

  // Нову власну версію відкриваємо, щойно її видно в списку «Особистих скриптів».
  useEffect(() => {
    if (!pendingOpen || collection !== 'personal_script' || !items || list.stale) return;
    const found = items.find((entry) => entry.id === pendingOpen);
    if (found) queueMicrotask(() => { setPendingOpen(null); setEditing({ item: found, nonce: 0 }); });
  }, [pendingOpen, collection, items, list.stale]);

  const script = collection === 'official_script' || collection === 'personal_script';
  const missingTemplates = collection === 'official_script' && items !== null && TEMPLATE_SCRIPTS.some((template) => !items.some((entry) => entry.templateKey === template.key));

  return (
    <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-4 pb-6" aria-busy={list.loading}>
      <TopbarControls>
        <SearchField value={search} onValueChange={setSearch} placeholder={developing ? 'Назва, опис або чекпоінт' : 'Назва, текст або тег'} wrapperClassName="min-w-[150px] max-w-[360px] flex-1" hotkey={!phone} />
      </TopbarControls>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 max-w-full">
          <Segmented<Collection> label="Колекція матеріалів" size="sm" value={collection} onValueChange={switchCollection} items={COLLECTIONS} />
        </div>
        {developing ? null : <Chip pressed={archived} onClick={() => { setArchived((value) => !value); setPlatform('all'); setEditing(null); }}>{archived ? 'Показати активні' : 'Архів'}</Chip>}
        {script ? <Button variant="outline" size="sm" onClick={() => setConverting(true)}>Поля в скриптах</Button> : null}
        {collection === 'official_script' && !importing ? <Button variant="outline" size="sm" onClick={() => { setEditing(null); setImporting(true); }}>Імпорт з таблиці</Button> : null}
        {missingTemplates ? <Button variant="outline" size="sm" onClick={() => void seedTemplates()}>Стандартні шаблони</Button> : null}
        {showing && !developing ? <span className="ml-auto text-sm text-ink-2">Матеріалів: <span className="font-mono text-ink">{showing.length}</span></span> : null}
      </div>

      {importing && collection === 'official_script' ? (
        <Suspense fallback={<Ghost className="h-48 rounded-card" />}>
          <ImportScripts onClose={() => setImporting(false)} onChanged={reload} />
        </Suspense>
      ) : developing ? (
        <Suspense fallback={<div aria-busy="true" className="grid grid-cols-1 gap-3 @4xl:grid-cols-4">{[0, 1, 2, 3].map((item) => <Ghost key={item} className="h-[320px] rounded-card" />)}</div>}>
          <DevelopmentSection active={active} query={query} />
        </Suspense>
      ) : (
        <>
          {collection === 'advertisement' ? (
            <fieldset className="hide-scrollbar m-0 flex min-w-0 items-center gap-2 overflow-x-auto border-0 p-0">
              <legend className="sr-only">Фільтр оголошень за платформою</legend>
              <Chip pressed={platform === 'all'} onClick={() => { setPlatform('all'); setEditing(null); }}>Усі платформи</Chip>
              {LIBRARY_ADVERTISEMENT_PLATFORMS.map((value) => <Chip key={value} pressed={platform === value} onClick={() => { setPlatform(value); setEditing(null); }}>{platformLabel(value)}</Chip>)}
            </fieldset>
          ) : null}

          {list.error && !items ? (
            <div className="flex flex-wrap items-center gap-3">
              <p role="alert" className="m-0 text-sm text-hot">{list.error}</p>
              <Button variant="outline" size="sm" onClick={reload}>Спробувати ще раз</Button>
            </div>
          ) : !displayed ? (
            <div aria-busy="true" className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @4xl:grid-cols-3 @6xl:grid-cols-4 @4xl:gap-4">{[0, 1, 2, 3].map((item) => <Ghost key={item} className="h-[236px] rounded-card" />)}</div>
          ) : (
            <>
              {displayed.length === 0 ? (
                <EmptyState
                  text={platform !== 'all' ? 'Немає оголошень для цієї платформи. Зміни платформу або очисть пошук.' : archived ? 'У цій колекції немає архівних матеріалів.' : query ? 'За цим пошуком матеріалів немає.' : `У колекції «${collectionLabel(collection)}» ще немає матеріалів.`}
                  action={filtered ? <Button variant="outline" size="sm" onClick={() => { setArchived(false); setPlatform('all'); setSearch(''); setQuery(''); }}>Скинути фільтри</Button> : undefined}
                />
              ) : null}
              <ul ref={grid} aria-label={collectionLabel(collection)} className="m-0 grid list-none grid-cols-1 gap-x-3 gap-y-1 p-0 @xl:grid-cols-2 @4xl:grid-cols-3 @6xl:grid-cols-4 @4xl:gap-x-4">
                {displayed.map((item) => <FolderCard key={item.id} item={item} sortable={sortable} onOpen={() => setEditing({ item, nonce: 0 })} onCopy={(language) => void copy(item, language)} />)}
                {archived ? null : <AddCard onClick={openNew} />}
              </ul>
              {sortable ? <p className="m-0 text-xs text-ink-3">Порядок карток можна змінити перетягуванням{phone ? ' (довге натискання)' : ''}.</p> : null}
            </>
          )}
        </>
      )}

      {editing && libraryCollection ? (
        <LibraryPanel
          key={editing.item?.id ?? `new-${editing.nonce}`}
          open
          onOpenChange={(open) => { if (!open) setEditing(null); }}
          collection={libraryCollection}
          item={editing.item}
          onSaved={(saved) => { setEditing((current) => (current ? { item: saved, nonce: current.nonce } : current)); reload(); }}
          onChanged={(closePanel) => { if (closePanel) setEditing(null); reload(); }}
          onMakePersonal={(item) => void makePersonal(item)}
        />
      ) : null}
      {converting ? <Suspense fallback={null}><ConvertFieldsPanel onClose={() => setConverting(false)} onChanged={reload} /></Suspense> : null}
    </div>
  );
}
