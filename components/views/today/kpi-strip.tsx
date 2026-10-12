'use client';

import { useState } from 'react';
import { CalendarCheck, MessagesSquare, Reply, Send, type LucideIcon } from 'lucide-react';
import { CountUp } from '@/components/motion/count-up';
import { emitCommand } from '@/components/shell/command-bus';
import { useShell } from '@/components/shell/shell-context';
import { Surface } from '@/components/ui/surface';
import { KpiPanel, type Metric } from '@/components/views/today/kpi-panel';
import { goalRatio, toneFor } from '@/components/views/shared/pace';
import type { RingTone } from '@/components/ui/ring';

const BAR: Record<RingTone, string> = { ok: 'var(--signal-ok)', warn: 'var(--signal-warn)', hot: 'var(--signal-hot)', ink: 'var(--ink)', rail: 'var(--ink)' };

function Kpi({ label, value, target, icon: Icon, tone, title, onOpen, onBreakdown }: {
  label: string;
  value: number;
  target: number;
  icon: LucideIcon;
  tone: RingTone;
  /** Куди веде клік по плитці. */
  title: string;
  onOpen: () => void;
  onBreakdown: () => void;
}) {
  const ratio = goalRatio(value, target);
  return (
    <Surface lift data-reveal className="relative flex min-w-0 flex-col gap-1.5 px-4 py-3">
      <button type="button" onClick={onOpen} title={title} aria-label={`${label}: ${title}`} className="absolute inset-0 rounded-[inherit]" />
      <span className="pointer-events-none relative flex items-center justify-between gap-2 text-[13px] text-ink-2">
        {label}
        <button type="button" onClick={onBreakdown} title="Розбивка за платформами" aria-label={`${label}: розбивка за платформами`} className="pointer-events-auto -m-1 inline-flex size-8 shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors duration-150 hover:bg-raised hover:text-ink [@media(pointer:coarse)]:size-11">
          <Icon aria-hidden="true" strokeWidth={1.5} className="size-4" />
        </button>
      </span>
      <span className="pointer-events-none relative flex items-baseline gap-2">
        <CountUp value={value} className="text-[28px] font-normal leading-none tracking-[-0.03em] tabular-nums" />
        {target > 0 ? <span className="font-mono text-sm tabular-nums text-ink-2">/ {target}</span> : null}
      </span>
      <span aria-hidden="true" className="pointer-events-none relative block h-0.5 overflow-hidden rounded-full bg-line">
        {target > 0 ? <span className="block h-full origin-left rounded-full" style={{ transform: `scaleX(${Math.max(0, Math.min(1, ratio))})`, background: BAR[tone], transition: 'transform 0.32s var(--ease-out)' }} /> : null}
      </span>
      {target > 0 ? <progress className="sr-only" aria-label={`${label}: ${value} із ${target}`} max={100} value={Math.round(Math.min(1, ratio) * 100)} /> : null}
    </Surface>
  );
}

/**
 * Компактна KPI-стрічка: число й ціль («0 / 140») та тонка смужка прогресу. Клік по плитці веде в потрібну чергу чи розділ;
 * розбивка за платформами відкривається маленькою кнопкою-іконкою в Inspector, а не окремою таблицею на екрані.
 */
export function KpiStrip() {
  const { snapshot, navigate } = useShell();
  const [open, setOpen] = useState<Metric | null>(null);
  const totals = snapshot.platforms.reduce(
    (sum, platform) => ({ publications: sum.publications + platform.publications, joined: sum.joined + platform.joined, responses: sum.responses + platform.responses, bookings: sum.bookings + platform.bookings }),
    { publications: 0, joined: 0, responses: 0, bookings: 0 },
  );
  const publication = snapshot.publicationGoal;
  const booking = snapshot.bookingGoal;
  const chatGoal = snapshot.chatGoal;
  const responseGoal = snapshot.responseGoal;
  const go = (view: 'platforms' | 'leads', queue?: { platform: string; queue: string }) => () => { navigate(view); if (queue) emitCommand('platforms:queue', queue); };
  return (
    <>
      <section aria-label="Результат сьогодні" className="grid grid-cols-2 gap-3 @4xl:grid-cols-4 @4xl:gap-4">
        <Kpi label="Публікації" value={totals.publications} target={publication.target} icon={Send} tone={toneFor(totals.publications, publication.target)} title="Відкрити «Для публікації»" onOpen={go('platforms', { platform: 'telegram', queue: 'ready' })} onBreakdown={() => setOpen('publications')} />
        <Kpi label="Нові чати" value={totals.joined} target={chatGoal.target} icon={MessagesSquare} tone={toneFor(totals.joined, chatGoal.target)} title="Відкрити чергу приєднання" onOpen={go('platforms', { platform: 'telegram', queue: 'to_join' })} onBreakdown={() => setOpen('joined')} />
        <Kpi label="Відгуки" value={totals.responses} target={responseGoal.target} icon={Reply} tone={toneFor(totals.responses, responseGoal.target)} title="Відкрити ліди" onOpen={go('leads')} onBreakdown={() => setOpen('responses')} />
        <Kpi label="Записи" value={totals.bookings} target={booking.target} icon={CalendarCheck} tone={toneFor(totals.bookings, booking.target)} title="Відкрити ліди" onOpen={go('leads')} onBreakdown={() => setOpen('bookings')} />
      </section>
      <KpiPanel metric={open} onClose={() => setOpen(null)} />
    </>
  );
}
