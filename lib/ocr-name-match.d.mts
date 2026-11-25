export const OCR_MATCH_THRESHOLD: number;
export const OCR_MIN_NAME_LENGTH: number;
export function nameSkeleton(value: string, options?: { fixDigits?: boolean }): string;
export function nameFromOcr(text: string, lines?: number): string;
export function scoreOcrName(expected: string, observed: string, lines?: number): { score: number; read: string; truncated: boolean; short: boolean };
export function bestOcrMatch(
  expected: string,
  texts: { text?: string; lang?: string; inverted?: boolean }[],
  options?: { lines?: number },
): { score: number; observed: string; lang: string; inverted: boolean; truncated: boolean; short: boolean; matched: boolean };
export function observedFromOcr(texts: { text?: string; lang?: string; inverted?: boolean }[], lines?: number): string;
