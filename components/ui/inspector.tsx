'use client';

import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Каркас панелі деталей: заголовок, дії, необов'язкові вкладки, прокручуваний вміст. */
export function Inspector({ title, subtitle, actions, tabs, onClose, children, className }: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      <header className="flex shrink-0 items-start justify-between gap-3 px-5 pb-3 pt-5">
        <div className="min-w-0">
          <h2 className="m-0 truncate text-[17px] font-medium">{title}</h2>
          {subtitle ? <p className="m-0 mt-1 truncate text-[13px] text-ink-2">{subtitle}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {actions}
          <Button variant="icon" size="md" aria-label="Закрити" onClick={onClose}><X aria-hidden="true" strokeWidth={1.5} /></Button>
        </div>
      </header>
      {tabs}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 pt-4">{children}</div>
    </div>
  );
}
