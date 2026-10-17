'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Combobox as ComboboxPrimitive } from '@base-ui/react/combobox';
import { fieldClassName } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export type SearchOption = {
  value: string;
  label: string;
  /** Другий рядок під назвою (платформа, стан): показується в списку й бере участь у пошуку. */
  hint?: string;
  /** Додаткові слова для пошуку, які не показуються. */
  keywords?: string;
};

const fold = (value: string) => value.normalize('NFC').toLocaleLowerCase('uk-UA');

/** Усі слова запиту мають зустрітися в назві, підказці чи ключових словах; у списку не більше `limit` рядків. */
function filterOptions(options: readonly SearchOption[], query: string, limit: number): SearchOption[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return options.slice(0, limit);
  const found: SearchOption[] = [];
  for (const option of options) {
    const haystack = fold(`${option.label} ${option.hint ?? ''} ${option.keywords ?? ''}`);
    if (words.every((word) => haystack.includes(word))) found.push(option);
    if (found.length >= limit) break;
  }
  return found;
}

/**
 * Випадний список із пошуком у стилі системи (на примітиві Combobox): кнопка-pill, скляне вікно з полем пошуку над
 * списком. Довгі списки (тисячі чатів) не малюються цілком: показується до `limit` збігів, уточнення — набором слів.
 */
export function SearchSelect({ id, options, value, onChange, placeholder = 'Вибрати', searchPlaceholder = 'Пошук', emptyText = 'Нічого не знайдено', disabled, limit = 50, className, 'aria-label': ariaLabel }: {
  id?: string;
  options: readonly SearchOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  limit?: number;
  className?: string;
  'aria-label'?: string;
}) {
  const [query, setQuery] = useState('');
  const selected = options.find((option) => option.value === value) ?? null;
  const shown = useMemo(() => filterOptions(options, query, limit), [options, query, limit]);
  return (
    <span className="relative inline-flex w-full min-w-0">
      <ComboboxPrimitive.Root
        items={shown}
        filter={null}
        value={selected}
        disabled={disabled}
        inputValue={query}
        onInputValueChange={(next) => setQuery(next)}
        onValueChange={(next) => onChange(next ? (next as SearchOption).value : null)}
        onOpenChange={(open) => { if (!open) setQuery(''); }}
        itemToStringLabel={(option: SearchOption) => option.label}
        isItemEqualToValue={(a: SearchOption, b: SearchOption) => a.value === b.value}
        modal={false}
      >
        <ComboboxPrimitive.Trigger
          id={id}
          aria-label={ariaLabel}
          data-slot="select"
          className={cn(fieldClassName, 'flex h-10 [@media(pointer:coarse)]:h-11 cursor-pointer items-center justify-between gap-2 rounded-full pl-4 pr-3 text-left data-[popup-open]:border-line-strong', className)}
        >
          <span className={cn('min-w-0 truncate', !selected && 'text-ink-3')}>{selected ? selected.label : placeholder}</span>
          <ChevronDown aria-hidden="true" strokeWidth={1.5} className="size-4 shrink-0 text-ink-2" />
        </ComboboxPrimitive.Trigger>
        <ComboboxPrimitive.Portal>
          <ComboboxPrimitive.Positioner sideOffset={6} className="z-[80] outline-none">
            <ComboboxPrimitive.Popup className="glass-strong frost shadow-float flex max-h-[min(380px,var(--available-height))] min-w-[var(--anchor-width)] max-w-[min(520px,calc(100vw-1.5rem))] origin-[var(--transform-origin)] flex-col gap-1.5 overflow-hidden rounded-inner p-1.5 outline-none transition-[opacity,scale] duration-150 data-[ending-style]:scale-95 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0">
              <ComboboxPrimitive.Input placeholder={searchPlaceholder} aria-label={searchPlaceholder} className={cn(fieldClassName, 'h-9 [@media(pointer:coarse)]:h-11 shrink-0 rounded-full px-4')} />
              <ComboboxPrimitive.Empty className="m-0 px-3 py-4 text-center text-[13px] text-ink-2 empty:hidden">{emptyText}</ComboboxPrimitive.Empty>
              <ComboboxPrimitive.List className="scroll-soft min-h-0 flex-1 overflow-y-auto overscroll-contain outline-none">
                {(option: SearchOption) => (
                  <ComboboxPrimitive.Item
                    key={option.value}
                    value={option}
                    className="flex min-h-10 cursor-pointer select-none items-center justify-between gap-3 rounded-field px-3 py-1.5 text-sm text-ink outline-none data-[highlighted]:bg-raised"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{option.label}</span>
                      {option.hint ? <span className="truncate text-xs text-ink-2">{option.hint}</span> : null}
                    </span>
                    <ComboboxPrimitive.ItemIndicator className="flex shrink-0 text-ink-2"><Check aria-hidden="true" strokeWidth={1.5} className="size-4" /></ComboboxPrimitive.ItemIndicator>
                  </ComboboxPrimitive.Item>
                )}
              </ComboboxPrimitive.List>
            </ComboboxPrimitive.Popup>
          </ComboboxPrimitive.Positioner>
        </ComboboxPrimitive.Portal>
      </ComboboxPrimitive.Root>
    </span>
  );
}
