'use client';

import { Check, ChevronDown } from 'lucide-react';
import { Children, Fragment, isValidElement, type ChangeEvent, type ReactNode } from 'react';
import { Select as SelectPrimitive } from '@base-ui/react/select';
import { fieldClassName } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type OptionValue = string | number | readonly string[] | undefined;
type Option = { value: string; label: ReactNode; disabled: boolean };

type SelectProps = {
  id?: string;
  name?: string;
  value?: OptionValue;
  defaultValue?: OptionValue;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  wrapperClassName?: string;
  children?: ReactNode;
  onChange?: (event: ChangeEvent<HTMLSelectElement>) => void;
  'aria-label'?: string;
};

/** Збирає `<option>` з children, заходячи у фрагменти й вкладені масиви. `<optgroup>` не підтримується. */
function collectOptions(children: ReactNode, into: Option[]) {
  Children.forEach(children, (child) => {
    if (!isValidElement<{ value?: OptionValue; children?: ReactNode; disabled?: boolean }>(child)) return;
    if (child.type === Fragment) { collectOptions(child.props.children, into); return; }
    if (child.type !== 'option') return;
    const value = String(child.props.value ?? child.props.children ?? '');
    into.push({ value, label: child.props.children ?? value, disabled: Boolean(child.props.disabled) });
  });
}

/**
 * Список вибору в стилі системи. API як у нативного `<select>` (children — `<option>`,
 * `onChange(event.target.value)`), але спливне вікно — скляне меню Work OS, а не системне.
 * Подія в `onChange` має лише `target.value` і `target.name`: інших полів події немає.
 * Як і в нативного, значення поза списком показує першу опцію без виклику `onChange`.
 */
export function Select({ id, name, value, defaultValue, disabled, required, className, wrapperClassName, children, onChange, 'aria-label': ariaLabel }: SelectProps) {
  const options: Option[] = [];
  collectOptions(children, options);
  const items = options.map((option) => ({ value: option.value, label: option.label }));
  const first = options[0]?.value ?? null;
  const known = (candidate: string) => options.some((option) => option.value === candidate);
  const controlled = value !== undefined;
  const shown = controlled ? (known(String(value)) ? String(value) : first) : undefined;
  const initial = defaultValue === undefined ? first : known(String(defaultValue)) ? String(defaultValue) : first;

  return (
    <span className={cn('relative inline-flex w-full min-w-0', wrapperClassName)}>
      <SelectPrimitive.Root
        name={name}
        items={items}
        disabled={disabled}
        required={required}
        modal={false}
        {...(controlled ? { value: shown } : { defaultValue: initial })}
        onValueChange={(next) => {
          if (next == null) return;
          const target = { value: String(next), name } as HTMLSelectElement;
          onChange?.({ target, currentTarget: target } as ChangeEvent<HTMLSelectElement>);
        }}
      >
        <SelectPrimitive.Trigger
          id={id}
          aria-label={ariaLabel}
          data-slot="select"
          className={cn(fieldClassName, 'flex h-10 cursor-pointer items-center justify-between gap-2 rounded-full pl-4 pr-3 text-left data-[popup-open]:border-line-strong', className)}
        >
          <SelectPrimitive.Value className="min-w-0 truncate" />
          <SelectPrimitive.Icon className="flex shrink-0 text-ink-2 transition-transform duration-150 data-[popup-open]:rotate-180">
            <ChevronDown aria-hidden="true" strokeWidth={1.5} className="size-4" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Positioner sideOffset={6} alignItemWithTrigger={false} className="z-[80] outline-none">
            <SelectPrimitive.Popup className="glass-strong frost shadow-float scroll-soft max-h-[min(320px,var(--available-height))] min-w-[var(--anchor-width)] origin-[var(--transform-origin)] overflow-y-auto rounded-inner p-1.5 outline-none transition-[opacity,scale] duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
              {options.map((option) => (
                <SelectPrimitive.Item
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  className="flex min-h-9 cursor-pointer select-none items-center justify-between gap-3 rounded-field px-3 text-sm text-ink outline-none data-[disabled]:cursor-not-allowed data-[highlighted]:bg-raised data-[disabled]:opacity-45 data-[selected]:font-medium [@media(pointer:coarse)]:min-h-11"
                >
                  <SelectPrimitive.ItemText className="min-w-0 truncate">{option.label}</SelectPrimitive.ItemText>
                  <SelectPrimitive.ItemIndicator className="flex shrink-0 text-ink-2"><Check aria-hidden="true" strokeWidth={1.5} className="size-4" /></SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Popup>
          </SelectPrimitive.Positioner>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
    </span>
  );
}
