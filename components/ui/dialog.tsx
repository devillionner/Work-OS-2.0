'use client';

import { useState, type ReactNode } from 'react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** Модальні діалоги — лише для підтверджень. Деталі сутностей живуть в Inspector / Sheet. */
export function Dialog({ open, onOpenChange, title, description, children, footer, className }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-[60] bg-scrim opacity-100 transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <DialogPrimitive.Popup
          className={cn(
            'glass-strong frost shadow-float fixed left-1/2 top-1/2 z-[61] flex max-h-[calc(100dvh-2rem)] w-[min(440px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-panel p-6 outline-none transition-[opacity,scale] duration-200 data-[ending-style]:scale-95 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0',
            className,
          )}
        >
          <div className="flex flex-col gap-2">
            <DialogPrimitive.Title className="m-0 text-[17px] font-medium">{title}</DialogPrimitive.Title>
            {description ? <DialogPrimitive.Description className="m-0 text-sm text-ink-2">{description}</DialogPrimitive.Description> : null}
          </div>
          {children}
          {footer ? <div className="flex flex-wrap justify-end gap-2">{footer}</div> : null}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

type ConfirmProps = {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  destructive?: boolean;
  /** Небезпечна дія: підтвердження вимагає ввести цей текст. */
  requireText?: string;
  onCancel(): void;
  onConfirm(): void;
};

export function ConfirmDialog({ open, title, description, confirmLabel, busy = false, destructive = false, requireText, onCancel, onConfirm }: ConfirmProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onCancel(); }} title={title} description={description}>
      {open ? <ConfirmBody confirmLabel={confirmLabel} busy={busy} destructive={destructive} requireText={requireText} onCancel={onCancel} onConfirm={onConfirm} /> : null}
    </Dialog>
  );
}

function ConfirmBody({ confirmLabel, busy, destructive, requireText, onCancel, onConfirm }: Pick<ConfirmProps, 'confirmLabel' | 'busy' | 'destructive' | 'requireText' | 'onCancel' | 'onConfirm'>) {
  const [typed, setTyped] = useState('');
  const locked = Boolean(requireText) && typed.trim() !== requireText;
  return (
    <>
      {requireText ? (
        <label className="flex flex-col gap-1.5 text-xs text-ink-2">
          Щоб підтвердити, введи «{requireText}»
          <Input value={typed} autoComplete="off" disabled={busy} onChange={(event) => setTyped(event.target.value)} />
        </label>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" disabled={busy} onClick={onCancel}>Скасувати</Button>
        <Button variant={destructive ? 'outline' : 'action'} tone={destructive ? 'danger' : 'default'} busy={busy} disabled={locked} onClick={onConfirm}>{busy ? 'Виконуємо…' : confirmLabel}</Button>
      </div>
    </>
  );
}
