'use client';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type Props = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  busy?: boolean;
  destructive?: boolean;
  onCancel(): void;
  onConfirm(): void;
};

export function ConfirmDialog({ open, title, description, confirmLabel, busy=false, destructive=false, onCancel, onConfirm }: Props) {
  return <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onCancel(); }}>
    <DialogContent className="confirm-dialog" showCloseButton={false}>
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
      <DialogFooter>
        <Button variant="outline" disabled={busy} onClick={onCancel}>Скасувати</Button>
        <Button variant={destructive ? 'destructive' : 'default'} disabled={busy} onClick={onConfirm}>{busy ? 'Виконуємо…' : confirmLabel}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
