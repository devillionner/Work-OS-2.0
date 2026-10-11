import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Підпис над полем: регістр як у реченні, підказка й помилка під ним. */
export function Field({ label, hint, error, htmlFor, className, children }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; htmlFor?: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-ink-2">{label}</label>
      {children}
      {error ? <p role="alert" className="m-0 text-xs text-hot">{error}</p> : hint ? <p className="m-0 text-xs text-ink-2">{hint}</p> : null}
    </div>
  );
}
