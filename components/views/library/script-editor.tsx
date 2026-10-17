'use client';

import { Fragment, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Braces } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { SCRIPT_FIELDS, insertField, parseScript, type ScriptFieldKey } from '@/lib/script-fields';
import { cn } from '@/lib/utils';

const CHIP = 'rounded-[5px] bg-raised';

/**
 * Текст скрипту з підсвіченими полями для перегляду: поля стають чіпами (`[учень]`), невідомі позначки в дужках
 * підкреслені пунктиром. `fill` дозволяє підмінити поле вмістом (вкладка «Скрипти» ліда).
 */
export function ScriptText({ text, className, fill }: { text: string; className?: string; fill?: (field: ScriptFieldKey, token: string, index: number) => ReactNode }) {
  return (
    <p className={cn('m-0 whitespace-pre-wrap break-words', className)}>
      {parseScript(text).map((part, index) => {
        if (part.kind === 'text') return <Fragment key={index}>{part.text}</Fragment>;
        if (part.kind === 'unknown') return <span key={index} className="underline decoration-dashed decoration-warn underline-offset-4" title="Невідома позначка: перетвори її на поле">{part.token}</span>;
        const filled = fill?.(part.field, part.token, index);
        return <Fragment key={index}>{filled ?? <span className={cn(CHIP, 'px-1 text-ink')}>{part.token}</span>}</Fragment>;
      })}
    </p>
  );
}

/** Меню «Вставити поле» для редактора скрипту. */
export function InsertFieldMenu({ disabled, onPick }: { disabled?: boolean; onPick: (key: ScriptFieldKey) => void }) {
  return (
    <Menu>
      <MenuTrigger render={<Button variant="outline" size="sm" disabled={disabled} />}><Braces aria-hidden="true" strokeWidth={1.5} />Вставити поле</MenuTrigger>
      <MenuContent align="start">
        {SCRIPT_FIELDS.map((field) => (
          <MenuItem key={field.key} onClick={() => onPick(field.key)}>
            <span className="flex min-w-0 flex-col"><span className="truncate">{field.label}</span><span className="truncate font-mono text-[11px] text-ink-2">{field.token}</span></span>
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

/**
 * Поле тексту скрипту: звичайний textarea, під яким той самий текст малюється з підсвіченими полями (прозорий текст
 * поверх «дзеркала»). Висота росте за текстом, тож прокручувати нічого, а дзеркало збігається з рядками.
 */
export function ScriptTextEditor({ id, value, onChange, disabled, placeholder, rows = 7, inserter }: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  rows?: number;
  /** Отримує функцію вставки поля в позицію курсора: батько кладе її на кнопку «Вставити поле». */
  inserter?: (insert: (key: ScriptFieldKey) => void) => void;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const node = area.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${node.scrollHeight}px`;
  }, [value]);
  const insert = (key: ScriptFieldKey) => {
    const node = area.current;
    const from = node?.selectionStart ?? value.length;
    const to = node?.selectionEnd ?? value.length;
    const next = insertField(value, from, to, key);
    onChange(next.text);
    requestAnimationFrame(() => { node?.focus(); node?.setSelectionRange(next.caret, next.caret); });
  };
  useLayoutEffect(() => { inserter?.(insert); });

  const typography = 'px-4 py-3 text-sm [@media(pointer:coarse)]:text-base leading-relaxed font-sans';
  return (
    <div className={cn('relative min-w-0 rounded-inner border border-line bg-sunken transition-colors duration-200 focus-within:border-line-strong hover:border-line-strong', disabled && 'opacity-60')}>
      <div aria-hidden="true" className={cn('pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words text-ink', typography)}>
        {parseScript(value).map((part, index) => (
          part.kind === 'text' ? <Fragment key={index}>{part.text}</Fragment>
            : part.kind === 'field' ? <mark key={index} className={cn(CHIP, 'text-ink')}>{part.token}</mark>
              : <mark key={index} className="bg-transparent text-ink underline decoration-dashed decoration-warn underline-offset-4">{part.token}</mark>
        ))}
        {'​'}
      </div>
      <textarea
        ref={area}
        id={id}
        rows={rows}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        spellCheck
        onChange={(event) => onChange(event.target.value)}
        className={cn('relative block w-full min-w-0 resize-none overflow-hidden border-0 bg-transparent text-transparent caret-[var(--ink)] outline-none placeholder:text-ink-3', typography)}
      />
    </div>
  );
}
