'use client';

import { useLayoutEffect } from 'react';

const STORAGE_KEY = 'work-os:active-view';
const VIEW_LABELS = {
  today: 'Сьогодні',
  platforms: 'Платформи',
  leads: 'Ліди',
  analytics: 'Аналітика',
  reports: 'Звіти',
  library: 'Бібліотека',
  settings: 'Налаштування',
} as const;

type SavedView = keyof typeof VIEW_LABELS;

export function ViewPersistence() {
  useLayoutEffect(() => {
    const observer = new MutationObserver((mutations) => {
      if (!mutations.some((mutation) => mutation.type === 'attributes' && mutation.attributeName === 'aria-current')) return;
      void persistCurrentView();
    });
    observer.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-current'],
    });

    const current = readCurrentView();
    const saved = readSavedView();

    if (saved && saved !== current) {
      const target = findViewButton(saved);
      if (target) void target.click();
    } else if (current) {
      void persistCurrentView();
    }

    return () => observer.disconnect();
  }, []);

  return null;
}

function readSavedView(): SavedView | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value && value in VIEW_LABELS ? value as SavedView : null;
  } catch {
    return null;
  }
}

function persistCurrentView(): void {
  const current = readCurrentView();
  if (!current) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, current);
  } catch {
    // Storage can be unavailable in hardened/private browser modes.
  }
}

function readCurrentView(): SavedView | null {
  const current = document.querySelector<HTMLElement>('.nav-item[aria-current="page"], .mobile-bottom-nav button[aria-current="page"]');
  return current ? viewFromButton(current) : null;
}

function findViewButton(view: SavedView): HTMLButtonElement | null {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.nav-item, .mobile-bottom-nav button'));
  return buttons.find((button) => viewFromButton(button) === view) ?? null;
}

function viewFromButton(button: HTMLElement): SavedView | null {
  const text = `${button.getAttribute('title') || ''} ${button.textContent || ''}`;
  for (const [key, label] of Object.entries(VIEW_LABELS) as Array<[SavedView, string]>) {
    if (text.includes(label)) return key;
  }
  return null;
}
