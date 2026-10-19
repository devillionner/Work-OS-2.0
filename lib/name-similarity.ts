// Подібність двох назв чату (Work OS і те, що показує месенджер): для дії «Це той самий чат — оновити назву». Спільна для сервера
// (масове оновлення назв лише для схожих) і екрана (скільки чатів піде в масову дію).
export const SIMILAR_NAME_THRESHOLD = 0.5;

function tokens(value: string): Set<string> {
  const loose = String(value || '').normalize('NFC').toLocaleLowerCase('uk-UA')
    .replace(/[\s\-–—([]*(?:(?<![\p{L}\p{N}])(?:в|у|in|на|для|for)\s+)?(?<![\p{L}\p{N}])viber[)\]]*\s*$/iu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return new Set(loose.split(' ').filter((word) => word.length > 1));
}

/** Частка спільних слів серед усіх слів обох назв (0…1); хвіст «в Viber» і знаки не рахуються. */
export function nameSimilarity(left: string, right: string): number {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / (a.size + b.size - shared);
}

export const isSimilarName = (left: string, right: string) => nameSimilarity(left, right) >= SIMILAR_NAME_THRESHOLD;
