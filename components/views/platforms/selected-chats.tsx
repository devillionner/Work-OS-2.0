'use client';

import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { FileUp, Plus } from 'lucide-react';
import { Flip } from '@/components/motion/flip';
import { gsap, prefersReducedMotion } from '@/components/motion/gsap';
import { DESKTOP, useMediaQuery } from '@/components/shell/use-media';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Ghost } from '@/components/ui/ghost';
import { humanError } from '@/components/ui/human-error';
import { SearchField } from '@/components/ui/search-field';
import { Segmented } from '@/components/ui/segmented';
import { useToast } from '@/components/ui/toast';
import { InWorkSection } from '@/components/views/platforms/selected-in-work';
import { BATCH_SIZES, LIST_PAGE, readBatchSize, readWorkOpen, searchItems, splitItems, statusText, writeBatchSize, writeWorkOpen, type BatchSize } from '@/components/views/platforms/selected-model';
import { SelectedRow } from '@/components/views/platforms/selected-rows';
import { plural } from '@/components/views/shared/plural';
import { cn } from '@/lib/utils';
import type { SelectedChatView, SelectedChatsView } from '@/lib/chats/telegram-selected';

type AddReply = { error?: string; added?: boolean; status?: string | null; accountId?: string | null };
const NO_LINKS: string[] = [];
const BATCH_ITEMS = BATCH_SIZES.map((size) => ({ value: String(size), label: String(size) }));

// Одне додавання чату — один індексований insert на сервері, а не повний скан чатів, як у bulk-потоці.
async function addToJoin(chat: SelectedChatView, listId: string, accountId: string | null) {
  const response = await fetch('/api/chats/telegram-selected', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add', link: chat.link, listId, accountId }) });
  const value = await response.json().catch(() => ({})) as AddReply;
  if (!response.ok) throw new Error(value.error || `Не вдалося додати чат (HTTP ${response.status}).`);
  return value;
}

/**
 * Рядки, що лишаються після зміни партії, пересуваються на нові місця (Flip), а нові з'являються плавно. Стан знімається
 * безпосередньо перед зміною даних; ті, що зникають, гаснуть окремо (`leave`), бо React прибирає їх із DOM.
 */
function useBatchFlip(list: RefObject<HTMLUListElement | null>, key: string) {
  const pending = useRef<ReturnType<typeof Flip.getState> | null>(null);
  const capture = () => {
    if (prefersReducedMotion()) return;
    const nodes = list.current?.querySelectorAll('[data-flip-id]');
    if (nodes?.length) pending.current = Flip.getState(nodes);
  };
  useLayoutEffect(() => {
    const state = pending.current;
    pending.current = null;
    const nodes = list.current?.querySelectorAll('[data-flip-id]');
    if (!state || !nodes?.length) return;
    Flip.from(state, { targets: nodes, duration: 0.24, ease: 'power3.out', onEnter: (entering) => gsap.fromTo(entering, { opacity: 0 }, { opacity: 1, duration: 0.2, ease: 'power3.out' }) });
  }, [key, list]);
  const leave = (links: string[]) => new Promise<void>((resolve) => {
    const wanted = new Set(links);
    const nodes = [...(list.current?.querySelectorAll<HTMLElement>('[data-flip-id]') ?? [])].filter((node) => wanted.has(node.dataset.flipId ?? ''));
    if (!nodes.length || prefersReducedMotion()) { resolve(); return; }
    // Запасний таймер: у фоновій вкладці кадри не йдуть, а дія не має зависати.
    const fallback = setTimeout(resolve, 220);
    gsap.to(nodes, { opacity: 0, duration: 0.12, ease: 'power3.out', onComplete: () => { clearTimeout(fallback); resolve(); } });
  });
  return { capture, leave };
}

/**
 * Відібрані Telegram-чати партіями: «Наступні N з M» (N — 10/25/50) з однією дією «+ Усі N у чергу», рядки з «У чергу» і «Пропустити»,
 * пошук по всьому списку й згорнутий рядок «Уже в Work OS». Усе рахується на клієнті з одного завантаженого списку.
 */
export function SelectedChats({ view, loading, accounts, accountId, listId, listName, onImported, onAdded, onBulkAdded, onDismiss, onOpenQueue }: {
  view: SelectedChatsView | null;
  loading: boolean;
  accounts: Array<{ id: string; name: string; number: number }>;
  /** Вибраний Telegram-акаунт: його черга приєднання приймає додані чати. */
  accountId: string | null;
  /** Список, вибраний ліворуч: файл завжди імпортується саме в нього. */
  listId: string;
  listName: string;
  onImported: (next: SelectedChatsView) => void;
  onAdded: (link: string, status: string, accountId: string | null, added: boolean) => void;
  onBulkAdded: (links: string[]) => void;
  /** «Пропустити» (`skip`) і «Повернути»: повертає текст помилки або порожній рядок. */
  onDismiss: (links: string[], skip: boolean) => Promise<string>;
  onOpenQueue: () => void;
}) {
  const toast = useToast();
  const desktop = useMediaQuery(DESKTOP);
  const fileInput = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState('');
  const [searchLimit, setSearchLimit] = useState(LIST_PAGE);
  const [batchSize, setBatchSize] = useState<BatchSize>(readBatchSize);
  const [workOpen, setWorkOpen] = useState(readWorkOpen);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const items = useMemo(() => view?.items ?? [], [view]);
  const dismissed = view?.dismissed ?? NO_LINKS;
  const dismissedSet = useMemo(() => new Set(dismissed), [dismissed]);
  const split = useMemo(() => splitItems(items, dismissed), [items, dismissed]);
  const batch = useMemo(() => split.fresh.slice(0, batchSize), [split, batchSize]);
  const searching = query.trim() !== '';
  const hits = useMemo(() => (searching ? searchItems(items, query) : []), [items, query, searching]);
  const { capture, leave } = useBatchFlip(list, searching ? `q:${hits.slice(0, searchLimit).map((item) => item.link).join('|')}` : batch.map((item) => item.link).join('|'));
  const accountName = (id: string | null) => { const account = id ? accounts.find((item) => item.id === id) : null; return account ? `${account.name} #${account.number}` : null; };
  const importedOn = view?.importedAt ? new Date(view.importedAt * 1000).toLocaleDateString('uk-UA') : null;

  async function importFile(file: File) {
    setBusy('import'); setError('');
    try {
      let groups: unknown;
      try { groups = JSON.parse(await file.text()); } catch { throw new Error('Це не JSON-файл.'); }
      const slim = Array.isArray(groups) ? groups.map((row) => { const value = row && typeof row === 'object' ? row as Record<string, unknown> : {}; return { title: value.title, username: value.username, link: value.link, msg_count_in_group: value.msg_count_in_group, last: value.last }; }) : groups;
      const response = await fetch('/api/chats/telegram-selected', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'import', groups: slim, listId }) });
      const body = await response.json().catch(() => ({})) as SelectedChatsView & { error?: string };
      if (!response.ok) throw new Error(body.error || `Не вдалося імпортувати файл (HTTP ${response.status}).`);
      onImported(body);
      toast.push({ message: `Імпортовано ${body.items.length} чатів у «${listName}»${body.skipped ? `, пропущено ${body.skipped} без посилання або дублікатів` : ''}.` });
    } catch (reason) { setError(humanError(reason, 'Не вдалося імпортувати файл.')); }
    finally { setBusy(null); if (fileInput.current) fileInput.current.value = ''; }
  }

  const openQueue = { label: 'Відкрити чергу', onClick: onOpenQueue };

  async function addBatch() {
    if (!batch.length) return;
    setBusy('batch'); setError('');
    try {
      const response = await fetch('/api/chats/telegram-selected', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add-top', count: batch.length, listId, accountId }) });
      const body = await response.json().catch(() => ({})) as { error?: string; links?: string[] };
      if (!response.ok) throw new Error(body.error || `Не вдалося додати чати (HTTP ${response.status}).`);
      const links = Array.isArray(body.links) ? body.links : [];
      await leave(links);
      capture();
      onBulkAdded(links);
      toast.push(links.length ? { message: `${links.length} ${plural(links.length, 'чат', 'чати', 'чатів')} додано в чергу.`, action: openQueue, duration: 6000 } : { message: 'Нових чатів для додавання не лишилося.' });
    } catch (reason) { setError(humanError(reason, 'Не вдалося додати чати.')); }
    finally { setBusy(null); }
  }

  async function addOne(chat: SelectedChatView) {
    setBusy(chat.link); setError('');
    try {
      const reply = await addToJoin(chat, listId, accountId);
      const added = reply.added === true;
      await leave([chat.link]);
      capture();
      onAdded(chat.link, reply.status ?? 'to_join', reply.accountId ?? null, added);
      toast.push({ message: added ? `«${chat.title}» додано в чергу.` : `«${chat.title}» уже є в Work OS.`, action: openQueue, duration: 6000 });
    } catch (reason) { setError(humanError(reason, 'Не вдалося додати чат.')); }
    finally { setBusy(null); }
  }

  async function dismiss(chat: SelectedChatView, skip: boolean) {
    setBusy(chat.link); setError('');
    if (skip) { await leave([chat.link]); capture(); }
    const failure = await onDismiss([chat.link], skip);
    if (failure) setError(failure);
    setBusy(null);
  }

  const chooseBatch = (value: string) => { const size = Number(value) as BatchSize; setBatchSize(size); writeBatchSize(size); };
  const toggleWork = () => { setWorkOpen((open) => { writeWorkOpen(!open); return !open; }); };
  const replaceButton = (
    <Button variant="outline" size="sm" busy={busy === 'import'} disabled={busy !== null} onClick={() => fileInput.current?.click()}><FileUp aria-hidden="true" strokeWidth={1.5} />{busy === 'import' ? 'Імпортуємо…' : 'Замінити файл'}</Button>
  );
  const title = (
    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
      <div className="min-w-0">
        <h3 className="m-0 text-[15px] font-medium">{listName}</h3>
        {items.length ? <p className="m-0 mt-0.5 font-mono text-xs tabular-nums text-ink-2">{items.length} {plural(items.length, 'чат', 'чати', 'чатів')} · нових {split.fresh.length}{importedOn ? ` · файл від ${importedOn}` : ''}</p> : null}
      </div>
      {items.length && (searching || split.fresh.length) ? replaceButton : null}
    </div>
  );
  const batchBar = items.length && !searching && split.fresh.length ? (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      {desktop ? <h4 className="m-0 text-sm font-medium tabular-nums">Наступні {batch.length} з {split.fresh.length}</h4> : null}
      <div className="flex items-center gap-2 @max-xl:w-full @max-xl:justify-between">
        <Segmented<string> label="Розмір партії" size="sm" value={String(batchSize)} onValueChange={chooseBatch} items={BATCH_ITEMS} />
        <Button variant="action" size="sm" busy={busy === 'batch'} disabled={busy !== null} title="Додати всю партію в чергу приєднання вибраного акаунта" onClick={() => void addBatch()}><Plus aria-hidden="true" strokeWidth={1.5} />{busy === 'batch' ? 'Додаємо…' : `Усі ${batch.length} у чергу`}</Button>
      </div>
    </div>
  ) : null;
  const searchNote = items.length && searching ? <p className="m-0 text-sm tabular-nums text-ink-2">Знайдено {hits.length}</p> : null;

  const row = (item: SelectedChatView) => {
    const position = split.position.get(item.link) ?? 0;
    if (item.status !== null) return <SelectedRow key={item.link} item={item} position={position} status={statusText(item, accountName)} />;
    if (dismissedSet.has(item.link)) return <SelectedRow key={item.link} item={item} position={position} status="Пропущений" busy={busy === item.link} onRestore={() => void dismiss(item, false)} />;
    return <SelectedRow key={item.link} item={item} position={position} busy={busy === item.link} onAdd={() => void addOne(item)} onSkip={() => void dismiss(item, true)} />;
  };

  return (
    <section className="@container flex flex-col gap-3 p-4" aria-label="Відібрані Telegram-чати">
      <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); }} />
      {desktop ? null : title}
      <div className={cn('sticky z-10 -mx-2 flex flex-col gap-3 rounded-inner bg-solid px-2 py-2', desktop ? 'top-0' : 'top-[calc(56px+env(safe-area-inset-top))]')}>
        {desktop ? title : null}
        {batchBar}
        {desktop ? searchNote : null}
      </div>
      {items.length ? <SearchField value={query} onValueChange={(value) => { setQuery(value); setSearchLimit(LIST_PAGE); }} placeholder="Назва або посилання у списку" hotkey={false} wrapperClassName="min-w-[200px]" /> : null}
      {error ? <p role="alert" className="m-0 text-sm text-hot">{error}</p> : null}
      {loading && !view ? <div aria-busy="true" className="flex flex-col gap-2">{[0, 1, 2].map((item) => <Ghost key={item} className="h-11 rounded-inner" />)}</div>
        : !view ? <EmptyState text="Не вдалося завантажити список. Онови сторінку й спробуй ще раз." />
        : !items.length ? (
          <div className="flex flex-col items-start gap-3 rounded-inner border border-dashed border-line-strong px-4 py-5">
            <p className="m-0 max-w-[56ch] text-sm text-ink-2">Список порожній. Завантаж JSON-вивантаження груп: для кожної назва (title), посилання (link) або username та кількість повідомлень (msg_count_in_group). Чати впорядкуються за активністю.</p>
            <Button variant="action" size="sm" busy={busy === 'import'} disabled={busy !== null} onClick={() => fileInput.current?.click()}><FileUp aria-hidden="true" strokeWidth={1.5} />{busy === 'import' ? 'Завантажуємо…' : 'Завантажити файл'}</Button>
          </div>
        )
        : searching ? (
          <>
            {desktop ? null : searchNote}
            {hits.length ? (
              <>
                <ul ref={list} className="m-0 flex list-none flex-col gap-0.5 p-0">{hits.slice(0, searchLimit).map(row)}</ul>
                {hits.length > searchLimit ? <Button variant="outline" onClick={() => setSearchLimit((count) => count + LIST_PAGE)}>Показати ще ({hits.length - searchLimit})</Button> : null}
              </>
            ) : <EmptyState text="У цьому списку нічого не знайдено." />}
          </>
        )
        : (
          <>
            {split.fresh.length ? (
              <>
                {desktop ? null : <h4 className="m-0 text-sm font-medium tabular-nums">Наступні {batch.length} з {split.fresh.length}</h4>}
                <ul ref={list} aria-label="Наступна партія" className="m-0 flex list-none flex-col gap-0.5 p-0">{batch.map(row)}</ul>
              </>
            ) : (
              <div className="flex flex-col items-start gap-3 rounded-inner border border-dashed border-line-strong px-4 py-4">
                <p className="m-0 text-sm text-ink-2">Усі чати цього списку вже в Work OS або пропущені.</p>
                {replaceButton}
              </div>
            )}
            <InWorkSection inWork={split.inWork} skipped={split.skipped} position={split.position} accountName={accountName} open={workOpen} onToggle={toggleWork} onRestore={(item) => void dismiss(item, false)} busy={busy} />
          </>
        )}
    </section>
  );
}
