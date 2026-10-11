'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCommand } from '@/components/shell/command-bus';
import { useShell } from '@/components/shell/shell-context';
import { PHONE, useMediaQuery } from '@/components/shell/use-media';
import { TopbarControls, useViewActive } from '@/components/shell/view-pane';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { EmptyState } from '@/components/ui/empty-state';
import { Ghost } from '@/components/ui/ghost';
import { SearchField } from '@/components/ui/search-field';
import { Segmented } from '@/components/ui/segmented';
import { useToast } from '@/components/ui/toast';
import { useRemote } from '@/components/views/shared/use-remote';
import { LIBRARY_ADVERTISEMENT_PLATFORMS } from '@/lib/library';
import { AddCard, FolderCard } from './folder-card';
import { LibraryPanel } from './library-panel';
import { collectionLabel, COLLECTIONS, matchesPlatform, platformLabel, type Collection, type Item } from './types';

type Editing = { item: Item | null; nonce: number } | null;

/** «Бібліотека»: сітка карток-папок за колекціями; редактор і історія матеріалу відкриваються в Inspector. */
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
  const seenRevision = useRef(syncRevision);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const url = useMemo(() => `/api/library?${new URLSearchParams({ kind: 'all', collection, archived: String(archived), search: query })}`, [collection, archived, query]);
  const list = useRemote<{ items?: Item[] }>(url, { refresh, enabled: active, keepPrevious: true, fallback: 'Не вдалося завантажити бібліотеку.' });
  const reload = useCallback(() => setRefresh((value) => value + 1), []);

  // Зміни з інших пристроїв приходять через live-канал: перечитуємо раз, коли розділ активний.
  useEffect(() => {
    if (!active || seenRevision.current === syncRevision) return;
    seenRevision.current = syncRevision;
    queueMicrotask(reload);
  }, [active, syncRevision, reload]);

  const openNew = useCallback(() => {
    if (archived) return;
    setEditing((current) => ({ item: null, nonce: (current?.nonce ?? 0) + 1 }));
  }, [archived]);
  useCommand('library:create', openNew);

  const items = list.data?.items ?? null;
  const showing = items !== null && !list.stale ? items.filter((item) => matchesPlatform(item, platform)) : null;
  const filtered = platform !== 'all' || query !== '' || archived;

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

  const panelOpen = editing !== null;

  return (
    <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-4 pb-6" aria-busy={list.loading}>
      <TopbarControls>
        <SearchField value={search} onValueChange={setSearch} placeholder="Назва, текст або тег" wrapperClassName="min-w-[150px] max-w-[360px] flex-1" hotkey={!phone} />
      </TopbarControls>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 max-w-full">
          <Segmented<Collection> label="Колекція матеріалів" size="sm" value={collection} onValueChange={switchCollection} items={COLLECTIONS} />
        </div>
        <Chip pressed={archived} onClick={() => { setArchived((value) => !value); setPlatform('all'); setEditing(null); }}>{archived ? 'Показати активні' : 'Архів'}</Chip>
        {showing ? <span className="ml-auto text-sm text-ink-2">Матеріалів: <span className="font-mono text-ink">{showing.length}</span></span> : null}
      </div>

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
      ) : !showing ? (
        <div aria-busy="true" className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @4xl:grid-cols-3 @6xl:grid-cols-4 @4xl:gap-4">{[0, 1, 2, 3].map((item) => <Ghost key={item} className="h-[236px] rounded-card" />)}</div>
      ) : (
        <>
          {showing.length === 0 ? (
            <EmptyState
              text={platform !== 'all' ? 'Немає оголошень для цієї платформи. Зміни платформу або очисть пошук.' : archived ? 'У цій колекції немає архівних матеріалів.' : query ? 'За цим пошуком матеріалів немає.' : `У «${collectionLabel(collection)}» ще немає матеріалів.`}
              action={filtered ? <Button variant="outline" size="sm" onClick={() => { setArchived(false); setPlatform('all'); setSearch(''); setQuery(''); }}>Скинути фільтри</Button> : undefined}
            />
          ) : null}
          <ul aria-label={collectionLabel(collection)} className="m-0 grid list-none grid-cols-1 gap-x-3 gap-y-1 p-0 @xl:grid-cols-2 @4xl:grid-cols-3 @6xl:grid-cols-4 @4xl:gap-x-4">
            {showing.map((item) => <FolderCard key={item.id} item={item} onOpen={() => setEditing({ item, nonce: 0 })} onCopy={(language) => void copy(item, language)} />)}
            {archived ? null : <AddCard onClick={openNew} />}
          </ul>
        </>
      )}

      {editing ? (
        <LibraryPanel
          key={editing.item?.id ?? `new-${editing.nonce}`}
          open={panelOpen}
          onOpenChange={(open) => { if (!open) setEditing(null); }}
          collection={collection}
          item={editing.item}
          onSaved={(saved) => { setEditing((current) => (current ? { item: saved, nonce: current.nonce } : current)); reload(); }}
          onChanged={(closePanel) => { if (closePanel) setEditing(null); reload(); }}
        />
      ) : null}
    </div>
  );
}
