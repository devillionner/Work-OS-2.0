import { Badge } from '@/components/ui/badge';

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

export function AnalyticsInsights({ insights }: { insights: InsightData }) {
  const recommendationLabel = insights.recommendation.kind === 'check_low_efficiency'
    ? 'Потребує перевірки'
    : insights.recommendation.kind === 'consider_more_often'
      ? 'Сильний сигнал'
      : 'Недостатньо даних';
  return <section className="analytics-card" aria-labelledby="analytics-insight-title">
    <div className="card-heading">
      <div><p className="eyebrow">Пояснена рекомендація</p><h3 id="analytics-insight-title">{insights.recommendation.title}</h3></div>
      <Badge variant="outline">{recommendationLabel}</Badge>
    </div>
    <p>{insights.recommendation.explanation}</p>
    <p className="muted-note">Work OS лише підсвічує сигнал із поточних даних. Архівація або зміна частоти завжди лишається ручним рішенням.</p>
    <div className="card-heading"><div><p className="eyebrow">Архів</p><h4>Причини за вибраний період</h4></div><Badge variant="secondary">{insights.archivedChats}</Badge></div>
    {insights.archiveReasons.length ? <div className="funnel-grid">
      {insights.archiveReasons.map((item) => <div className="funnel-step" key={item.reason}><span>{item.reason}</span><strong>{item.count}</strong><small>архівних чатів</small></div>)}
    </div> : <p className="analytics-empty">У вибраному періоді архівацій немає.</p>}
  </section>;
}
