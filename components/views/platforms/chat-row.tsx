'use client';

import { Archive, Check, Clock3, Copy, Ellipsis, ExternalLink, History, ListMinus, Plus, RotateCcw, Send, Trash2, Undo2, UserRoundCheck } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { useToast } from '@/components/ui/toast';
import type { TelegramAccount } from '@/components/views/platforms/telegram-accounts';
import { canPublish, compactChatLink, isSnoozed, type Chat, type Queue, type UndoSpec } from '@/components/views/platforms/use-platforms';
import { supportsChatLeaveChecklist } from '@/lib/chats/leave-policy';
import { shouldSuggestChatArchive } from '@/lib/chats/snooze-history';
import { cn } from '@/lib/utils';

const formatDateTime = (value: number) => new Intl.DateTimeFormat('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' }).format(new Date(value * 1000));
const canPermanentlyDelete = (chat: Chat) => chat.status === 'archived' && chat.archiveReason === 'Чат не існує' && (!supportsChatLeaveChecklist(chat.platform) || chat.joinedAt === null || chat.leftAt !== null);

function readyLabel(chat: Chat, clock: number) {
  if (chat.discoveryDecision && chat.discoveryDecision !== 'target') return 'Кваліфікація';
  if (chat.platform !== 'telegram' && canPublish(chat, clock)) return 'Опублікувати';
  if (canPublish(chat, clock)) return 'Підготувати';
  if (isSnoozed(chat, clock)) return 'Відкладено';
  return 'Очікування 6 год';
}

export type ChatRowProps = {
  chat: Chat;
  queue: Queue;
  /** Telegram «Для приєднання»: рядок черги (відібраний) чи «Нового чату». */
  section?: 'queue' | 'pool';
  clock: number;
  busy: boolean;
  lastOpened: boolean;
  accounts: TelegramAccount[];
  whatsappAutopostReady: boolean;
  onAct: (chat: Chat, action: string, extra?: Record<string, unknown>, undo?: UndoSpec) => void;
  onShortlist: (chat: Chat) => void;
  onUnshortlist: (chat: Chat) => void;
  onPublish: (chat: Chat) => void;
  onProfile: (chat: Chat) => void;
  onHistory: (chat: Chat) => void;
  onArchive: (chat: Chat) => void;
  onOpen: (chat: Chat) => void;
  onReturn: (chat: Chat) => void;
  onDelete: (chat: Chat) => void;
  onAssign: (chat: Chat, accountId: string) => void;
  onAutopost: (chat: Chat) => void;
};

/** Рядок чату: ім'я, сигнали стану, головна дія черги й меню решти дій. Без blur, із content-visibility для довгих списків. */
export function ChatRow({ chat, queue, section, clock, busy, lastOpened, accounts, whatsappAutopostReady, onAct, onShortlist, onUnshortlist, onPublish, onProfile, onHistory, onArchive, onOpen, onReturn, onDelete, onAssign, onAutopost }: ChatRowProps) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const snoozed = isSnoozed(chat, clock);
  const blockedByQualification = Boolean(chat.discoveryDecision && chat.discoveryDecision !== 'target');
  const publishable = canPublish(chat, clock);
  const undo8 = (label: string, action: 'restore' | 'unsnooze' | 'return_to_join'): UndoSpec => ({ action, label });
  const telegramJoin = chat.platform === 'telegram' && queue === 'to_join';

  const signals: Array<{ key: string; text: string; tone?: 'ok' | 'warn' }> = [];
  if (lastOpened) signals.push({ key: 'last', text: 'Останній відкритий' });
  if (chat.platform !== 'viber' && !chat.profileConfirmed && (queue === 'ready' || queue === 'profile_review')) signals.push({ key: 'profile', text: 'Профіль пізніше', tone: 'warn' });
  if (queue === 'profile_review') signals.push({ key: 'which', text: chat.status === 'waiting' ? 'Очікування' : 'Для публікації' });
  if (queue === 'ready' && blockedByQualification) signals.push({ key: 'qual', text: 'Потрібна кваліфікація', tone: 'warn' });
  if (chat.autopostJobId) signals.push({ key: 'auto', text: 'Автопост у черзі' });
  if (chat.publishedToday) signals.push({ key: 'pub', text: 'Опубліковано сьогодні', tone: 'ok' });

  const copy = async () => {
    try { await navigator.clipboard.writeText(chat.link); setCopied(true); toast.push({ message: 'Посилання скопійовано.' }); window.setTimeout(() => setCopied(false), 1600); }
    catch { toast.push({ message: 'Не вдалося скопіювати посилання.', tone: 'hot' }); }
  };

  return (
    <li className={cn('cv-auto flex flex-col gap-2 rounded-inner border px-4 py-3 transition-colors', chat.publishedToday ? 'border-line opacity-70' : 'border-line bg-sunken')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="m-0 truncate text-sm font-medium" title={chat.name}>{chat.name}</p>
          <button type="button" className="-mb-2 -mt-5 max-w-full truncate pb-2 pt-5 text-left font-mono text-[11px] text-ink-2 underline-offset-4 hover:underline" title={chat.link} aria-label={`Відкрити чат: ${chat.link}`} onClick={() => onOpen(chat)}>{compactChatLink(chat.link)}</button>
        </div>
        <Menu>
          <MenuTrigger render={<Button variant="icon" size="sm" aria-label={`Ще дії для «${chat.name}»`} disabled={busy} />}><Ellipsis aria-hidden="true" strokeWidth={1.5} /></MenuTrigger>
          <MenuContent align="end">
            {(queue === 'waiting' || queue === 'ready' || queue === 'profile_review' || telegramJoin) ? <MenuItem onClick={() => onProfile(chat)}><UserRoundCheck aria-hidden="true" strokeWidth={1.5} />Профіль і правила</MenuItem> : null}
            {(queue === 'waiting' || queue === 'ready') ? <MenuItem disabled={chat.publishedToday} onClick={() => onAct(chat, snoozed ? 'unsnooze' : 'snooze', {}, snoozed ? undefined : undo8('Відкладення можна скасувати протягом 8 секунд.', 'unsnooze'))}><Clock3 aria-hidden="true" strokeWidth={1.5} />{snoozed ? 'Повернути зараз' : 'Відкласти на 3 дні'}</MenuItem> : null}
            {telegramJoin && section === 'queue' ? <MenuItem onClick={() => onUnshortlist(chat)}><ListMinus aria-hidden="true" strokeWidth={1.5} />Прибрати з черги</MenuItem> : null}
            {queue === 'ready' && chat.platform === 'whatsapp' ? <MenuItem disabled={Boolean(chat.autopostJobId)} onClick={() => onReturn(chat)}><Undo2 aria-hidden="true" strokeWidth={1.5} />Повернути для приєднання</MenuItem> : null}
            {queue === 'ready' && chat.platform === 'telegram' ? <MenuItem onClick={() => onReturn(chat)}><Undo2 aria-hidden="true" strokeWidth={1.5} />Повернути в чергу приєднання</MenuItem> : null}
            {queue === 'archived' && supportsChatLeaveChecklist(chat.platform) && chat.joinedAt !== null ? <MenuItem onClick={() => onAct(chat, chat.leftAt ? 'undo_leave' : 'confirm_leave')}>{chat.leftAt ? <><Undo2 aria-hidden="true" strokeWidth={1.5} />Скасувати вихід</> : <><Check aria-hidden="true" strokeWidth={1.5} />Я вийшов із чату</>}</MenuItem> : null}
            {queue === 'archived' && canPermanentlyDelete(chat) ? <MenuItem onClick={() => onDelete(chat)}><Trash2 aria-hidden="true" strokeWidth={1.5} />Видалити назавжди</MenuItem> : null}
            <MenuItem onClick={() => void copy()}><Copy aria-hidden="true" strokeWidth={1.5} />{copied ? 'Скопійовано' : 'Копіювати посилання'}</MenuItem>
            <MenuItem onClick={() => onOpen(chat)}><ExternalLink aria-hidden="true" strokeWidth={1.5} />Відкрити чат</MenuItem>
            <MenuItem onClick={() => onHistory(chat)}><History aria-hidden="true" strokeWidth={1.5} />Історія чату</MenuItem>
            {queue !== 'archived' ? <MenuItem onClick={() => onArchive(chat)}><Archive aria-hidden="true" strokeWidth={1.5} />Перенести в архів</MenuItem> : null}
            {chat.platform === 'telegram' && queue !== 'to_join' && queue !== 'profile_review' && accounts.filter((item) => item.enabled && item.id !== chat.telegramAccountId).length ? (
              <>
                <MenuSeparator />
                <MenuLabel>Перепризначити акаунт</MenuLabel>
                {accounts.filter((item) => item.enabled && item.id !== chat.telegramAccountId).map((account) => <MenuItem key={account.id} onClick={() => onAssign(chat, account.id)}>{account.name} · #{account.number}</MenuItem>)}
              </>
            ) : null}
          </MenuContent>
        </Menu>
      </div>

      {signals.length || chat.archiveReason || (chat.snoozedUntil && chat.snoozedUntil > clock / 1000) || chat.joinedAt ? (
        <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-2">
          {signals.map((signal) => <span key={signal.key} className={cn('inline-flex items-center gap-1.5', signal.tone === 'ok' && 'text-ok', signal.tone === 'warn' && 'text-warn')}>{signal.tone ? <i aria-hidden="true" className={cn('size-1.5 rounded-full', signal.tone === 'ok' ? 'bg-ok' : 'bg-warn')} /> : null}{signal.text}</span>)}
          {chat.archiveReason ? <span>Причина: {chat.archiveReason}</span> : null}
          {queue === 'archived' && chat.archivedAt ? <span>Архівовано {formatDateTime(chat.archivedAt)}</span> : null}
          {queue === 'archived' && supportsChatLeaveChecklist(chat.platform) && chat.joinedAt !== null ? <span>{chat.leftAt ? `Вихід підтверджено ${formatDateTime(chat.leftAt)}` : 'Ще потрібно вручну вийти з чату.'}</span> : null}
          {snoozed && chat.snoozedUntil ? <span className="inline-flex items-center gap-1"><Clock3 aria-hidden="true" strokeWidth={1.5} className="size-3" />Відкладено до {formatDateTime(chat.snoozedUntil)}</span> : null}
          {chat.joinedAt && queue !== 'archived' ? <span>Приєднано {formatDateTime(chat.joinedAt)}</span> : null}
        </p>
      ) : null}

      {(queue === 'waiting' || queue === 'ready') && shouldSuggestChatArchive(chat.snoozeCount) ? (
        <div className="flex items-center justify-between gap-3 rounded-field border border-warn/40 px-3 py-2 text-xs"><span>Відкладали {chat.snoozeCount} рази. Якщо чат неактуальний, краще в архів.</span><Button variant="outline" size="sm" disabled={busy} onClick={() => onArchive(chat)}><Archive aria-hidden="true" strokeWidth={1.5} />Архівувати</Button></div>
      ) : null}
      {queue === 'ready' && !publishable ? <p className="m-0 flex items-center gap-1.5 text-xs text-ink-2"><Clock3 aria-hidden="true" strokeWidth={1.5} className="size-3.5" />{blockedByQualification ? 'Публікація заблокована до завершення кваліфікації чату.' : chat.availableAt ? `Публікація буде доступна ${formatDateTime(chat.availableAt)}` : 'Публікація поки недоступна.'}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        {queue === 'to_join' && telegramJoin && section === 'pool' ? (
          <Button variant="action" size="sm" disabled={busy} onClick={() => onShortlist(chat)}><Plus aria-hidden="true" strokeWidth={1.5} />У чергу</Button>
        ) : queue === 'to_join' ? (
          <>
            <Button variant="action" size="sm" disabled={busy} onClick={() => onAct(chat, 'joined', {}, undo8('Чат приєднано. Можна скасувати протягом 8 секунд.', 'return_to_join'))}>Приєднано</Button>
            {(chat.platform === 'telegram' || chat.platform === 'whatsapp') ? <Button variant="outline" size="sm" disabled={busy} onClick={() => onAct(chat, 'waiting', {}, undo8('Чат у черзі очікування. Можна скасувати протягом 8 секунд.', 'return_to_join'))}>В очікування</Button> : null}
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => onArchive(chat)}>В архів</Button>
          </>
        ) : null}
        {queue === 'waiting' ? <Button variant="action" size="sm" disabled={busy} onClick={() => onAct(chat, 'approved')}><UserRoundCheck aria-hidden="true" strokeWidth={1.5} />Прийняли</Button> : null}
        {queue === 'ready' ? (
          <>
            {!chat.publishedToday ? <Button variant="action" size="sm" disabled={busy || Boolean(chat.autopostJobId) || blockedByQualification || !publishable} onClick={() => onPublish(chat)}><Send aria-hidden="true" strokeWidth={1.5} />{readyLabel(chat, clock)}</Button> : null}
            {chat.platform === 'whatsapp' && !chat.publishedToday ? <Button variant={chat.autopostJobId ? 'outline' : 'ghost'} size="sm" disabled={busy || blockedByQualification || (!chat.autopostJobId && (!whatsappAutopostReady || !publishable))} onClick={() => onAutopost(chat)}>{chat.autopostJobId ? 'Скасувати автопост' : 'Автопост'}</Button> : null}
          </>
        ) : null}
        {queue === 'profile_review' ? <Button variant="action" size="sm" disabled={busy} onClick={() => onProfile(chat)}><UserRoundCheck aria-hidden="true" strokeWidth={1.5} />Уточнити профіль</Button> : null}
        {queue === 'archived' ? <Button variant="outline" size="sm" disabled={busy} onClick={() => onAct(chat, 'restore')}><RotateCcw aria-hidden="true" strokeWidth={1.5} />Відновити</Button> : null}
      </div>
    </li>
  );
}
