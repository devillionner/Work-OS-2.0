'use client';

import { useCallback, useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { DuplicateChat, DuplicateGroup } from '@/lib/chats/duplicates';
import type { ChatPlatform } from '@/lib/chats/bulk-input';

type ApiResult = { groups?: DuplicateGroup[]; error?: string };

export function ChatDuplicatesDialog({
  open,
  platform,
  telegramAccountId,
  onClose,
  onChanged,
}: {
  open: boolean;
  platform: ChatPlatform;
  telegramAccountId?: string | null;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [names, setNames] = useState<Record<string,string>>({});

  const load = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const params = new URLSearchParams({ platform });
      if (platform === 'telegram' && telegramAccountId) params.set('account', telegramAccountId);
      const response = await fetch(`/api/chats/duplicates?${params}`, { cache: 'no-store' });
      const body = await response.json() as ApiResult;
      if (!response.ok) throw new Error(body.error || 'Не вдалося перевірити дублікати.');
      const next = body.groups || [];
      setGroups(next);
      setNames(Object.fromEntries(next.flatMap((group) => group.chats.map((chat) => [chat.id, chat.name]))));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не вдалося перевірити дублікати.');
    } finally { setBusy(false); }
  }, [platform, telegramAccountId]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  async function mutate(chat: DuplicateChat, action: 'rename'|'archive') {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/chats/duplicates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: chat.id, action, stateToken: chat.stateToken, name: names[chat.id] }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || 'Не вдалося оновити чат.');
      await load();
      onChanged?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не вдалося оновити чат.');
      setBusy(false);
    }
  }

  return <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
    <DialogContent className="chat-duplicates-dialog" showCloseButton={false}>
      <DialogHeader>
        <DialogTitle>Менеджер дублікатів</DialogTitle>
        <DialogDescription>Точне посилання — сильний збіг. Однакова назва з різними посиланнями лише підсвічується для ручної перевірки.</DialogDescription>
      </DialogHeader>
      <Button variant="ghost" size="icon" aria-label="Закрити" disabled={busy} onClick={onClose}>×</Button>
      {error && <div className="workspace-error" role="alert">{error}</div>}
      {busy && !groups.length ? <p className="workspace-loading">Перевіряємо чати…</p> : groups.length ? <div className="duplicate-groups">
        {groups.map((group) => <section key={group.key} className="duplicate-group">
          <div className="duplicate-group-heading"><strong>{group.reason === 'link' ? 'Точне посилання' : 'Однакова назва — перевірити вручну'}</strong><span>{group.chats.length} записи</span></div>
          {group.chats.map((chat) => <div key={chat.id} className="duplicate-chat-row">
            <div className="duplicate-chat-main">
              <Input value={names[chat.id] ?? chat.name} disabled={busy} aria-label={`Назва ${chat.name}`} onChange={(event) => setNames((current) => ({ ...current, [chat.id]: event.target.value }))}/>
              <small>{chat.status} · {chat.link}</small>
              {chat.archiveReason && <small>Архів: {chat.archiveReason}</small>}
            </div>
            <div className="duplicate-chat-actions">
              <Button type="button" variant="outline" size="sm" onClick={() => window.open(chat.link, '_blank', 'noopener,noreferrer')}><ExternalLink data-icon="inline-start"/>Відкрити</Button>
              <Button type="button" variant="outline" size="sm" disabled={busy || (names[chat.id] ?? chat.name).trim() === chat.name} onClick={() => void mutate(chat, 'rename')}>Перейменувати</Button>
              {chat.status !== 'archived' && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void mutate(chat, 'archive')}>В архів як дублікат</Button>}
            </div>
          </div>)}
        </section>)}
      </div> : !busy && <p className="muted-note">Дублікатів у цьому наборі не знайдено.</p>}
      <div className="dialog-actions"><Button variant="outline" disabled={busy} onClick={() => void load()}>Перевірити ще раз</Button><Button variant="outline" disabled={busy} onClick={onClose}>Закрити</Button></div>
    </DialogContent>
  </Dialog>;
}
