'use client';

import { FilePlus2, MessageSquarePlus, Plus, Search, Timer, UserPlus } from 'lucide-react';
import { emitCommand } from '@/components/shell/command-bus';
import type { ViewKey } from '@/components/shell/views';
import { Button } from '@/components/ui/button';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';

export type CreateAction = { key: string; label: string; icon: typeof Plus; view: ViewKey | null; command: string };

export const CREATE_ACTIONS: ReadonlyArray<CreateAction> = [
  { key: 'lead', label: 'Додати ліда', icon: UserPlus, view: 'leads', command: 'lead:create' },
  { key: 'chats', label: 'Додати чати', icon: MessageSquarePlus, view: 'platforms', command: 'chats:add' },
  { key: 'discover', label: 'Знайти нові чати', icon: Search, view: 'platforms', command: 'chats:discover' },
  { key: 'material', label: 'Новий матеріал', icon: FilePlus2, view: 'library', command: 'library:create' },
  { key: 'timer', label: 'Запустити таймер', icon: Timer, view: null, command: 'timers:open' },
];

/** Швидке створення: pill «+ Створити» в Topbar на ПК, кругла FAB на телефоні. */
export function CreateMenu({ onNavigate, fab = false }: { onNavigate: (view: ViewKey) => void; fab?: boolean }) {
  const run = (action: CreateAction) => {
    if (action.view) onNavigate(action.view);
    emitCommand(action.command);
  };
  return (
    <Menu>
      <MenuTrigger
        render={fab
          ? <Button variant="fab" size="xl" magnetic aria-label="Створити" />
          : <Button variant="action" size="md" magnetic />}
      >
        <Plus aria-hidden="true" strokeWidth={1.5} />
        {fab ? null : 'Створити'}
      </MenuTrigger>
      <MenuContent align="end" side={fab ? 'top' : 'bottom'}>
        {CREATE_ACTIONS.map((action) => (
          <MenuItem key={action.key} onClick={() => run(action)}>
            <action.icon aria-hidden="true" strokeWidth={1.5} />
            {action.label}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}
