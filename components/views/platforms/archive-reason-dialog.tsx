'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

export const ARCHIVE_REASONS = ['Забанено', 'Чат не існує', 'Чат не цільовий'] as const;
/** Лише для черги «Для приєднання»: відрізняється від звичайної архівації тим, що скидає стан пошуку чатів. */
export const JOIN_FAILED_REASON = 'Не вдалося приєднатися';

/** Підтвердження архівації: готові причини або власна. Модалка — бо це підтвердження дії. */
export function ArchiveReasonDialog({ open, chatName, joinFailed = false, busy = false, error, onCancel, onConfirm }: {
  open: boolean;
  chatName: string | null;
  joinFailed?: boolean;
  busy?: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => { if (!next && !busy) onCancel(); }}
      title="Перенести чат в архів?"
      description={chatName ? `«${chatName}». Обери причину: чат зникне з поточної черги, але його можна відновити з архіву.` : 'Обери причину архівації.'}
    >
      {open ? <ReasonBody reasons={joinFailed ? [JOIN_FAILED_REASON, ...ARCHIVE_REASONS] : ARCHIVE_REASONS} busy={busy} error={error} onCancel={onCancel} onConfirm={onConfirm} /> : null}
    </Dialog>
  );
}

function ReasonBody({ reasons, busy, error, onCancel, onConfirm }: { reasons: readonly string[]; busy: boolean; error?: string; onCancel: () => void; onConfirm: (reason: string) => void }) {
  const [custom, setCustom] = useState('');
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {reasons.map((reason) => <Button key={reason} variant="outline" className="justify-start" disabled={busy} onClick={() => onConfirm(reason)}>{reason}</Button>)}
      </div>
      <div className="flex gap-2">
        <Input value={custom} maxLength={100} disabled={busy} aria-label="Власна причина архівації" placeholder="Інша причина" onChange={(event) => setCustom(event.target.value)} />
        <Button variant="action" disabled={busy || !custom.trim()} onClick={() => onConfirm(custom.trim())}>Архівувати</Button>
      </div>
      {error ? <p role="alert" className="m-0 text-xs text-hot">{error}</p> : null}
      <div className="flex justify-end"><Button variant="ghost" disabled={busy} onClick={onCancel}>Скасувати</Button></div>
    </div>
  );
}
