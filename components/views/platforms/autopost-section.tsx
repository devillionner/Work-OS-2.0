import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Заголовок блоку в картці автопосту: один розмір і вага для «Що піде в чати», «Потребують рішення», «Обери гілку», «Запуск» на всіх платформах.
 * Лічильник тихий (прозорістю, а не жирністю), справа — необов'язкова дія блоку.
 */
export function AutopostSectionTitle({ children, count, action, id, className }: { children: ReactNode; count?: number; action?: ReactNode; id?: string; className?: string }) {
  return (
    <div className={cn('flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-2', className)}>
      <h3 id={id} className="m-0 text-sm font-medium">
        {children}
        {count !== undefined ? <span className="ml-1.5 font-normal tabular-nums text-ink-3">{count}</span> : null}
      </h3>
      {action}
    </div>
  );
}
