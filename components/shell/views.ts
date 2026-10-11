'use client';

import { useSyncExternalStore } from 'react';
import { BarChart3, BookOpenText, FileText, LayoutDashboard, MessageSquareText, Settings, UsersRound, type LucideIcon } from 'lucide-react';

export type ViewKey = 'today' | 'platforms' | 'leads' | 'analytics' | 'reports' | 'library' | 'settings';

export const VIEWS: ReadonlyArray<{ key: ViewKey; label: string; icon: LucideIcon }> = [
  { key: 'today', label: 'Сьогодні', icon: LayoutDashboard },
  { key: 'platforms', label: 'Платформи', icon: MessageSquareText },
  { key: 'leads', label: 'Ліди', icon: UsersRound },
  { key: 'analytics', label: 'Аналітика', icon: BarChart3 },
  { key: 'reports', label: 'Звіти', icon: FileText },
  { key: 'library', label: 'Бібліотека', icon: BookOpenText },
  { key: 'settings', label: 'Налаштування', icon: Settings },
];

export function viewLabel(key: ViewKey): string {
  return VIEWS.find((view) => view.key === key)?.label ?? 'Сьогодні';
}

const STORAGE_KEY = 'work-os:active-view';
const listeners = new Set<() => void>();
let current: ViewKey = 'today';
let loaded = false;

function isViewKey(value: unknown): value is ViewKey {
  return VIEWS.some((view) => view.key === value);
}

function load() {
  if (loaded || typeof window === 'undefined') return;
  loaded = true;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (isViewKey(saved)) current = saved;
  } catch { /* сховище недоступне — стартуємо із «Сьогодні» */ }
}

export function getActiveView(): ViewKey {
  load();
  return current;
}

/** Розділ зберігається в localStorage й відновлюється після перезавантаження та автооновлення. */
export function setActiveView(next: ViewKey) {
  load();
  if (next === current) return;
  current = next;
  try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* ігноруємо */ }
  listeners.forEach((listener) => listener());
}

export function useActiveView(): ViewKey {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getActiveView,
    () => 'today',
  );
}
