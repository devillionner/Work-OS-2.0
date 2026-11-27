'use client';

import { useSyncExternalStore } from 'react';

/** Атмосфера одна — «Аврора», плюс власне фото. Збережені назви прибраних атмосфер (3.24.2) тихо читаються як «Аврора». */
export type AtmospherePreset = 'aurora' | 'photo';
export type Density = 'comfortable' | 'compact';

export const ATMOSPHERE_KEY = 'work-os:atmosphere';
export const DENSITY_KEY = 'work-os:density';
// Ключ колишнього перемикача тем: теми більше немає, збережене значення ігноруємо й прибираємо.
const LEGACY_THEME_KEY = 'work-os:theme';

type AppearanceSnapshot = { atmosphere: AtmospherePreset; density: Density };

const ATMOSPHERES = ['aurora', 'photo'] as const;
const DENSITIES = ['comfortable', 'compact'] as const;
const SERVER_SNAPSHOT: AppearanceSnapshot = { atmosphere: 'aurora', density: 'comfortable' };

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
  root.dataset.atmosphere = next.atmosphere;
  root.dataset.density = next.density;
}

function getSnapshot(): AppearanceSnapshot {
  if (snapshot) return snapshot;
  try {
    const storage = window.localStorage;
    storage.removeItem(LEGACY_THEME_KEY);
    // Прибрана атмосфера («Туман», «Ртуть» тощо) стає «Авророю» мовчки: стара назва просто зникає зі сховища.
    const stored = storage.getItem(ATMOSPHERE_KEY);
    if (stored !== null && !(ATMOSPHERES as readonly string[]).includes(stored)) storage.removeItem(ATMOSPHERE_KEY);
  } catch { /* сховище недоступне */ }
  snapshot = {
    atmosphere: read<AtmospherePreset>(ATMOSPHERE_KEY, ATMOSPHERES, 'aurora'),
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

/** Інлайн-скрипт для <head>: виставляє атмосферу й щільність до гідрації, без мигання; будь-що, крім «photo», — «Аврора». */
export const THEME_BOOT_SCRIPT = `(function(){try{var d=document.documentElement,s=localStorage;d.dataset.atmosphere=s.getItem('${ATMOSPHERE_KEY}')==='photo'?'photo':'aurora';d.dataset.density=s.getItem('${DENSITY_KEY}')||'comfortable';s.removeItem('${LEGACY_THEME_KEY}')}catch(e){}})()`;
