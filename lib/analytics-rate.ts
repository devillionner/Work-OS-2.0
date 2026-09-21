export function analyticsPercentLabel(value: number, denominator: number): string {
  if (denominator <= 0) return '—';
  return `${value.toLocaleString('uk-UA', { maximumFractionDigits: 1 })}%`;
}
