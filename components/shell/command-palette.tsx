'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Command } from 'cmdk';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { CornerDownLeft, Monitor, Moon, Search, Sun } from 'lucide-react';
import { CREATE_ACTIONS } from '@/components/shell/create-menu';
import { emitCommand } from '@/components/shell/command-bus';
import { useSearchItems } from '@/components/shell/search-index';
import { useTheme } from '@/components/shell/theme-provider';
import { VIEWS, type ViewKey } from '@/components/shell/views';
import { Kbd } from '@/components/ui/kbd';
import { unicodeSearchIncludes } from '@/lib/unicode-search';

const DYNAMIC_LIMIT = 8;

/** ⌘K / Ctrl+K: розділи, швидке створення, тема й пошук по вже завантажених на клієнті лідах і чатах. */
export function CommandPalette({ open, onOpenChange, onNavigate }: { open: boolean; onOpenChange: (open: boolean) => void; onNavigate: (view: ViewKey) => void }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-[60] bg-scrim transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <DialogPrimitive.Popup className="glass-strong frost shadow-float fixed left-1/2 top-[12dvh] z-[61] w-[min(640px,calc(100vw-1.5rem))] -translate-x-1/2 overflow-hidden rounded-panel outline-none transition-[opacity,scale] duration-200 data-[ending-style]:scale-[0.98] data-[starting-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:opacity-0">
          <DialogPrimitive.Title className="sr-only">Палітра команд</DialogPrimitive.Title>
          {open ? <PaletteBody onClose={() => onOpenChange(false)} onNavigate={onNavigate} /> : null}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function PaletteBody({ onClose, onNavigate }: { onClose: () => void; onNavigate: (view: ViewKey) => void }) {
  const [query, setQuery] = useState('');
  const { setPreference } = useTheme();
  const indexed = useSearchItems();
  const run = (action: () => void) => () => { onClose(); action(); };

  const views = VIEWS.filter((view) => unicodeSearchIncludes(view.label, query));
  const creates = CREATE_ACTIONS.filter((action) => unicodeSearchIncludes(action.label, query));
  const themes = [
    { key: 'night' as const, label: 'Тема: Ніч', icon: Moon },
    { key: 'day' as const, label: 'Тема: День', icon: Sun },
    { key: 'system' as const, label: 'Тема: Система', icon: Monitor },
  ].filter((item) => unicodeSearchIncludes(item.label, query));

  const dynamic = useMemo(() => {
    if (query.trim().length < 2) return [] as Array<[string, typeof indexed]>;
    const groups = new Map<string, typeof indexed>();
    for (const item of indexed) {
      if (!unicodeSearchIncludes(`${item.label} ${item.hint ?? ''}`, query)) continue;
      const list = (groups.get(item.group) ?? []) as typeof indexed;
      if (list.length < DYNAMIC_LIMIT) groups.set(item.group, [...list, item]);
    }
    return Array.from(groups.entries());
  }, [indexed, query]);

  const empty = !views.length && !creates.length && !themes.length && !dynamic.length;

  return (
    <Command shouldFilter={false} label="Палітра команд" loop>
      <div className="flex items-center gap-3 border-b border-line px-5">
        <Search aria-hidden="true" strokeWidth={1.5} className="size-5 shrink-0 text-ink-2" />
        <Command.Input value={query} onValueChange={setQuery} placeholder="Розділ, дія, лід або чат" className="h-14 min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3" />
        <Kbd>Esc</Kbd>
      </div>
      <Command.List className="max-h-[min(60dvh,460px)] overflow-y-auto overscroll-contain p-2">
        {empty ? <div className="px-4 py-8 text-center text-sm text-ink-2">Нічого не знайдено. Пошук по лідах і чатах працює серед уже відкритих у цьому сеансі.</div> : null}
        {views.length ? <Group heading="Розділи">{views.map((view) => <Row key={view.key} onSelect={run(() => onNavigate(view.key))} icon={<view.icon aria-hidden="true" strokeWidth={1.5} />}>{view.label}</Row>)}</Group> : null}
        {creates.length ? <Group heading="Створити">{creates.map((action) => <Row key={action.key} onSelect={run(() => { if (action.view) onNavigate(action.view); emitCommand(action.command); })} icon={<action.icon aria-hidden="true" strokeWidth={1.5} />}>{action.label}</Row>)}</Group> : null}
        {dynamic.map(([group, items]) => (
          <Group key={group} heading={group}>
            {items.map((item) => <Row key={item.id} onSelect={run(item.run)} hint={item.hint}>{item.label}</Row>)}
          </Group>
        ))}
        {themes.length ? <Group heading="Вигляд">{themes.map((item) => <Row key={item.key} onSelect={run(() => setPreference(item.key))} icon={<item.icon aria-hidden="true" strokeWidth={1.5} />}>{item.label}</Row>)}</Group> : null}
      </Command.List>
    </Command>
  );
}

function Group({ heading, children }: { heading: string; children: ReactNode }) {
  return <Command.Group heading={heading} className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-ink-2">{children}</Command.Group>;
}

function Row({ children, icon, hint, onSelect }: { children: ReactNode; icon?: ReactNode; hint?: string; onSelect: () => void }) {
  return (
    <Command.Item onSelect={onSelect} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-inner px-3 text-sm text-ink data-[selected=true]:bg-raised [&_svg]:size-4 [&_svg]:text-ink-2">
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint ? <span className="max-w-[40%] truncate text-xs text-ink-2">{hint}</span> : null}
      <CornerDownLeft aria-hidden="true" strokeWidth={1.5} className="size-3.5 opacity-0 [[data-selected=true]_&]:opacity-60" />
    </Command.Item>
  );
}
