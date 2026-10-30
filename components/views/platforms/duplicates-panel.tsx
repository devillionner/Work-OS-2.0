'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Panel } from '@/components/shell/panel';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Ghost } from '@/components/ui/ghost';
import { Input } from '@/components/ui/input';
import { humanError } from '@/components/ui/human-error';

type Platform = 'all' | 'telegram' | 'whatsapp' | 'viber' | 'facebook';
type Chat = { id: string; name: string; link: string; normalizedLink: string; platform: string; status: string; archiveReason: string | null; archivedAt: number | null; telegramAccountId: string | null; accountName?: string | null; stateToken: string };
type Group = { key: string; match: 'link' | 'name'; chats: Chat[]; keepId: string; publications: Record<string, number>; collisionDays: number };
const PLATFORMS: Array<[Platform, string]> = [['all', 'Усі'], ['telegram', 'Telegram'], ['whatsapp', 'WhatsApp'], ['viber', 'Viber'], ['facebook', 'Facebook']];
const STATUS: Record<string, string> = { to_join: 'Для приєднання', ready: 'Для публікації', waiting: 'Очікування', failed: 'Не вдалося', archived: 'Архів' };

type MergeAsk = { groups: Group[]; keep: Record<string, string>; acceptLoss: boolean };

/** Менеджер дублікатів: копія видаляється назавжди, а уся її історія переходить на основний чат. */
export function DuplicatesPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [platform, setPlatform] = useState<Platform>('all');
  const [groups, setGroups] = useState<Group[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [keep, setKeep] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [ask, setAsk] = useState<MergeAsk | null>(null);
  const [loaded, setLoaded] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async () => {
    if (!open) return;
    setLoading(true); setError('');
    try {
      // Перший прохід індексує чати порціями: поки не закінчив, запитуємо знову.
      for (let attempt = 0; attempt < 40 && alive.current; attempt += 1) {
        const params = new URLSearchParams();
        if (platform !== 'all') params.set('platform', platform);
        const response = await fetch(`/api/chats/duplicates?${params}`, { cache: 'no-store' });
        const body = await response.json() as { groups?: Group[]; indexing?: boolean; error?: string };
        if (!response.ok) throw new Error(body.error || 'Не вдалося завантажити дублікати.');
        if (body.indexing) { setIndexing(true); continue; }
        const next = body.groups || [];
        setIndexing(false);
        setGroups(next);
        setNames(Object.fromEntries(next.flatMap((group) => group.chats.map((chat) => [chat.id, chat.name]))));
        setKeep((current) => Object.fromEntries(next.map((group) => [group.key, group.chats.some((chat) => chat.id === current[group.key]) ? current[group.key] : group.keepId])));
        setLoaded(true);
        return;
      }
      throw new Error('Індексація чатів триває довго. Спробуй ще раз.');
    } catch (reason) { setError(humanError(reason, 'Не вдалося завантажити дублікати.')); }
    finally { setLoading(false); }
  }, [open, platform]);

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

  async function mergeAll(request: MergeAsk) {
    setBusy('merge'); setError(''); setNotice('');
    let merged = 0; let lost = 0; const collided: Group[] = [];
    try {
      for (const group of request.groups) {
        const keepId = request.keep[group.key] || group.keepId;
        const response = await fetch('/api/chats/duplicates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'merge', keepId, removeIds: group.chats.map((chat) => chat.id).filter((id) => id !== keepId), acceptLoss: request.acceptLoss }) });
        const body = await response.json() as { error?: string; code?: string; merged?: number; lostPublications?: number };
        if (response.status === 409 && body.code === 'publication_collision') { collided.push(group); continue; }
        if (!response.ok) throw new Error(body.error || 'Не вдалося злити чати.');
        merged += body.merged || 0; lost += body.lostPublications || 0;
      }
      setNotice(`Видалено копій: ${merged}.${lost ? ` Публікацій за збігом дат: ${lost}.` : ''}${collided.length ? ` Груп зі збігом дат публікацій: ${collided.length}, їх потрібно підтвердити окремо.` : ''}`);
      if (collided.length) setAsk({ groups: collided, keep: request.keep, acceptLoss: true });
      await load();
    } catch (reason) { setError(humanError(reason, 'Не вдалося злити чати.')); await load(); }
    finally { setBusy(null); }
  }

  const exact = groups.filter((group) => group.match === 'link');
  const removeCount = (list: Group[]) => list.reduce((sum, group) => sum + group.chats.length - 1, 0);
  const askText = (request: MergeAsk) => request.groups.slice(0, 12).map((group) => {
    const main = group.chats.find((chat) => chat.id === (request.keep[group.key] || group.keepId)) || group.chats[0];
    const others = group.chats.filter((chat) => chat.id !== main.id).map((chat) => `${STATUS[chat.status] || chat.status}${chat.accountName ? ` · ${chat.accountName}` : ''}`);
    return `«${main.name}» — основний, видаляється: ${others.join('; ')}`;
  }).join('\n') + (request.groups.length > 12 ? `\n…і ще ${request.groups.length - 12} груп` : '');

  return (
    <>
      <ConfirmDialog
        open={ask !== null}
        title={ask?.acceptLoss ? 'Злити зі збігом дат публікацій?' : `Злити дублікати: ${ask ? removeCount(ask.groups) : 0}?`}
        description={ask ? <span className="whitespace-pre-line">{`${askText(ask)}\n\nКопії буде видалено назавжди, уся їхня історія (публікації, події, задачі автопосту, слоти розкладу, джерело лідів) перейде на основний чат.${ask.acceptLoss ? ' У добах зі збігом лишиться одна публікація.' : ''}`}</span> : ''}
        confirmLabel="Злити й видалити копії" destructive busy={busy !== null}
        onCancel={() => setAsk(null)}
        onConfirm={() => { const request = ask; if (!request) return; setAsk(null); void mergeAll(request); }}
      />
      <Panel open={open} onOpenChange={(next) => { if (!next && !busy) onClose(); }} title="Менеджер дублікатів" subtitle="Шукає повтори по всіх акаунтах: за канонічним посиланням, кодом запрошення чи username і за однаковою назвою.">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {PLATFORMS.map(([value, label]) => <Chip key={value} pressed={platform === value} disabled={busy !== null} onClick={() => setPlatform(value)}>{label}</Chip>)}
            <Button variant="ghost" size="sm" disabled={loading || busy !== null} onClick={() => void load()}>Оновити</Button>
          </div>
          {exact.length ? <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => setAsk({ groups: exact.filter((group) => group.collisionDays === 0), keep, acceptLoss: false })}>Злити точні збіги ({removeCount(exact.filter((group) => group.collisionDays === 0))})</Button> : null}
          {error ? <p role="alert" className="m-0 text-sm text-hot">{error}</p> : null}
          {notice ? <output className="block text-sm text-ok">{notice}</output> : null}
          {indexing ? <p className="m-0 text-sm text-ink-2">Готую індекс чатів, це відбувається один раз.</p> : null}
          {loading && !loaded ? <div aria-busy="true" className="flex flex-col gap-2">{[0, 1, 2].map((item) => <Ghost key={item} className="h-24 rounded-inner" />)}</div> : groups.length ? (
            <div className="flex flex-col gap-3">
              {groups.map((group) => {
                const main = keep[group.key] || group.keepId;
                return (
                  <section key={group.key} className="flex flex-col gap-3 rounded-inner border border-line bg-sunken p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0"><h3 className="m-0 truncate text-[15px] font-medium">{group.chats[0]?.name}</h3><p className="m-0 text-xs text-ink-2">{group.chats.length} записів{group.collisionDays ? ` · збіг дат публікацій: ${group.collisionDays}` : ''}</p></div>
                      <span className="shrink-0 text-xs text-ink-2">{group.match === 'link' ? 'Те саме посилання' : 'Однакова назва — перевір'}</span>
                    </div>
                    {group.chats.map((chat) => (
                      <div key={chat.id} className="flex flex-col gap-2 border-t border-line pt-3">
                        <Input aria-label={`Назва ${chat.name}`} value={names[chat.id] ?? chat.name} disabled={busy !== null} onChange={(event) => setNames((current) => ({ ...current, [chat.id]: event.target.value }))} />
                        <a className="inline-flex items-center gap-1.5 truncate text-xs text-ink-2 underline-offset-4 hover:underline" href={chat.link} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" strokeWidth={1.5} className="size-3.5 shrink-0" /><span className="truncate">{chat.link}</span></a>
                        <p className="m-0 text-xs text-ink-2">{STATUS[chat.status] || chat.status}{chat.status === 'archived' && chat.archiveReason ? ` · ${chat.archiveReason}` : ''}{chat.accountName ? ` · ${chat.accountName}` : ''}{group.publications[chat.id] ? ` · публікацій: ${group.publications[chat.id]}` : ''}</p>
                        <div className="flex flex-wrap gap-2">
                          <Button variant={main === chat.id ? 'action' : 'outline'} size="sm" disabled={busy !== null || main === chat.id} onClick={() => setKeep((current) => ({ ...current, [group.key]: chat.id }))}>{main === chat.id ? 'Основний' : 'Зробити основним'}</Button>
                          <Button variant="ghost" size="sm" disabled={busy !== null || !(names[chat.id] || '').trim() || (names[chat.id] || '').trim() === chat.name} onClick={() => void rename(chat)}>Зберегти назву</Button>
                        </div>
                      </div>
                    ))}
                    <div className="flex flex-wrap gap-2 border-t border-line pt-3">
                      <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => setAsk({ groups: [group], keep, acceptLoss: false })}>Злити в основний і видалити копії</Button>
                    </div>
                  </section>
                );
              })}
            </div>
          ) : loaded ? <p className="m-0 rounded-inner border border-dashed border-line-strong px-4 py-5 text-sm text-ink-2">Повторів не знайдено. Той самий чат не може потрапити в Work OS двічі, у жодного акаунта.</p> : null}
        </div>
      </Panel>
    </>
  );
}
