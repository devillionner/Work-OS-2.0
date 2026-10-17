/** Картки без збереженого місця (нові) йдуть першими в порядку, який дає сервер; решта — за збереженим порядком. */
export function sortByOrder<T extends { id: string }>(items: readonly T[], order: readonly string[]): T[] {
  const rank = new Map(order.map((id, index) => [id, index]));
  const fresh = items.filter((item) => !rank.has(item.id));
  const known = items.filter((item) => rank.has(item.id)).sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  return [...fresh, ...known];
}

/**
 * Новий збережений порядок після перетягування в показаному списку (відфільтровані картки не видно, але їхні місця
 * зберігаються): показані картки переставляються лише між своїми «слотами».
 */
export function applyReorder(stored: readonly string[], displayed: readonly string[], moved: string, beforeId: string | null): string[] {
  const next = displayed.filter((id) => id !== moved);
  const index = beforeId ? next.indexOf(beforeId) : -1;
  next.splice(index < 0 ? next.length : index, 0, moved);
  const known = new Set(stored);
  const full = [...displayed.filter((id) => !known.has(id)), ...stored];
  const shown = new Set(displayed);
  let cursor = 0;
  return full.map((id) => (shown.has(id) ? next[cursor++] : id));
}
