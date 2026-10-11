'use client';

import { THEMES, useTheme } from '@/components/shell/theme-provider';
import { cn } from '@/lib/utils';

/**
 * Вибір теми: зразок бере токени самої теми через data-theme на власному елементі,
 * тож металевий фініш показаний таким, яким він буде на поверхнях.
 */
export function ThemePicker({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme();
  return (
    <fieldset aria-label="Тема" className={cn('m-0 grid min-w-0 gap-2 border-0 p-0', compact ? 'grid-cols-3' : 'grid-cols-1 sm:grid-cols-3')}>
      {THEMES.map((item) => {
        const active = theme === item.value;
        return (
          <button
            key={item.value}
            type="button"
            aria-pressed={active}
            onClick={() => setTheme(item.value)}
            className={cn('flex min-w-0 items-center gap-3 rounded-inner border p-2 pr-4 text-left text-[13px] font-medium transition-colors duration-200 active:scale-[0.985]', active ? 'border-line-strong bg-raised' : 'border-line hover:bg-raised', compact && 'flex-col items-stretch gap-2 pr-2')}
          >
            <span
              aria-hidden="true"
              data-theme={item.value}
              className={cn('relative block shrink-0 overflow-hidden rounded-field border', compact ? 'h-12 w-full' : 'h-10 w-14')}
              style={{ backgroundColor: 'var(--solid)', backgroundImage: 'var(--surface-finish)', borderColor: 'var(--line-strong)', boxShadow: 'var(--highlight)' }}
            >
              <span className="absolute bottom-1.5 left-1.5 h-1.5 w-5 rounded-full" style={{ background: 'var(--ink)' }} />
              <span className="absolute bottom-1.5 right-1.5 size-1.5 rounded-full" style={{ background: 'var(--action)' }} />
            </span>
            <span className={cn('min-w-0', compact ? 'px-1 pb-0.5 leading-tight' : 'truncate')}>{item.label}</span>
          </button>
        );
      })}
    </fieldset>
  );
}
