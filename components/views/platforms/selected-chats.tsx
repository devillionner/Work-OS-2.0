'use client';

import { useMemo, useRef, useState } from 'react';
import { ExternalLink, FileUp, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { EmptyState } from '@/components/ui/empty-state';
import { Ghost } from '@/components/ui/ghost';
import { SearchField } from '@/components/ui/search-field';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import type { SelectedChatView, SelectedChatsView } from '@/lib/chats/telegram-selected';
import { humanError } from '@/components/ui/human-error';

const PAGE = 100;
const STATUS_LABELS: Record<string, string> = { to_join: 'Для приєднання', waiting: 'Очікування', ready: 'Для публікації', failed: 'Не вдалося', archived: 'Архів' };
type AddReply = { error?: string; added?: boolean; status?: string | null; accountId?: string | null };

// Одне додавання чату — один індексований insert на сервері, а не повний скан чатів, як у bulk-потоці.
async function addToJoin(chat: SelectedChatView) {
  const response = await fetch('/api/chats/telegram-selected', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add', link: chat.link }) });
  const value = await response.json().catch(() => ({})) as AddReply;
  if (!response.ok) throw new Error(value.error || `Не вдалося додати чат (HTTP ${response.status}).`);
  return value;
}

const formatLast = (value: string | null) => (value ? new Date(value).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' }) : null);

/** Відібрані Telegram-чати: імпорт JSON-вивантаження, топ за активністю, додавання в «Для приєднання». */
export function SelectedChats({ view, loading, accounts, onImported, onAdded, onBulkAdded }: {
  view: SelectedChatsView | null;
  loading: boolean;
  accounts: Array<{ id: string; name: string; number: number }>;
  onImported: (next: SelectedChatsView) => void;
  onAdded: (link: string, status: string, accountId: string | null, added: boolean) => void;
  onBulkAdded: (links: string[]) => void;
}) {
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [onlyNew, setOnlyNew] = useState(false);
  const [topCount, setTopCount] = useState(10);
  const [visible, setVisible] = useState(PAGE);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const items = useMemo(() => view?.items ?? [], [view]);
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('uk-UA');
    return items.filter((item) => (!onlyNew || item.status === null) && (!query || `${item.title} ${item.link}`.toLocaleLowerCase('uk-UA').includes(query)));
  }, [items, search, onlyNew]);
  const inWork = items.filter((item) => item.status !== null).length;
  const accountName = (id: string | null) => { const account = id ? accounts.find((item) => item.id === id) : null; return account ? `${account.name} #${account.number}` : null; };

  async function importFile(file: File) {
    setBusy('import'); setError('');
    try {
      let groups: unknown;
      try { groups = JSON.parse(await file.text()); } catch { throw new Error('Це не JSON-файл.'); }
      const slim = Array.isArray(groups) ? groups.map((row) => { const value = row && typeof row === 'object' ? row as Record<string, unknown> : {}; return { title: value.title, username: value.username, link: value.link, msg_count_in_group: value.msg_count_in_group, last: value.last }; }) : groups;
      const response = await fetch('/api/chats/telegram-selected', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'import', groups: slim }) });
      const body = await response.json().catch(() => ({})) as SelectedChatsView & { error?: string };
      if (!response.ok) throw new Error(body.error || `Не вдалося імпортувати файл (HTTP ${response.status}).`);
      onImported(body);
      toast.push({ message: `Імпортовано ${body.items.length} чатів${body.skipped ? `, пропущено ${body.skipped} без посилання або дублікатів` : ''}.` });
      setVisible(PAGE);
    } catch (reason) { setError(humanError(reason, 'Не вдалося імпортувати файл.')); }
    finally { setBusy(null); if (fileInput.current) fileInput.current.value = ''; }
  }

  async function takeTop() {
    setBusy('top'); setError('');
    try {
      const response = await fetch('/api/chats/telegram-selected', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add-top', count: topCount }) });
      const body = await response.json().catch(() => ({})) as { error?: string; added?: number; links?: string[] };
      if (!response.ok) throw new Error(body.error || `Не вдалося додати чати (HTTP ${response.status}).`);
      const links = Array.isArray(body.links) ? body.links : [];
      onBulkAdded(links);
      toast.push({ message: links.length ? `${links.length} найактивніших чатів додано в чергу «Для приєднання».` : 'Нових чатів для додавання не лишилося.' });
    } catch (reason) { setError(humanError(reason, 'Не вдалося додати чати.')); }
    finally { setBusy(null); }
  }

  async function take(chat: SelectedChatView) {
    setBusy(chat.link); setError('');
    try {
      const reply = await addToJoin(chat);
      const added = reply.added === true;
      onAdded(chat.link, reply.status ?? 'to_join', reply.accountId ?? null, added);
      toast.push({ message: added ? `«${chat.title}» додано в чергу «Для приєднання».` : `«${chat.title}» уже є в Work OS.` });
    } catch (reason) { setError(humanError(reason, 'Не вдалося додати чат.')); }
    finally { setBusy(null); }
  }

  return (
    <section className="flex flex-col gap-4 p-4" aria-label="Відібрані Telegram-чати">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-[60ch]">
          <h3 className="m-0 text-[15px] font-medium">Відібрані чати</h3>
          <p className="m-0 mt-1 text-xs text-ink-2">{items.length ? `${items.length} чатів · уже є в Work OS ${inWork}${view?.importedAt ? ` · файл від ${new Date(view.importedAt * 1000).toLocaleDateString('uk-UA')}` : ''}. Зверху — де надіслано найбільше повідомлень.` : 'Імпортуй JSON-вивантаження груп: чати впорядкуються за кількістю надісланих повідомлень.'}</p>
        </div>
        <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); }} />
        <Button variant={items.length ? 'outline' : 'action'} size="sm" busy={busy === 'import'} disabled={busy !== null} onClick={() => fileInput.current?.click()}><FileUp aria-hidden="true" strokeWidth={1.5} />{busy === 'import' ? 'Імпортуємо…' : items.length ? 'Замінити файл' : 'Імпортувати JSON'}</Button>
      </div>
      {items.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <SearchField value={search} onValueChange={(value) => { setSearch(value); setVisible(PAGE); }} placeholder="Назва або посилання" hotkey={false} wrapperClassName="min-w-[200px] flex-1" />
          <Chip pressed={onlyNew} onClick={() => { setOnlyNew((value) => !value); setVisible(PAGE); }}>{onlyNew ? `Усі (${items.length})` : `Лише нові (${items.length - inWork})`}</Chip>
          {items.length - inWork > 0 ? (
            <span className="flex items-center gap-2">
              <Select aria-label="Скільки чатів додати" wrapperClassName="w-24" value={topCount} disabled={busy !== null} onChange={(event) => setTopCount(Number(event.target.value))}>{[10, 25, 50].map((value) => <option key={value} value={value}>{value}</option>)}</Select>
              <Button variant="action" size="sm" busy={busy === 'top'} disabled={busy !== null} title="Додати найактивніші нові чати в чергу «Для приєднання»" onClick={() => void takeTop()}><Plus aria-hidden="true" strokeWidth={1.5} />{busy === 'top' ? 'Додаємо…' : `Топ-${topCount} до приєднання`}</Button>
            </span>
          ) : null}
        </div>
      ) : null}
      {error ? <p role="alert" className="m-0 text-sm text-hot">{error}</p> : null}
      {loading && !view ? <div aria-busy="true" className="flex flex-col gap-2">{[0, 1, 2].map((item) => <Ghost key={item} className="h-16 rounded-inner" />)}</div>
        : !items.length ? <EmptyState text="Тут поки порожньо." />
        : !filtered.length ? <EmptyState text="Нічого не знайдено." />
        : (
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {filtered.slice(0, visible).map((chat) => {
              const last = formatLast(chat.last);
              return (
                <li key={chat.link} className="cv-auto flex items-center gap-3 rounded-inner border border-line bg-sunken px-4 py-3">
                  <span className="w-8 shrink-0 font-mono text-xs text-ink-2">{items.indexOf(chat) + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="m-0 truncate text-sm font-medium">{chat.title}</p>
                    <a href={chat.link} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 truncate font-mono text-[11px] text-ink-2 underline-offset-4 hover:underline">{chat.link.replace(/^https:\/\//, '')}<ExternalLink aria-hidden="true" strokeWidth={1.5} className="size-3 shrink-0" /></a>
                  </div>
                  <div className="shrink-0 text-right" title={last ? `Останнє повідомлення ${last}` : undefined}><b className="block font-mono text-sm font-normal">{chat.count}</b><small className="text-[11px] text-ink-2">{last ? `повідомл. · ${last}` : 'повідомл.'}</small></div>
                  {chat.status
                    ? <span className="shrink-0 text-xs text-ink-2" title="Цей чат уже є в Work OS">{STATUS_LABELS[chat.status] || chat.status}{accountName(chat.accountId) ? ` · ${accountName(chat.accountId)}` : ''}</span>
                    : <Button variant="outline" size="sm" busy={busy === chat.link} disabled={busy !== null} title="Додати чат у чергу «Для приєднання»" onClick={() => void take(chat)}><Plus aria-hidden="true" strokeWidth={1.5} />{busy === chat.link ? 'Додаємо…' : 'До приєднання'}</Button>}
                </li>
              );
            })}
          </ol>
        )}
      {filtered.length > visible ? <Button variant="outline" onClick={() => setVisible((count) => count + PAGE)}>Показати ще ({filtered.length - visible})</Button> : null}
    </section>
  );
}
