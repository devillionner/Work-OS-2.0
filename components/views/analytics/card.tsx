import { useId, type ReactNode } from 'react';
import { Surface } from '@/components/ui/surface';
import { cn } from '@/lib/utils';

/** Картка розділу аналітики: заголовок 17/500, необов'язкове пояснення й права частина шапки. */
export function AnalyticsCard({ title, note, aside, className, children }: { title: string; note?: ReactNode; aside?: ReactNode; className?: string; children: ReactNode }) {
  const id = useId();
  return (
    <Surface as="section" variant="glass" radius="card" spot data-reveal aria-labelledby={id} className={cn('flex min-w-0 flex-col gap-4 p-5 @4xl:p-6', className)}>
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 id={id} className="m-0 text-[17px] font-medium">{title}</h2>
          {note ? <p className="m-0 mt-1 max-w-[64ch] text-[13px] text-ink-2">{note}</p> : null}
        </div>
        {aside}
      </header>
      {children}
    </Surface>
  );
}

/** Рядок рейтингу з інлайн-смужкою частки: підпис і число зверху, тонка смужка знизу. */
export function BarRow({ label, sub, value, meta, ratio, faint = false }: { label: ReactNode; sub?: ReactNode; value: ReactNode; meta?: ReactNode; ratio: number; faint?: boolean }) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 border-t border-line py-3 first:border-t-0 first:pt-0">
      <div className="min-w-0">
        <p className="m-0 truncate text-sm">{label}</p>
        {sub ? <p className="m-0 mt-0.5 truncate text-xs text-ink-2">{sub}</p> : null}
      </div>
      <div className="text-right">
        <p className="m-0 font-mono text-[15px]">{value}</p>
        {meta ? <p className="m-0 mt-0.5 font-mono text-xs text-ink-2">{meta}</p> : null}
      </div>
      <div aria-hidden="true" className="col-span-2 h-1 overflow-hidden rounded-full bg-line">
        <div className={cn('h-full origin-left rounded-full', faint ? 'bg-ink-3' : 'bg-ink')} style={{ transform: `scaleX(${clamped})`, transition: 'transform 0.6s var(--ease-out)' }} />
      </div>
    </li>
  );
}
