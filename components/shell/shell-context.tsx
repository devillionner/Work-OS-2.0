'use client';

import { createContext, useContext } from 'react';
import type { ViewKey } from '@/components/shell/views';
import type { DashboardSnapshot } from '@/lib/dashboard';

export type ShellContextValue = {
  user: { displayName: string; email: string };
  signOutPath: string;
  snapshot: DashboardSnapshot;
  syncRevision: number;
  navigate: (view: ViewKey) => void;
  /** Відкриває ліда в Inspector: розділ «Ліди» + ?lead=… в адресі. */
  openLead: (leadId: string) => void;
  /** Просить перечитати знімок «Сьогодні» (одне звернення до /api/dashboard-bootstrap). */
  refreshSnapshot: () => void;
  openRelease: () => void;
};

const ShellContext = createContext<ShellContextValue | null>(null);

export const ShellProvider = ShellContext.Provider;

export function useShell(): ShellContextValue {
  const value = useContext(ShellContext);
  if (!value) throw new Error('useShell має використовуватись усередині WorkOsShell.');
  return value;
}
