'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import type { AnalyticsOverview } from '@/lib/analytics-overview';

type InsightData = {
  recommendation: {
    kind: 'check_low_efficiency' | 'consider_more_often' | 'insufficient_data';
    title: string;
    explanation: string;
    chatId: string | null;
    chatName: string | null;
  };
  archiveReasons: Array<{ reason: string; count: number }>;
  archivedChats: number;
};

const archiveReasonLabels: Record<string, string> = {
  irrelevant: 'Неактуальний чат',
  banned: 'Блокування',
  missing: 'Чат недоступний',
  other: 'Інше',
};

export function AnalyticsInsights({ insights }: { insights: InsightData }) {
  const [overview,setOverview]=useState<AnalyticsOverview|null>(null);
  const [overviewError,setOverviewError]=useState(false);
  useEffect(()=>{
    let cancelled=false;
    void fetch('/api/analytics/overview',{cache:'no-store'}).then(async response=>{
      if(!response.ok)throw new Error('overview');
      const body=await response.json() as AnalyticsOverview;
      if(!cancelled)setOverview(body);
    }).catch(()=>{if(!cancelled)setOverviewError(true);});
    return()=>{cancelled=true;};
  },[]);

  const recommendationLabel = insights.recommendation.kind === 'check_low_efficiency'
    ? 'Потребує перевірки'
    : insights.recommendation.kind === 'consider_more_often'
      ? 'Сильний сигнал'
      : 'Недостатньо даних';

  return <section className="analytics-card" aria-labelledby="analytics-insight-title">
    <div className="card-heading">
      <div><p className="eyebrow">Що важливо зараз</p><h3 id="analytics-insight-title">План, зміна і наступна дія</h3></div>
      <Badge variant="outline">Місяць до сьогодні</Badge>
    </div>
    {overview ? <div className="funnel-grid">
      <div className="funnel-step"><span>План / факт записів</span><strong>{overview.monthlyGoal.actual} / {overview.monthlyGoal.target}</strong><small>{overview.monthlyGoal.target>0 ? (overview.monthlyGoal.remaining>0 ? `Виконано ${overview.monthlyGoal.progress}% · ще ${overview.monthlyGoal.remaining}` : `Ціль виконано · ${overview.monthlyGoal.progress}%`) : 'Місячну ціль ще не задано'}</small></div>
      <div className="funnel-step"><span>Що змінилося</span><strong>{overview.comparison.delta>0?`+${overview.comparison.delta}`:overview.comparison.delta}</strong><small>{overview.comparison.label}</small></div>
      <div className="funnel-step"><span>Найбільший розрив</span><strong>{overview.bottleneck ? `${overview.bottleneck.gap} п.п.` : '—'}</strong><small>{overview.bottleneck ? `${overview.bottleneck.label}: ${overview.bottleneck.actual}% / ціль ${overview.bottleneck.target}%` : 'Задані цілі воронки виконані або ще не задані'}</small></div>
    </div> : overviewError ? <p className="muted-note">План/факт зараз недоступний. Основна аналітика нижче лишається актуальною.</p> : <p className="muted-note" role="status">Звіряємо місячний план і зміну результату…</p>}
    <div className="card-heading"><div><p className="eyebrow">Одна наступна дія</p><h4>{insights.recommendation.title}</h4></div><Badge variant="secondary">{recommendationLabel}</Badge></div>
    <p>{insights.recommendation.explanation}</p>
    <p className="muted-note">Work OS лише пояснює сигнал. Архівація або зміна частоти завжди лишається ручним рішенням.</p>
    <details>
      <summary>Деталі архіву за вибраний період · {insights.archivedChats}</summary>
      {insights.archiveReasons.length ? <div className="funnel-grid">
        {insights.archiveReasons.map((item) => <div className="funnel-step" key={item.reason}><span>{archiveReasonLabels[item.reason] ?? item.reason}</span><strong>{item.count}</strong><small>архівних чатів</small></div>)}
      </div> : <p className="analytics-empty">У вибраному періоді архівацій немає.</p>}
    </details>
  </section>;
}
