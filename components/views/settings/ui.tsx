import type { ReactNode } from 'react';
import { Surface } from '@/components/ui/surface';
import { cn } from '@/lib/utils';

/** Група налаштувань у стилі системних: заголовок над скляним списком рядків. */
export function Group({ id, title, note, aside, children, tone }: { id: string; title: string; note?: ReactNode; aside?: ReactNode; children: ReactNode; tone?: 'danger' }) {
  return (
    <section id={`settings-${id}`} aria-labelledby={`settings-${id}-title`} data-reveal className="scroll-mt-4">
      <header className="mb-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-1 px-1">
        <div className="min-w-0">
          <h2 id={`settings-${id}-title`} className={cn('m-0 text-[17px] font-medium', tone === 'danger' && 'text-hot')}>{title}</h2>
          {note ? <p className="m-0 mt-0.5 text-[13px] text-ink-2">{note}</p> : null}
        </div>
        {aside}
      </header>
      <Surface as="ul" variant="glass" radius="card" className={cn('m-0 list-none overflow-hidden p-0', tone === 'danger' && 'border-hot/40')}>
        {children}
      </Surface>
    </section>
  );
}

/** Рядок групи: підпис з поясненням ліворуч, керування праворуч; на вузькому екрані керування переходить під текст. */
export function Row({ label, description, children, stacked = false }: { label: ReactNode; description?: ReactNode; children?: ReactNode; stacked?: boolean }) {
  return (
    <li className={cn('flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 border-t border-line px-5 py-3.5 first:border-t-0', stacked && 'items-start')}>
      <div className="min-w-0 flex-1 basis-[15rem]">
        <p className="m-0 text-sm font-medium">{label}</p>
        {description ? <p className="m-0 mt-0.5 max-w-[60ch] text-[13px] text-ink-2">{description}</p> : null}
      </div>
      {children ? <div className="flex min-w-0 max-w-full shrink-0 flex-wrap items-center gap-2">{children}</div> : null}
    </li>
  );
}

/** Рядок із довільним вмістом на всю ширину групи. */
export function Block({ children, className }: { children: ReactNode; className?: string }) {
  return <li className={cn('border-t border-line px-5 py-4 first:border-t-0', className)}>{children}</li>;
}
