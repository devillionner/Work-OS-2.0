'use client';

import { useSyncExternalStore } from 'react';

export type ThemePreference = 'system' | 'night' | 'day';
export type ResolvedTheme = 'night' | 'day';
export type AtmospherePreset = 'fog' | 'coast' | 'forest' | 'road' | 'photo';
export type Density = 'comfortable' | 'compact';

export const THEME_KEY = 'work-os:theme';
export const ATMOSPHERE_KEY = 'work-os:atmosphere';
export const DENSITY_KEY = 'work-os:density';

type ThemeSnapshot = { preference: ThemePreference; resolved: ResolvedTheme; atmosphere: AtmospherePreset; density: Density };

const PREFERENCES = ['system', 'night', 'day'] as const;
const ATMOSPHERES = ['fog', 'coast', 'forest', 'road', 'photo'] as const;
const DENSITIES = ['comfortable', 'compact'] as const;
const NIGHT_COLOR = '#07080A';
const DAY_COLOR = '#E8E8E5';
const SERVER_SNAPSHOT: ThemeSnapshot = { preference: 'system', resolved: 'night', atmosphere: 'fog', density: 'comfortable' };

let snapshot: ThemeSnapshot | null = null;
const listeners = new Set<() => void>();
let mediaQuery: MediaQueryList | null = null;

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

function resolve(preference: ThemePreference): ResolvedTheme {
  if (preference !== 'system') return preference;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'day' : 'night';
}

function applyToDocument(next: ThemeSnapshot) {
  const root = document.documentElement;
  root.dataset.theme = next.resolved;
  root.dataset.themePref = next.preference;
  root.dataset.atmosphere = next.atmosphere === 'photo' ? 'fog' : next.atmosphere;
  root.dataset.atmospherePhoto = next.atmosphere === 'photo' ? '1' : '0';
  root.dataset.density = next.density;
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.setAttribute('content', next.resolved === 'day' ? DAY_COLOR : NIGHT_COLOR));
}

function getSnapshot(): ThemeSnapshot {
  if (snapshot) return snapshot;
  const preference = read<ThemePreference>(THEME_KEY, PREFERENCES, 'system');
  snapshot = {
    preference,
    resolved: resolve(preference),
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

function onSystemChange() {
  const current = getSnapshot();
  if (current.preference === 'system') commit({ ...current, resolved: resolve('system') });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    mediaQuery = window.matchMedia('(prefers-color-scheme: light)');
    mediaQuery.addEventListener('change', onSystemChange);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && mediaQuery) {
      mediaQuery.removeEventListener('change', onSystemChange);
      mediaQuery = null;
    }
  };
}

export function setThemePreference(preference: ThemePreference) {
  write(THEME_KEY, preference);
  commit({ ...getSnapshot(), preference, resolved: resolve(preference) });
}

export function toggleTheme() {
  setThemePreference(getSnapshot().resolved === 'day' ? 'night' : 'day');
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
  return { ...state, setPreference: setThemePreference, toggle: toggleTheme, setAtmosphere, setDensity };
}

/** Інлайн-скрипт для <head>: виставляє тему й атмосферу до гідрації, без мигання. */
export const THEME_BOOT_SCRIPT = `(function(){try{var d=document.documentElement,s=localStorage,t=s.getItem('${THEME_KEY}')||'system',a=s.getItem('${ATMOSPHERE_KEY}')||'fog',r=t==='system'?(matchMedia('(prefers-color-scheme: light)').matches?'day':'night'):t;d.dataset.theme=r==='day'?'day':'night';d.dataset.themePref=t;d.dataset.atmosphere=a==='photo'?'fog':a;d.dataset.atmospherePhoto=a==='photo'?'1':'0';d.dataset.density=s.getItem('${DENSITY_KEY}')||'comfortable'}catch(e){document.documentElement.dataset.theme='night'}})()`;
