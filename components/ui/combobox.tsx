'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronDown, Plus, X } from 'lucide-react';
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
const CREATE_PREFIX = '__create:';

export function SearchSelect({ id, options, value, onChange, onCreate, createLabel = 'Створити', placeholder = 'Вибрати', searchPlaceholder = 'Пошук', emptyText = 'Нічого не знайдено', disabled, limit = 50, className, 'aria-label': ariaLabel }: {
  id?: string;
  options: readonly SearchOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  /** Нове значення з поля пошуку: «Створити «…»». Батько вносить його в список і обирає. */
  onCreate?: (name: string) => void;
  createLabel?: string;
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
  const typed = query.trim();
  const canCreate = Boolean(onCreate && typed && !options.some((option) => fold(option.label) === fold(typed)));
  const shown = useMemo(() => {
    const list = filterOptions(options, query, limit);
    return canCreate ? [...list, { value: `${CREATE_PREFIX}${typed}`, label: `${createLabel} «${typed}»` }] : list;
  }, [options, query, limit, canCreate, typed, createLabel]);
  return (
    <span className="relative inline-flex w-full min-w-0">
      <ComboboxPrimitive.Root
        items={shown}
        filter={null}
        value={selected}
        disabled={disabled}
        inputValue={query}
        onInputValueChange={(next) => setQuery(next)}
        onValueChange={(next) => {
          const picked = next as SearchOption | null;
          if (picked?.value.startsWith(CREATE_PREFIX)) { onCreate?.(picked.value.slice(CREATE_PREFIX.length)); return; }
          onChange(picked ? picked.value : null);
        }}
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
                {(option: SearchOption) => option.value.startsWith(CREATE_PREFIX) ? (
                  <ComboboxPrimitive.Item key={option.value} value={option} className="flex min-h-10 cursor-pointer select-none items-center gap-2 rounded-field px-3 py-1.5 text-sm text-ink outline-none data-[highlighted]:bg-raised">
                    <Plus aria-hidden="true" strokeWidth={1.5} className="size-4 shrink-0 text-ink-2" /><span className="truncate">{option.label}</span>
                  </ComboboxPrimitive.Item>
                ) : (
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

/**
 * Випадний список із множинним вибором, пошуком і створенням нового значення прямо з поля («Створити «…»»). Вибране
 * показується чіпами під полем із «×»; саме поле лишається кнопкою «Додати…». Нові значення додає батько через `onCreate`
 * (він же вирішує, чи вносити їх у довідник).
 */
export function MultiSelect({ id, options, values, onChange, onCreate, placeholder = 'Додати', searchPlaceholder = 'Пошук', emptyText = 'Нічого не знайдено', createLabel = 'Створити', disabled, limit = 50, 'aria-label': ariaLabel }: {
  id?: string;
  options: readonly SearchOption[];
  values: readonly string[];
  onChange: (values: string[]) => void;
  onCreate?: (name: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  createLabel?: string;
  disabled?: boolean;
  limit?: number;
  'aria-label'?: string;
}) {
  const [query, setQuery] = useState('');
  const chosen = values.map((value) => options.find((option) => option.value === value) ?? { value, label: value });
  const typed = query.trim();
  const canCreate = Boolean(onCreate && typed && !options.some((option) => fold(option.label) === fold(typed)));
  const shown = useMemo(() => {
    const list = filterOptions(options, query, limit);
    return canCreate ? [...list, { value: `${CREATE_PREFIX}${typed}`, label: `${createLabel} «${typed}»` }] : list;
  }, [options, query, limit, canCreate, typed, createLabel]);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="relative inline-flex w-full min-w-0">
        <ComboboxPrimitive.Root
          multiple
          items={shown}
          filter={null}
          value={chosen}
          disabled={disabled}
          inputValue={query}
          onInputValueChange={(next) => setQuery(next)}
          onValueChange={(next) => {
            const picked = next as SearchOption[];
            const created = picked.find((option) => option.value.startsWith(CREATE_PREFIX));
            const kept = picked.filter((option) => !option.value.startsWith(CREATE_PREFIX)).map((option) => option.value);
            // Нове значення одразу стає вибраним (одним оновленням), а батько лише вносить його в список варіантів.
            if (created) { const name = created.value.slice(CREATE_PREFIX.length); onCreate?.(name); setQuery(''); onChange([...kept, name]); return; }
            onChange(kept);
          }}
          onOpenChange={(open) => { if (!open) setQuery(''); }}
          itemToStringLabel={(option: SearchOption) => option.label}
          isItemEqualToValue={(a: SearchOption, b: SearchOption) => a.value === b.value}
          modal={false}
        >
          <ComboboxPrimitive.Trigger
            id={id}
            aria-label={ariaLabel}
            data-slot="select"
            className={cn(fieldClassName, 'flex h-10 [@media(pointer:coarse)]:h-11 cursor-pointer items-center justify-between gap-2 rounded-full pl-4 pr-3 text-left text-ink-2 data-[popup-open]:border-line-strong')}
          >
            <span className="min-w-0 truncate">{placeholder}</span>
            <ChevronDown aria-hidden="true" strokeWidth={1.5} className="size-4 shrink-0" />
          </ComboboxPrimitive.Trigger>
          <ComboboxPrimitive.Portal>
            <ComboboxPrimitive.Positioner sideOffset={6} className="z-[80] outline-none">
              <ComboboxPrimitive.Popup className="glass-strong frost shadow-float flex max-h-[min(380px,var(--available-height))] min-w-[var(--anchor-width)] max-w-[min(520px,calc(100vw-1.5rem))] origin-[var(--transform-origin)] flex-col gap-1.5 overflow-hidden rounded-inner p-1.5 outline-none transition-[opacity,scale] duration-150 data-[ending-style]:scale-95 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0">
                <ComboboxPrimitive.Input placeholder={searchPlaceholder} aria-label={searchPlaceholder} className={cn(fieldClassName, 'h-9 [@media(pointer:coarse)]:h-11 shrink-0 rounded-full px-4')} />
                <ComboboxPrimitive.Empty className="m-0 px-3 py-4 text-center text-[13px] text-ink-2 empty:hidden">{emptyText}</ComboboxPrimitive.Empty>
                <ComboboxPrimitive.List className="scroll-soft min-h-0 flex-1 overflow-y-auto overscroll-contain outline-none">
                  {(option: SearchOption) => option.value.startsWith(CREATE_PREFIX) ? (
                    <ComboboxPrimitive.Item key={option.value} value={option} className="flex min-h-10 cursor-pointer select-none items-center gap-2 rounded-field px-3 py-1.5 text-sm text-ink outline-none data-[highlighted]:bg-raised">
                      <Plus aria-hidden="true" strokeWidth={1.5} className="size-4 shrink-0 text-ink-2" /><span className="truncate">{option.label}</span>
                    </ComboboxPrimitive.Item>
                  ) : (
                    <ComboboxPrimitive.Item key={option.value} value={option} className="flex min-h-10 cursor-pointer select-none items-center justify-between gap-3 rounded-field px-3 py-1.5 text-sm text-ink outline-none data-[highlighted]:bg-raised">
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
      {chosen.length ? (
        <ul aria-label="Вибрано" className="m-0 flex list-none flex-wrap gap-1.5 p-0">
          {chosen.map((option) => (
            <li key={option.value} className="inline-flex h-7 max-w-full items-center gap-1 rounded-full border border-line bg-sunken pl-3 pr-1 text-[13px]">
              <span className="min-w-0 truncate">{option.label}</span>
              <button type="button" disabled={disabled} aria-label={`Прибрати ${option.label}`} onClick={() => onChange(values.filter((value) => value !== option.value))} className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-raised hover:text-ink [@media(pointer:coarse)]:size-7"><X aria-hidden="true" strokeWidth={1.5} className="size-3.5" /></button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
