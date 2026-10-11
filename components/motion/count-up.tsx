'use client';

import { useState } from 'react';
import { useCountUp } from '@/components/motion/use-count-up';

/** Число, що плавно змінюється лише при реальній зміні значення. */
export function CountUp({ value, format, className }: { value: number; format?: (value: number) => string; className?: string }) {
  const [initial] = useState(() => (format ? format(value) : String(value)));
  const ref = useCountUp<HTMLSpanElement>(value, format);
  return <span ref={ref} className={className}>{initial}</span>;
}
