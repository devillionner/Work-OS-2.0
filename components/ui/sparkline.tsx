import { cn } from '@/lib/utils';

/** Мініатюрна лінія тренду; лише --ink, без заливок. */
export function Sparkline({ values, width = 96, height = 28, className }: { values: readonly number[]; width?: number; height?: number; className?: string }) {
  if (values.length < 2) return <span aria-hidden="true" className={cn('inline-block', className)} style={{ width, height }} />;
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const step = width / (values.length - 1);
  const points = values.map((value, index) => `${(index * step).toFixed(1)},${(height - 2 - ((value - min) / span) * (height - 4)).toFixed(1)}`).join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={cn('text-ink', className)} aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
