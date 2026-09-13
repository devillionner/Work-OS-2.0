export type AnalyticsChatSignal = {
  id: string;
  name: string;
  platform: string;
  publications: number;
  responses: number;
  responseRate: number;
};

export type AnalyticsRecommendation = {
  kind: 'check_low_efficiency' | 'consider_more_often' | 'insufficient_data';
  title: string;
  explanation: string;
  chatId: string | null;
  chatName: string | null;
};

export type ArchiveReason = { reason: string; count: number };

export function buildAnalyticsRecommendation(
  chats: AnalyticsChatSignal[],
  rangeDays: number,
): AnalyticsRecommendation {
  const sample = chats
    .filter((chat) => chat.publications >= 5)
    .sort((a, b) => b.publications - a.publications || a.name.localeCompare(b.name, 'uk'));

  if (rangeDays >= 14) {
    const zeroResponse = sample.find((chat) => chat.responses === 0);
    if (zeroResponse) {
      return {
        kind: 'check_low_efficiency',
        title: `Перевірте чат «${zeroResponse.name}»`,
        explanation: `${zeroResponse.publications} публікацій за вибраний період не дали жодного відгуку. Перевірте актуальність аудиторії, правила чату й доцільність подальших публікацій перед архівацією.`,
        chatId: zeroResponse.id,
        chatName: zeroResponse.name,
      };
    }
  }

  const strongest = sample
    .filter((chat) => chat.responses >= 2)
    .sort((a, b) => b.responseRate - a.responseRate || b.responses - a.responses || b.publications - a.publications)[0];
  if (strongest) {
    return {
      kind: 'consider_more_often',
      title: `Сильний сигнал: «${strongest.name}»`,
      explanation: `${strongest.responses} відгуків із ${strongest.publications} публікацій (${strongest.responseRate}%). Це найкраща конверсія серед чатів із щонайменше 5 публікаціями та 2 відгуками у вибраному періоді; перевірте, чи варто використовувати цей чат частіше.`,
      chatId: strongest.id,
      chatName: strongest.name,
    };
  }

  return {
    kind: 'insufficient_data',
    title: 'Поки недостатньо даних для рекомендації',
    explanation: 'Для поясненої поради потрібно щонайменше 5 публікацій у чаті. Work OS не робить висновок із малої вибірки.',
    chatId: null,
    chatName: null,
  };
}

export function summarizeArchiveReasons(values: Array<string | null | undefined>): ArchiveReason[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    const reason = value?.trim() || 'Без причини';
    counts.set(reason, (counts.get(reason) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason, 'uk'));
}
