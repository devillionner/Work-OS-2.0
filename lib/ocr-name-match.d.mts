export const OCR_MATCH_THRESHOLD: number;
export const OCR_MIN_NAME_LENGTH: number;
type OcrText = { text?: string; lang?: string; inverted?: boolean };
export function nameSkeleton(value: string, options?: { fixDigits?: boolean; dropGluedDigits?: boolean }): string;
export function nameFromOcr(text: string, lines?: number): string;
export function scoreOcrName(expected: string, observed: string, lines?: number): { score: number; read: string; truncated: boolean; short: boolean };
export function bestOcrMatch(
  expected: string,
  texts: OcrText[],
  options?: { lines?: number },
): { score: number; observed: string; lang: string; inverted: boolean; truncated: boolean; short: boolean; matched: boolean };
export function observedFromOcr(texts: OcrText[], lines?: number): string;
export function wordCoverMatch(expected: string, texts: OcrText[]): { matched: boolean; coverage: number; words: number; prefix?: boolean };
export function ocrNameForeignWords(expected: string, texts: OcrText[], options?: { substitution?: boolean }): { conflict: boolean; foreign: string[] };
export function ocrNameConflict(expected: string, texts: OcrText[]): boolean;
export function joinDialogMatch(
  expected: string,
  lines: OcrText[],
): { matched: boolean; how: string; score: number; coverage: number; conflict: boolean; observed: string };
