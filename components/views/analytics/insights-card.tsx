'use client';

import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import type { AnalyticsOverview } from '@/lib/analytics-overview';
import { AnalyticsCard } from './card';
import type { InsightsData } from './types';
import { plural } from './types';

const ARCHIVE_REASONS: Record<string, string> = {
  irrelevant: 'Неактуальний чат',
  banned: 'Блокування',
  missing: 'Чат недоступний',
  other: 'Інше',
};

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
export function InsightsCard({ insights, overview, overviewError, className }: { insights: InsightsData; overview: AnalyticsOverview | null; overviewError: boolean; className?: string }) {
  const recommendation = RECOMMENDATION[insights.recommendation.kind];
  const goal = overview?.monthlyGoal;
  const comparison = overview?.comparison;
  const bottleneck = overview?.bottleneck;
  return (
    <AnalyticsCard className={className} title="Що важливо зараз">
      {overview && goal && comparison ? (
        <ul className="m-0 flex list-none flex-col p-0">
          <Insight lead={`${goal.actual} / ${goal.target}`}>
            {goal.target > 0
              ? `${plural(goal.actual, 'запис', 'записи', 'записів')} у місячному плані. ${goal.remaining > 0 ? `Виконано ${goal.progress}%, ще ${goal.remaining}.` : `Ціль виконано — ${goal.progress}%.`}`
              : 'Місячну ціль ще не задано — додай її в «Налаштування → Цілі дня».'}
          </Insight>
          <Insight lead={comparison.delta > 0 ? `+${comparison.delta}` : String(comparison.delta)}>
            {comparison.delta === 0
              ? `Записи без змін проти попереднього рівного періоду (${comparison.bookings}).`
              : `${plural(Math.abs(comparison.delta), 'запис', 'записи', 'записів')} ${comparison.delta > 0 ? 'більше' : 'менше'}, ніж у попередньому рівному періоді (${comparison.previousBookings} → ${comparison.bookings}).`}
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
        <p className="m-0 text-xs text-ink-2">Work OS лише пояснює сигнал. Архівація або зміна частоти завжди лишається ручним рішенням.</p>
      </div>

      <details className="group text-sm">
        <summary className="cursor-pointer text-ink-2 hover:text-ink">Архів за період · <span className="font-mono">{insights.archivedChats}</span></summary>
        {insights.archiveReasons.length ? (
          <ul className="m-0 mt-3 flex list-none flex-col p-0">
            {insights.archiveReasons.map((item) => (
              <li key={item.reason} className="flex items-baseline justify-between gap-3 border-t border-line py-2 first:border-t-0">
                <span>{ARCHIVE_REASONS[item.reason] ?? item.reason}</span>
                <span className="font-mono">{item.count}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 mt-3 text-ink-2">У вибраному періоді архівацій немає.</p>
        )}
      </details>
    </AnalyticsCard>
  );
}
