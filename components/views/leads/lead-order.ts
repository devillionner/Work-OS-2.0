import type { LeadList } from './client';

type LeadRow = LeadList['leads'][number];

export type LeadOrder = 'newest' | 'oldest';

export const ORDER_KEY = 'work-os:leads-order';

export const ORDER_LABEL: Record<LeadOrder, string> = { newest: 'Новіші спершу', oldest: 'Старіші спершу' };

export function readOrder(): LeadOrder {
  try { return window.localStorage.getItem(ORDER_KEY) === 'oldest' ? 'oldest' : 'newest'; } catch { return 'newest'; }
}

export function writeOrder(order: LeadOrder) {
  try { window.localStorage.setItem(ORDER_KEY, order); } catch { /* порядок діє до перезавантаження */ }
}

/**
 * Порядок за давністю — за тією самою датою відгуку (`responseDate`), з якої картка рахує «N дн. тому».
 * Ліди без дати завжди в кінці; при однаковій даті — за іменем, потім за id, тож порядок стабільний.
 */
export function compareByRecency(order: LeadOrder) {
  const direction = order === 'newest' ? -1 : 1;
  return (a: LeadRow, b: LeadRow): number => {
    if (a.responseDate !== b.responseDate) {
      if (!a.responseDate) return 1;
      if (!b.responseDate) return -1;
      return (a.responseDate < b.responseDate ? -1 : 1) * direction;
    }
    return a.name.localeCompare(b.name, 'uk') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  };
}

export function sortByRecency(leads: readonly LeadRow[], order: LeadOrder): LeadRow[] {
  return [...leads].sort(compareByRecency(order));
}
