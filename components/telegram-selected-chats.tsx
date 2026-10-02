'use client';

import { useMemo, useRef, useState } from 'react';
import { ExternalLink, FileUp, Plus, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { SelectedChatView, SelectedChatsView } from '@/lib/chats/telegram-selected';

const PAGE = 100;
const STATUS_LABELS: Record<string, string> = {
  to_join: 'Для приєднання', waiting: 'Очікування', ready: 'Для публікації', failed: 'Не вдалося', archived: 'Архів',
};

type BulkReply = { error?: string; revision?: number; items?: Array<{ status?: string }>; added?: number };

async function postBulk(body: unknown): Promise<BulkReply> {
  const response = await fetch('/api/chats/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json().catch(() => ({})) as BulkReply;
  if (!response.ok) throw new Error(value.error || `Не вдалося додати чат (HTTP ${response.status}).`);
  return value;
}

// Same two-step protocol as the bulk dialog: preview pins the revision, add is idempotent by requestId.
async function addToWork(chat: SelectedChatView) {
  const item = { link: chat.link, name: chat.title };
  const preview = await postBulk({ action: 'preview', items: [item] });
  if (preview.items?.[0]?.status !== 'new' || typeof preview.revision !== 'number') return false;
  const added = await postBulk({ action: 'add', requestId: crypto.randomUUID(), revision: preview.revision, items: [item] });
  return (added.added ?? 0) > 0;
}

function formatLast(value: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function TelegramSelectedChats({ view, loading, accounts, onImported, onAdded }: {
  view: SelectedChatsView | null;
  loading: boolean;
  accounts: Array<{ id: string; name: string; number: number }>;
  onImported: (next: SelectedChatsView) => void;
  onAdded: (link: string) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [onlyNew, setOnlyNew] = useState(false);
  const [visible, setVisible] = useState(PAGE);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const items = useMemo(() => view?.items ?? [], [view]);
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('uk-UA');
    return items.filter(item => (!onlyNew || item.status === null)
      && (!query || `${item.title} ${item.link}`.toLocaleLowerCase('uk-UA').includes(query)));
  }, [items, search, onlyNew]);
  const inWork = items.filter(item => item.status !== null).length;
  const accountName = (id: string | null) => {
    const account = id ? accounts.find(item => item.id === id) : null;
    return account ? `${account.name} #${account.number}` : null;
  };

  async function importFile(file: File) {
    setBusy('import'); setError(''); setNotice('');
    try {
      let groups: unknown;
      try { groups = JSON.parse(await file.text()); } catch { throw new Error('Це не JSON-файл.'); }
      const slim = Array.isArray(groups) ? groups.map(row => {
        const value = row && typeof row === 'object' ? row as Record<string, unknown> : {};
        return { title: value.title, username: value.username, link: value.link, msg_count_in_group: value.msg_count_in_group, last: value.last };
      }) : groups;
      const response = await fetch('/api/chats/telegram-selected', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'import', groups: slim }),
      });
      const body = await response.json().catch(() => ({})) as SelectedChatsView & { error?: string };
      if (!response.ok) throw new Error(body.error || `Не вдалося імпортувати файл (HTTP ${response.status}).`);
      onImported(body);
      setNotice(`Імпортовано ${body.items.length} чатів${body.skipped ? `, пропущено ${body.skipped} без посилання або дублікатів` : ''}.`);
      setVisible(PAGE);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не вдалося імпортувати файл.');
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function take(chat: SelectedChatView) {
    setBusy(chat.link); setError(''); setNotice('');
    try {
      const added = await addToWork(chat);
      onAdded(chat.link);
      setNotice(added ? `«${chat.title}» додано в чергу «Для приєднання» — він з'явиться там у кожного Telegram-акаунта, доки хтось не приєднається.` : `«${chat.title}» уже є в Work OS.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не вдалося додати чат.');
    } finally {
      setBusy(null);
    }
  }

  const importButton = <>
    <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void importFile(file); }} />
    <Button type="button" size="sm" variant={items.length ? 'outline' : 'default'} disabled={busy !== null} onClick={() => fileInput.current?.click()}>
      <FileUp data-icon="inline-start" />{busy === 'import' ? 'Імпортуємо…' : items.length ? 'Замінити файл' : 'Імпортувати JSON'}
    </Button>
  </>;

  return (
    <section className="selected-chats" aria-label="Відібрані Telegram-чати">
      <div className="selected-chats-head">
        <div>
          <strong>Відібрані чати</strong>
          <span>{items.length
            ? `${items.length} чатів · уже є в Work OS ${inWork}${view?.importedAt ? ` · файл від ${new Date(view.importedAt * 1000).toLocaleDateString('uk-UA')}` : ''}. Зверху — де надіслано найбільше повідомлень. «До приєднання» ставить чат у чергу «Для приєднання».`
            : 'Імпортуйте JSON-вивантаження груп: чати впорядкуються за кількістю надісланих повідомлень.'}</span>
        </div>
        {importButton}
      </div>
      {items.length > 0 && <div className="chat-toolbar">
        <label htmlFor="selected-chat-search"><Search /><Input id="selected-chat-search" value={search} onChange={event => { setSearch(event.target.value); setVisible(PAGE); }} placeholder="Пошук за назвою або посиланням" /><span className="sr-only">Пошук відібраних чатів</span></label>
        <Button type="button" size="sm" variant="outline" aria-pressed={onlyNew} onClick={() => { setOnlyNew(value => !value); setVisible(PAGE); }}>
          {onlyNew ? `Усі (${items.length})` : `Лише нові (${items.length - inWork})`}
        </Button>
      </div>}
      {error && <div className="workspace-error" role="alert">{error}</div>}
      {notice && <p className="selected-chats-notice">{notice}</p>}
      {loading && !view ? <p className="selected-chats-empty">Завантажуємо…</p>
        : !items.length ? <p className="selected-chats-empty">Тут поки порожньо.</p>
        : !filtered.length ? <p className="selected-chats-empty">Нічого не знайдено.</p>
        : <ol className="selected-chats-list">
            {filtered.slice(0, visible).map(chat => {
              const last = formatLast(chat.last);
              return <li key={chat.link}>
                <span className="selected-chats-rank">{items.indexOf(chat) + 1}</span>
                <div className="selected-chats-main">
                  <strong>{chat.title}</strong>
                  <a href={chat.link} target="_blank" rel="noreferrer">{chat.link.replace(/^https:\/\//, '')}<ExternalLink aria-hidden="true" /></a>
                </div>
                <div className="selected-chats-count" title={last ? `Останнє повідомлення ${last}` : undefined}>
                  <b>{chat.count}</b><small>{last ? `повідомл. · ${last}` : 'повідомл.'}</small>
                </div>
                {chat.status
                  ? <Badge variant="secondary" title="Цей чат уже є в Work OS">{STATUS_LABELS[chat.status] || chat.status}{accountName(chat.accountId) ? ` · ${accountName(chat.accountId)}` : ''}</Badge>
                  : <Button type="button" size="sm" variant="outline" disabled={busy !== null} title="Додати чат у чергу «Для приєднання»" onClick={() => void take(chat)}>
                      <Plus data-icon="inline-start" />{busy === chat.link ? 'Додаємо…' : 'До приєднання'}
                    </Button>}
              </li>;
            })}
          </ol>}
      {filtered.length > visible && <div className="mobile-list-more selected-chats-more">
        <Button type="button" variant="outline" onClick={() => setVisible(count => count + PAGE)}>Показати ще ({filtered.length - visible})</Button>
      </div>}
    </section>
  );
}
