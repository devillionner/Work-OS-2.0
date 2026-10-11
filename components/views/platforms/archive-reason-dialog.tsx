'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

export const ARCHIVE_REASONS = ['Забанено', 'Чат не існує', 'Чат не цільовий'] as const;

/** Підтвердження архівації: готові причини або власна. Модалка — бо це підтвердження дії. */
export function ArchiveReasonDialog({ open, chatName, busy = false, error, onCancel, onConfirm }: {
  open: boolean;
  chatName: string | null;
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
      {open ? <ReasonBody busy={busy} error={error} onCancel={onCancel} onConfirm={onConfirm} /> : null}
    </Dialog>
  );
}

function ReasonBody({ busy, error, onCancel, onConfirm }: { busy: boolean; error?: string; onCancel: () => void; onConfirm: (reason: string) => void }) {
  const [custom, setCustom] = useState('');
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {ARCHIVE_REASONS.map((reason) => <Button key={reason} variant="outline" className="justify-start" disabled={busy} onClick={() => onConfirm(reason)}>{reason}</Button>)}
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
