'use client';

import { useState } from 'react';
import { Plus, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Surface } from '@/components/ui/surface';
import type { TelegramAccount } from '@/components/views/platforms/telegram-accounts';
import { cn } from '@/lib/utils';

const formatDuration = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

/** Telegram-акаунти: вибір робочого, ліміт приєднань і перерва, керування (назва, вимкнення, новий). */
export function AccountsCard({ accounts, accountId, activeAccount, breakSeconds, busy, onAction }: {
  accounts: TelegramAccount[];
  accountId: string | null;
  activeAccount: TelegramAccount | undefined;
  breakSeconds: number;
  busy: boolean;
  onAction: (action: string, id?: string, extra?: Record<string, unknown>) => Promise<void>;
}) {
  const [manage, setManage] = useState(false);
  const [newName, setNewName] = useState('');
  const due = Boolean(activeAccount && activeAccount.joinStreak >= activeAccount.joinBatchSize);

  return (
    <Surface variant="glass" radius="card" className="flex flex-col gap-4 p-5" aria-labelledby="accounts-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="accounts-title" className="m-0 text-[15px] font-medium">Telegram-акаунти</h2>
        <Button variant="ghost" size="sm" onClick={() => setManage((value) => !value)}><Settings2 aria-hidden="true" strokeWidth={1.5} />Керувати</Button>
      </div>
      <fieldset className="m-0 flex flex-wrap gap-2 border-0 p-0">
        <legend className="sr-only">Робочий акаунт</legend>
        {accounts.filter((item) => item.enabled).map((account) => <Chip key={account.id} pressed={account.id === accountId} disabled={busy} onClick={() => void onAction('select', account.id)}>{account.name}<span className="font-mono text-[11px] opacity-70">#{account.number}</span></Chip>)}
        {!accounts.some((item) => item.enabled) ? <p className="m-0 text-sm text-ink-2">Увімкнених акаунтів немає. Додай або увімкни акаунт.</p> : null}
      </fieldset>

      {activeAccount ? (
        <div className={cn('flex flex-col gap-3 rounded-inner border px-4 py-3', due && !breakSeconds ? 'border-warn/50' : 'border-line bg-sunken')}>
          <div>
            <p className="m-0 text-sm font-medium">{breakSeconds ? <>Перерва <span className="font-mono">{formatDuration(breakSeconds)}</span></> : <>Приєднано <span className="font-mono">{activeAccount.joinStreak}</span> із <span className="font-mono">{activeAccount.joinBatchSize}</span></>}</p>
            {due && !breakSeconds ? <p className="m-0 text-xs text-ink-2">Час зробити перерву.</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-ink-2">Після
              <Select aria-label="Скільки приєднань до перерви" wrapperClassName="w-28" disabled={busy} value={activeAccount.joinBatchSize} onChange={(event) => void onAction('settings', activeAccount.id, { joinBatchSize: Number(event.target.value), breakMinutes: activeAccount.breakMinutes })}>{[3, 5, 7, 10].map((value) => <option value={value} key={value}>{value} чатів</option>)}</Select>
            </label>
            <label className="flex items-center gap-2 text-xs text-ink-2">На
              <Select aria-label="Тривалість перерви" wrapperClassName="w-24" disabled={busy} value={activeAccount.breakMinutes} onChange={(event) => void onAction('settings', activeAccount.id, { joinBatchSize: activeAccount.joinBatchSize, breakMinutes: Number(event.target.value) })}>{[5, 10, 15, 20, 30].map((value) => <option value={value} key={value}>{value} хв</option>)}</Select>
            </label>
            {!breakSeconds && due ? <Button variant="action" size="sm" disabled={busy} onClick={() => void onAction('start_break', activeAccount.id, { minutes: activeAccount.breakMinutes })}>Почати {activeAccount.breakMinutes} хв</Button> : null}
          </div>
        </div>
      ) : null}

      {manage ? (
        <div className="flex flex-col gap-3 border-t border-line pt-4">
          {accounts.map((account) => (
            <div key={account.id} className="flex items-center gap-2">
              <span className="w-8 shrink-0 font-mono text-xs text-ink-2">#{account.number}</span>
              <Input disabled={busy} defaultValue={account.name} aria-label={`Назва акаунта ${account.number}`} onBlur={(event) => { const name = event.target.value.trim(); if (name && name !== account.name) void onAction('rename', account.id, { name }); }} />
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void onAction('toggle', account.id)}>{account.enabled ? 'Вимкнути' : 'Увімкнути'}</Button>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <Input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Назва нового акаунта" aria-label="Назва нового Telegram-акаунта" />
            <Button variant="action" size="sm" disabled={busy} onClick={() => void onAction('create', undefined, { name: newName }).then(() => setNewName(''))}><Plus aria-hidden="true" strokeWidth={1.5} />Додати</Button>
          </div>
        </div>
      ) : null}
    </Surface>
  );
}
