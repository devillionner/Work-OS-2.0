'use client';

import { useSyncExternalStore } from 'react';

export type Theme = 'night' | 'metal' | 'cobalt';
export type AtmospherePreset = 'fog' | 'coast' | 'forest' | 'road' | 'photo';
export type Density = 'comfortable' | 'compact';

export const THEME_KEY = 'work-os:theme';
export const ATMOSPHERE_KEY = 'work-os:atmosphere';
export const DENSITY_KEY = 'work-os:density';

export const THEMES: ReadonlyArray<{ value: Theme; label: string }> = [
  { value: 'night', label: 'Ніч' },
  { value: 'metal', label: 'Металік' },
  { value: 'cobalt', label: 'Металік синій' },
];

type ThemeSnapshot = { theme: Theme; atmosphere: AtmospherePreset; density: Density };

const THEME_IDS = ['night', 'metal', 'cobalt'] as const;
const ATMOSPHERES = ['fog', 'coast', 'forest', 'road', 'photo'] as const;
const DENSITIES = ['comfortable', 'compact'] as const;
// Дзеркалять --field кожної теми: мета-тег theme-color не вміє читати CSS-змінні.
const THEME_COLORS: Record<Theme, string> = { night: '#07080A', metal: '#AAB2BC', cobalt: '#05052E' };
const SERVER_SNAPSHOT: ThemeSnapshot = { theme: 'night', atmosphere: 'fog', density: 'comfortable' };

let snapshot: ThemeSnapshot | null = null;
const listeners = new Set<() => void>();

// Збережені раніше «day» і «system» не входять у список, тож тихо мігрують на «Ніч».
function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    return allowed.includes(value as T) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* сховище недоступне — налаштування діє до перезавантаження */ }
}

function applyToDocument(next: ThemeSnapshot) {
  const root = document.documentElement;
  root.dataset.theme = next.theme;
  root.dataset.atmosphere = next.atmosphere === 'photo' ? 'fog' : next.atmosphere;
  root.dataset.atmospherePhoto = next.atmosphere === 'photo' ? '1' : '0';
  root.dataset.density = next.density;
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.setAttribute('content', THEME_COLORS[next.theme]));
}

function getSnapshot(): ThemeSnapshot {
  if (snapshot) return snapshot;
  snapshot = {
    theme: read<Theme>(THEME_KEY, THEME_IDS, 'night'),
    atmosphere: read<AtmospherePreset>(ATMOSPHERE_KEY, ATMOSPHERES, 'fog'),
    density: read<Density>(DENSITY_KEY, DENSITIES, 'comfortable'),
  };
  return snapshot;
}

function commit(next: ThemeSnapshot) {
  snapshot = next;
  applyToDocument(next);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function setTheme(theme: Theme) {
  write(THEME_KEY, theme);
  commit({ ...getSnapshot(), theme });
}

export function setAtmosphere(atmosphere: AtmospherePreset) {
  write(ATMOSPHERE_KEY, atmosphere);
  commit({ ...getSnapshot(), atmosphere });
}

export function setDensity(density: Density) {
  write(DENSITY_KEY, density);
  commit({ ...getSnapshot(), density });
}

export function useTheme() {
  const state = useSyncExternalStore(subscribe, getSnapshot, () => SERVER_SNAPSHOT);
  return { ...state, setTheme, setAtmosphere, setDensity };
}

/** Інлайн-скрипт для <head>: виставляє тему й атмосферу до гідрації, без мигання. */
export const THEME_BOOT_SCRIPT = `(function(){try{var d=document.documentElement,s=localStorage,t=s.getItem('${THEME_KEY}'),a=s.getItem('${ATMOSPHERE_KEY}')||'fog',c={night:'${THEME_COLORS.night}',metal:'${THEME_COLORS.metal}',cobalt:'${THEME_COLORS.cobalt}'};if(t!=='metal'&&t!=='cobalt')t='night';d.dataset.theme=t;d.dataset.atmosphere=a==='photo'?'fog':a;d.dataset.atmospherePhoto=a==='photo'?'1':'0';d.dataset.density=s.getItem('${DENSITY_KEY}')||'comfortable';document.querySelectorAll('meta[name="theme-color"]').forEach(function(m){m.setAttribute('content',c[t])})}catch(e){document.documentElement.dataset.theme='night'}})()`;
