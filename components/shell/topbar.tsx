'use client';

import { useEffect, useRef, useState } from 'react';
import { Command, LogOut, Moon, Sun } from 'lucide-react';
import { CreateMenu } from '@/components/shell/create-menu';
import { LiveOrb } from '@/components/shell/live-orb';
import { useTheme } from '@/components/shell/theme-provider';
import { TimersButton } from '@/components/shell/timers';
import { useLiveStatus } from '@/components/shell/use-live';
import type { ViewKey } from '@/components/shell/views';
import { Avatar, initials } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { cn } from '@/lib/utils';

type Props = {
  title: string;
  phone: boolean;
  user: { displayName: string; email: string };
  signOutPath: string;
  enabledPlatforms: string[];
  viewKey: ViewKey;
  fallbackMinutes: number;
  onNavigate: (view: ViewKey) => void;
  onOpenPalette: () => void;
  slotRef: (element: HTMLElement | null) => void;
};

export function Topbar({ title, phone, user, signOutPath, enabledPlatforms, viewKey, fallbackMinutes, onNavigate, onOpenPalette, slotRef }: Props) {
  const { connected } = useLiveStatus();
  const { resolved, toggle } = useTheme();
  const sentinel = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);

  // На телефоні заголовок стискається в компактний скляний бар, коли контент проскролено.
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !phone) return;
    const observer = new IntersectionObserver(([entry]) => setCompact(!entry.isIntersecting), { threshold: 0 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [phone]);

  const fallback = connected ? null : (
    <span className="whitespace-nowrap text-xs text-ink-2">Оновлення раз на {fallbackMinutes} хв</span>
  );

  const userMenu = (
    <Menu>
      <MenuTrigger render={<button type="button" aria-label="Обліковий запис" className="inline-flex rounded-full active:scale-95" />}>
        {phone ? <LiveOrb size={40}>{initials(user.displayName)}</LiveOrb> : <Avatar name={user.displayName} size={40} />}
      </MenuTrigger>
      <MenuContent align="end">
        <MenuLabel><span className="block text-sm font-medium text-ink">{user.displayName}</span><span className="block text-xs">{user.email}</span></MenuLabel>
        <MenuSeparator />
        <MenuItem onClick={onOpenPalette}><Command aria-hidden="true" strokeWidth={1.5} />Палітра команд</MenuItem>
        <MenuItem onClick={toggle}>{resolved === 'day' ? <Moon aria-hidden="true" strokeWidth={1.5} /> : <Sun aria-hidden="true" strokeWidth={1.5} />}{resolved === 'day' ? 'Тема: Ніч' : 'Тема: День'}</MenuItem>
        <MenuSeparator />
        <MenuItem onClick={() => signOut(signOutPath)}><LogOut aria-hidden="true" strokeWidth={1.5} />Вийти</MenuItem>
      </MenuContent>
    </Menu>
  );

  if (phone) {
    return (
      <>
        <div ref={sentinel} aria-hidden="true" className="h-px" />
        <header className={cn('sticky top-0 z-20 flex items-center justify-between gap-3 px-4 transition-[padding,background-color] duration-200', compact ? 'glass-strong frost h-14' : 'h-[72px] pt-[env(safe-area-inset-top)]')}>
          <div className="min-w-0">
            <h1 className={cn('m-0 truncate font-medium tracking-[-0.03em]', compact ? 'text-[20px]' : 'text-[28px] leading-tight')}>{title}</h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {fallback}
            <TimersButton enabledPlatforms={enabledPlatforms} viewKey={viewKey} />
            {userMenu}
          </div>
        </header>
        <div ref={slotRef} className="flex flex-wrap items-center gap-2 px-4 empty:hidden" />
      </>
    );
  }

  return (
    <header className="flex h-[72px] shrink-0 items-center gap-4 px-6">
      <div className="min-w-0">
        <h1 className="m-0 truncate text-[22px] font-medium leading-tight tracking-[-0.02em]">{title}</h1>
      </div>
      <div ref={slotRef} className="flex min-w-0 flex-1 items-center gap-2 empty:hidden" />
      <div className="ml-auto flex shrink-0 items-center gap-2.5">
        {fallback}
        <TimersButton enabledPlatforms={enabledPlatforms} viewKey={viewKey} />
        <Button variant="outline" size="md" aria-label="Палітра команд" onClick={onOpenPalette}>
          Пошук <Kbd>⌘K</Kbd>
        </Button>
        <CreateMenu onNavigate={onNavigate} />
        {userMenu}
      </div>
    </header>
  );
}

function signOut(path: string) {
  const form = document.createElement('form');
  form.method = 'post';
  form.action = path;
  document.body.appendChild(form);
  form.submit();
}
