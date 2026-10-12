import type { AtmospherePreset } from '@/components/shell/theme-provider';

export type PresetKey = Exclude<AtmospherePreset, 'photo'>;

/** Пресети атмосфери для вибору: два рядки з підписами; «Власне фото» живе окремо. */
export const PRESET_GROUPS: ReadonlyArray<{ label: string; items: ReadonlyArray<{ key: PresetKey; label: string }> }> = [
  {
    label: 'Природа',
    items: [{ key: 'fog', label: 'Туман' }, { key: 'coast', label: 'Узбережжя' }, { key: 'forest', label: 'Ліс' }, { key: 'road', label: 'Дорога' }],
  },
  {
    label: 'Світло і метал',
    items: [{ key: 'rays', label: 'Промені' }, { key: 'depth', label: 'Глибина' }, { key: 'aurora', label: 'Аврора' }, { key: 'mercury', label: 'Ртуть' }, { key: 'steel', label: 'Синя сталь' }],
  },
];
