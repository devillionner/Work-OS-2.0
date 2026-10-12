'use client';

import { useState } from 'react';
import { CalendarCheck, MessagesSquare, Reply, Send, type LucideIcon } from 'lucide-react';
import { CountUp } from '@/components/motion/count-up';
import { useShell } from '@/components/shell/shell-context';
import { Surface } from '@/components/ui/surface';
import { KpiPanel, type Metric } from '@/components/views/today/kpi-panel';
import { goalRatio, toneFor } from '@/components/views/shared/pace';
import type { RingTone } from '@/components/ui/ring';

const BAR: Record<RingTone, string> = { ok: 'var(--signal-ok)', warn: 'var(--signal-warn)', hot: 'var(--signal-hot)', ink: 'var(--ink)', rail: 'var(--ink)' };

function Kpi({ label, value, target, icon: Icon, tone, onOpen }: {
  label: string;
  value: number;
  target: number;
  icon: LucideIcon;
  tone: RingTone;
  onOpen: () => void;
}) {
  const ratio = goalRatio(value, target);
  return (
    <Surface as="button" type="button" lift data-reveal onClick={onOpen} title="Розбивка за платформами" className="flex min-w-0 flex-col gap-1.5 px-4 py-3 text-left">
      <span className="flex items-center justify-between gap-2 text-[13px] text-ink-2">
        {label}
        <Icon aria-hidden="true" strokeWidth={1.5} className="size-4 shrink-0 text-ink-3" />
      </span>
      <span className="flex items-baseline gap-2">
        <CountUp value={value} className="text-[28px] font-normal leading-none tracking-[-0.03em] tabular-nums" />
        {target > 0 ? <span className="font-mono text-sm tabular-nums text-ink-2">/ {target}</span> : null}
      </span>
      <span aria-hidden="true" className="block h-0.5 overflow-hidden rounded-full bg-line">
        {target > 0 ? <span className="block h-full origin-left rounded-full" style={{ transform: `scaleX(${Math.max(0, Math.min(1, ratio))})`, background: BAR[tone], transition: 'transform 0.32s var(--ease-out)' }} /> : null}
      </span>
      {target > 0 ? <progress className="sr-only" aria-label={`${label}: ${value} із ${target}`} max={100} value={Math.round(Math.min(1, ratio) * 100)} /> : null}
    </Surface>
  );
}

/**
 * Компактна KPI-стрічка: число й ціль («0 / 140») та тонка смужка прогресу. Розбивка за платформами — в Inspector плитки,
 * а не окремою таблицею на екрані.
 */
export function KpiStrip() {
  const { snapshot } = useShell();
  const [open, setOpen] = useState<Metric | null>(null);
  const totals = snapshot.platforms.reduce(
    (sum, platform) => ({ publications: sum.publications + platform.publications, joined: sum.joined + platform.joined, responses: sum.responses + platform.responses, bookings: sum.bookings + platform.bookings }),
    { publications: 0, joined: 0, responses: 0, bookings: 0 },
  );
  const publication = snapshot.publicationGoal;
  const booking = snapshot.bookingGoal;
  const chatGoal = snapshot.chatGoal;
  const responseGoal = snapshot.responseGoal;
  return (
    <>
      <section aria-label="Результат сьогодні" className="grid grid-cols-2 gap-3 @4xl:grid-cols-4 @4xl:gap-4">
        <Kpi label="Публікації" value={totals.publications} target={publication.target} icon={Send} tone={toneFor(totals.publications, publication.target)} onOpen={() => setOpen('publications')} />
        <Kpi label="Нові чати" value={totals.joined} target={chatGoal.target} icon={MessagesSquare} tone={toneFor(totals.joined, chatGoal.target)} onOpen={() => setOpen('joined')} />
        <Kpi label="Відгуки" value={totals.responses} target={responseGoal.target} icon={Reply} tone={toneFor(totals.responses, responseGoal.target)} onOpen={() => setOpen('responses')} />
        <Kpi label="Записи" value={totals.bookings} target={booking.target} icon={CalendarCheck} tone={toneFor(totals.bookings, booking.target)} onOpen={() => setOpen('bookings')} />
      </section>
      <KpiPanel metric={open} onClose={() => setOpen(null)} />
    </>
  );
}
