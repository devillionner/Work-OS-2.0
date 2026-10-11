'use client';

import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import type { AnalyticsOverview } from '@/lib/analytics-overview';
import { SectionCard } from '@/components/views/shared/card';
import type { InsightsData, PreviousWindow } from './types';
import { humanRange, plural } from './types';

const RECOMMENDATION: Record<InsightsData['recommendation']['kind'], { label: string; tone: 'warn' | 'ok' | 'neutral' }> = {
  check_low_efficiency: { label: 'Потребує перевірки', tone: 'warn' },
  consider_more_often: { label: 'Сильний сигнал', tone: 'ok' },
  insufficient_data: { label: 'Недостатньо даних', tone: 'neutral' },
};

function Insight({ lead, children }: { lead: string; children: ReactNode }) {
  return (
    <li className="flex items-baseline gap-4 border-t border-line py-3 first:border-t-0 first:pt-0">
      <span className="w-24 shrink-0 font-mono text-[17px] tracking-[-0.01em]">{lead}</span>
      <p className="m-0 text-sm text-ink-2">{children}</p>
    </li>
  );
}

/** Інсайти: короткі речення з числом на початку, одна наступна дія і деталі архіву. */
export function InsightsCard({ insights, overview, overviewError, bookings, previous, className }: { insights: InsightsData; overview: AnalyticsOverview | null; overviewError: boolean; bookings: number; previous: PreviousWindow | null; className?: string }) {
  const recommendation = RECOMMENDATION[insights.recommendation.kind];
  const goal = overview?.monthlyGoal;
  const delta = previous ? bookings - previous.totals.bookings : null;
  const since = previous ? humanRange(previous.range.from, previous.range.to) : '';
  const bottleneck = overview?.bottleneck;
  return (
    <SectionCard className={className} title="Що важливо зараз">
      {overview && goal ? (
        <ul className="m-0 flex list-none flex-col p-0">
          <Insight lead={`${goal.actual} / ${goal.target}`}>
            {goal.target > 0
              ? `${plural(goal.actual, 'запис', 'записи', 'записів')} у місячному плані. ${goal.remaining > 0 ? `Виконано ${goal.progress}%, ще ${goal.remaining}.` : `Ціль виконано — ${goal.progress}%.`}`
              : 'Місячну ціль ще не задано — додай її в «Налаштування → Цілі дня».'}
          </Insight>
          <Insight lead={delta === null ? '—' : delta > 0 ? `+${delta}` : String(delta)}>
            {delta === null || !previous
              ? 'Порівнюємо записи з попереднім періодом…'
              : delta === 0
                ? `Записи без змін проти ${since} (${bookings}).`
                : `${plural(Math.abs(delta), 'запис', 'записи', 'записів')} ${delta > 0 ? 'більше' : 'менше'}, ніж ${since} (${previous.totals.bookings} → ${bookings}).`}
          </Insight>
          <Insight lead={bottleneck ? `${bottleneck.gap} п.п.` : '—'}>
            {bottleneck
              ? `Найбільший розрив з ціллю: ${bottleneck.label} — ${bottleneck.actual}% при цілі ${bottleneck.target}%.`
              : 'Задані цілі воронки виконані або ще не задані.'}
          </Insight>
        </ul>
      ) : overviewError ? (
        <p className="m-0 text-sm text-ink-2">План і зміна зараз недоступні. Основні показники нижче актуальні.</p>
      ) : (
        <output className="m-0 block text-sm text-ink-2">Звіряємо місячний план і зміну результату…</output>
      )}

      <div className="flex flex-col gap-2 rounded-inner bg-sunken p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-ink-2">Одна наступна дія</span>
          {recommendation.tone === 'neutral' ? <span className="text-xs font-medium text-ink-2">{recommendation.label}</span> : <Badge tone={recommendation.tone}>{recommendation.label}</Badge>}
        </div>
        <h3 className="m-0 text-[15px] font-medium">{insights.recommendation.title}</h3>
        <p className="m-0 text-sm text-ink-2">{insights.recommendation.explanation}</p>
      </div>

      <p className="m-0 text-sm text-ink-2">В архів за період: <span className="font-mono text-ink">{insights.archivedChats}</span></p>
    </SectionCard>
  );
}
