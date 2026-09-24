export function isD1DailyRowReadLimit(error: unknown): boolean {
  return /exceeded D1(?:'s)? free tier daily row read limit/i.test(errorChainText(error))
    || /D1[^\n]{0,160}(?:daily|free tier)[^\n]{0,160}(?:row read|rows read|read limit)/i.test(errorChainText(error));
}

function errorChainText(error: unknown): string {
  if (error instanceof Error) {
    const cause = 'cause' in error ? (error as Error & { cause?: unknown }).cause : undefined;
    return `${error.name}: ${error.message}${cause ? ` | ${errorChainText(cause)}` : ''}`;
  }
  return typeof error === 'string' ? error : String(error ?? '');
}
