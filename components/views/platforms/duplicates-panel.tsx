'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Panel } from '@/components/shell/panel';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Ghost } from '@/components/ui/ghost';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { humanError } from '@/components/ui/human-error';

type Platform = 'telegram' | 'whatsapp' | 'viber' | 'facebook';
type Account = { id: string; number: number; name: string; enabled: boolean; selected: boolean };
type Chat = { id: string; name: string; link: string; normalizedLink: string; platform: string; status: string; archiveReason: string | null; archivedAt: number | null; telegramAccountId: string | null; stateToken: string };
type Group = { key: string; match: 'link' | 'name'; chats: Chat[] };
const PLATFORMS: Array<[Platform, string]> = [['telegram', 'Telegram'], ['whatsapp', 'WhatsApp'], ['viber', 'Viber'], ['facebook', 'Facebook']];

/** Менеджер дублікатів: точні посилання мають вищий пріоритет, однакова назва — лише кандидат. */
export function DuplicatesPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [platform, setPlatform] = useState<Platform>('telegram');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState('');
  const [groups, setGroups] = useState<Group[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [archiveCandidate, setArchiveCandidate] = useState<Chat | null>(null);
  const [loadedKey, setLoadedKey] = useState('');
  const cache = useRef(new Map<string, { groups: Group[]; names: Record<string, string> }>());
  const currentKey = platform === 'telegram' && !accountId ? '' : `${platform}:${platform === 'telegram' ? accountId : '-'}`;
  const viewReady = Boolean(currentKey) && loadedKey === currentKey;

  const loadAccounts = useCallback(async () => {
    const response = await fetch('/api/telegram-accounts', { cache: 'no-store' });
    const body = await response.json() as { accounts?: Account[]; error?: string };
    if (!response.ok) throw new Error(body.error || 'Не вдалося завантажити Telegram-акаунти.');
    const next = (body.accounts || []).filter((account) => account.enabled);
    setAccounts(next);
    setAccountId((current) => (next.some((account) => account.id === current) ? current : (next.find((account) => account.selected) || next[0])?.id || ''));
  }, []);

  const load = useCallback(async () => {
    if (!open) return;
    if (platform === 'telegram' && !accountId) { setGroups([]); setLoadedKey(''); return; }
    const key = `${platform}:${platform === 'telegram' ? accountId : '-'}`;
    const cached = cache.current.get(key);
    if (cached) { setGroups(cached.groups); setNames(cached.names); setLoadedKey(key); } else setLoadedKey('');
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ platform });
      if (platform === 'telegram') params.set('account', accountId);
      const response = await fetch(`/api/chats/duplicates?${params}`, { cache: 'no-store' });
      const body = await response.json() as { groups?: Group[]; error?: string };
      if (!response.ok) throw new Error(body.error || 'Не вдалося завантажити дублікати.');
      const next = body.groups || [];
      const nextNames = Object.fromEntries(next.flatMap((group) => group.chats.map((chat) => [chat.id, chat.name])));
      cache.current.set(key, { groups: next, names: nextNames }); setGroups(next); setNames(nextNames); setLoadedKey(key);
    } catch (reason) { setError(humanError(reason, 'Не вдалося завантажити дублікати.')); }
    finally { setLoading(false); }
  }, [open, platform, accountId]);

  useEffect(() => { if (!open) return; const timer = setTimeout(() => void loadAccounts().catch((reason) => setError(humanError(reason, 'Не вдалося завантажити акаунти.'))), 0); return () => clearTimeout(timer); }, [open, loadAccounts]);
  useEffect(() => { if (!open) return; const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [open, load]);

  async function rename(chat: Chat) {
    const name = (names[chat.id] || '').trim(); if (!name || name === chat.name) return;
    setBusy(chat.id); setError(''); setNotice('');
    try {
      const response = await fetch('/api/chats/duplicates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'rename', id: chat.id, stateToken: chat.stateToken, name }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || 'Не вдалося перейменувати чат.');
      setNotice('Назву збережено.'); await load();
    } catch (reason) { setError(humanError(reason, 'Не вдалося перейменувати чат.')); }
    finally { setBusy(null); }
  }

  async function archive(chat: Chat) {
    if (chat.status === 'archived') return;
    setBusy(chat.id); setError(''); setNotice('');
    try {
      const response = await fetch('/api/chats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: chat.id, action: 'archive', reason: 'Дублікат', stateToken: chat.stateToken, accountId: platform === 'telegram' ? accountId : null }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || 'Не вдалося архівувати чат.');
      setNotice('Чат перенесено в архів з причиною «Дублікат».'); await load();
    } catch (reason) { setError(humanError(reason, 'Не вдалося архівувати чат.')); }
    finally { setBusy(null); }
  }

  return (
    <>
      <ConfirmDialog open={archiveCandidate !== null} title="Архівувати дублікат?" description={archiveCandidate ? `«${archiveCandidate.name}» залишиться в архіві й надалі блокуватиме повторне додавання цього чату.` : ''} confirmLabel="Архівувати як дублікат" destructive busy={busy !== null} onCancel={() => setArchiveCandidate(null)} onConfirm={() => { const chat = archiveCandidate; if (!chat) return; setArchiveCandidate(null); void archive(chat); }} />
      <Panel open={open} onOpenChange={(next) => { if (!next && !busy) onClose(); }} title="Менеджер дублікатів" subtitle="Точні посилання мають вищий пріоритет. Однакова назва з різними URL — лише кандидат для ручної перевірки.">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {PLATFORMS.map(([value, label]) => <Chip key={value} pressed={platform === value} disabled={busy !== null} onClick={() => setPlatform(value)}>{label}</Chip>)}
            <Button variant="ghost" size="sm" disabled={loading || busy !== null || (platform === 'telegram' && !accountId)} onClick={() => void load()}>Оновити</Button>
          </div>
          {platform === 'telegram' ? (
            <Select aria-label="Telegram-акаунт для перевірки дублікатів" value={accountId} disabled={busy !== null} onChange={(event) => setAccountId(event.target.value)}>
              <option value="">Обери акаунт</option>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · #{account.number}</option>)}
            </Select>
          ) : null}
          {error ? <p role="alert" className="m-0 text-sm text-hot">{error}</p> : null}
          {notice ? <output className="block text-sm text-ok">{notice}</output> : null}
          {loading && !viewReady ? <div aria-busy="true" className="flex flex-col gap-2">{[0, 1, 2].map((item) => <Ghost key={item} className="h-24 rounded-inner" />)}</div> : viewReady && groups.length ? (
            <div className="flex flex-col gap-3">
              {groups.map((group) => (
                <section key={group.key} className="flex flex-col gap-3 rounded-inner border border-line bg-sunken p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><h3 className="m-0 truncate text-[15px] font-medium">{group.chats[0]?.name}</h3><p className="m-0 text-xs text-ink-2">{group.chats.length} записів для перевірки</p></div>
                    <span className="shrink-0 text-xs text-ink-2">{group.match === 'link' ? 'Точне посилання' : 'Однакова назва — перевірити'}</span>
                  </div>
                  {group.chats.map((chat) => (
                    <div key={chat.id} className="flex flex-col gap-2 border-t border-line pt-3">
                      <Input aria-label={`Назва ${chat.name}`} value={names[chat.id] ?? chat.name} disabled={busy !== null} onChange={(event) => setNames((current) => ({ ...current, [chat.id]: event.target.value }))} />
                      <a className="inline-flex items-center gap-1.5 truncate text-xs text-ink-2 underline-offset-4 hover:underline" href={chat.link} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" strokeWidth={1.5} className="size-3.5 shrink-0" /><span className="truncate">{chat.link}</span></a>
                      <p className="m-0 text-xs text-ink-2">{chat.status === 'archived' ? `Архів${chat.archiveReason ? ` · ${chat.archiveReason}` : ''}` : chat.status}</p>
                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" disabled={busy !== null || !(names[chat.id] || '').trim() || (names[chat.id] || '').trim() === chat.name} onClick={() => void rename(chat)}>Зберегти назву</Button>
                        {chat.status !== 'archived' ? <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => setArchiveCandidate(chat)}>Архівувати як дублікат</Button> : null}
                      </div>
                    </div>
                  ))}
                </section>
              ))}
            </div>
          ) : viewReady ? <p className="m-0 rounded-inner border border-dashed border-line-strong px-4 py-5 text-sm text-ink-2">Кандидатів не знайдено. На цій платформі немає повторів за нормалізованим посиланням або назвою.</p> : null}
        </div>
      </Panel>
    </>
  );
}
