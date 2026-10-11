const CYRILLIC = /[Ѐ-ӿ]/;

/**
 * Людське повідомлення про помилку для UI. Ураховуються лише українські тексти (їх пише сервер чи сам застосунок);
 * сирі англійські винятки браузера («Failed to fetch», «Unexpected end of JSON input») замінюються на `fallback`,
 * а технічні подробиці йдуть лише в консоль розробника.
 */
export function humanError(reason: unknown, fallback: string): string {
  if (reason instanceof Error) {
    if (reason.name === 'AbortError') return fallback;
    if (reason.name !== 'TypeError' && reason.name !== 'SyntaxError' && CYRILLIC.test(reason.message)) return reason.message;
    console.warn('[work-os]', reason);
    if (reason.name === 'TypeError') return 'Немає зв’язку із сервером. Перевір інтернет і спробуй ще раз.';
  }
  return fallback;
}
