'use client';

import { useSyncExternalStore } from 'react';

export type AtmospherePreset = 'fog' | 'coast' | 'forest' | 'road' | 'rays' | 'depth' | 'aurora' | 'mercury' | 'steel' | 'photo';
export type Density = 'comfortable' | 'compact';

export const ATMOSPHERE_KEY = 'work-os:atmosphere';
export const DENSITY_KEY = 'work-os:density';
// Ключ колишнього перемикача тем: теми більше немає, збережене значення ігноруємо й прибираємо.
const LEGACY_THEME_KEY = 'work-os:theme';

type AppearanceSnapshot = { atmosphere: AtmospherePreset; density: Density };

const ATMOSPHERES = ['fog', 'coast', 'forest', 'road', 'rays', 'depth', 'aurora', 'mercury', 'steel', 'photo'] as const;
const DENSITIES = ['comfortable', 'compact'] as const;
const SERVER_SNAPSHOT: AppearanceSnapshot = { atmosphere: 'fog', density: 'comfortable' };

let snapshot: AppearanceSnapshot | null = null;
const listeners = new Set<() => void>();

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

function applyToDocument(next: AppearanceSnapshot) {
  const root = document.documentElement;
  root.dataset.atmosphere = next.atmosphere === 'photo' ? 'fog' : next.atmosphere;
  root.dataset.atmospherePhoto = next.atmosphere === 'photo' ? '1' : '0';
  root.dataset.density = next.density;
}

function getSnapshot(): AppearanceSnapshot {
  if (snapshot) return snapshot;
  try { window.localStorage.removeItem(LEGACY_THEME_KEY); } catch { /* сховище недоступне */ }
  snapshot = {
    atmosphere: read<AtmospherePreset>(ATMOSPHERE_KEY, ATMOSPHERES, 'fog'),
    density: read<Density>(DENSITY_KEY, DENSITIES, 'comfortable'),
  };
  return snapshot;
}

function commit(next: AppearanceSnapshot) {
  snapshot = next;
  applyToDocument(next);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
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
  return { ...state, setAtmosphere, setDensity };
}

/** Інлайн-скрипт для <head>: виставляє атмосферу й щільність до гідрації, без мигання; тема одна («Ніч»). */
export const THEME_BOOT_SCRIPT = `(function(){try{var d=document.documentElement,s=localStorage,a=s.getItem('${ATMOSPHERE_KEY}')||'fog';d.dataset.atmosphere=a==='photo'?'fog':a;d.dataset.atmospherePhoto=a==='photo'?'1':'0';d.dataset.density=s.getItem('${DENSITY_KEY}')||'comfortable';s.removeItem('${LEGACY_THEME_KEY}')}catch(e){}})()`;
