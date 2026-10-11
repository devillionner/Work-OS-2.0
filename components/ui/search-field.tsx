'use client';

import { Search, X } from 'lucide-react';
import { useEffect, useRef, type ComponentProps } from 'react';
import { Kbd } from '@/components/ui/kbd';
import { cn } from '@/lib/utils';

type Props = Omit<ComponentProps<'input'>, 'onChange' | 'value'> & {
  value: string;
  onValueChange: (value: string) => void;
  /** «/» фокусує це поле, поки воно видиме. */
  hotkey?: boolean;
  wrapperClassName?: string;
};

export function SearchField({ value, onValueChange, hotkey = true, wrapperClassName, className, placeholder = 'Пошук', ...props }: Props) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!hotkey) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      const node = ref.current;
      if (!node || node.offsetParent === null) return;
      event.preventDefault();
      node.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hotkey]);

  return (
    <label className={cn('relative flex min-w-0 items-center', wrapperClassName)}>
      <Search aria-hidden="true" strokeWidth={1.5} className="pointer-events-none absolute left-4 size-4 text-ink-2" />
      <input
        ref={ref}
        type="search"
        data-slot="input"
        data-search=""
        value={value}
        placeholder={placeholder}
        aria-label={props['aria-label'] ?? placeholder}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Escape' && value) { event.stopPropagation(); onValueChange(''); } }}
        className={cn('h-10 w-full min-w-0 rounded-full border border-line bg-sunken pl-10 pr-12 text-sm text-ink outline-none transition-colors duration-200 placeholder:text-ink-3 hover:border-line-strong focus-visible:border-line-strong [&::-webkit-search-cancel-button]:hidden', className)}
        {...props}
      />
      {value ? (
        <button type="button" aria-label="Очистити пошук" onClick={() => { onValueChange(''); ref.current?.focus(); }} className="absolute right-2.5 inline-flex size-7 items-center justify-center rounded-full text-ink-2 hover:bg-raised hover:text-ink">
          <X aria-hidden="true" strokeWidth={1.5} className="size-3.5" />
        </button>
      ) : hotkey ? <Kbd className="pointer-events-none absolute right-3.5">/</Kbd> : null}
    </label>
  );
}
