import type { LeadDetail } from '@/lib/leads/application/queries';
export type Mutation = (
  action: string,
  data?: Record<string, unknown>,
  entityId?: string,
) => Promise<void>;
export type LeadList = {
  leads: Array<
    Pick<
      LeadDetail['lead'],
      | 'id'
      | 'name'
      | 'platform'
      | 'subject'
      | 'status'
      | 'funnelStage'
      | 'qualification'
      | 'duplicateState'
      | 'responseDate'
      | 'nextAction'
      | 'nextContactAt'
      | 'archivedAt'
      | 'overdue'
    >
  >;
  total: number;
  offset: number;
};
export async function getJson<T>(
  url: string,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', signal });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new Error(data.error || 'Не вдалося завантажити дані.');
  return data as T;
}
export { createBrowserCommandClient } from '@/lib/leads/client/commands';
export const labels: Record<string, string> = {
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
  viber: 'Viber',
  facebook: 'Facebook',
  threads: 'Threads',
  new: 'Новий',
  active: 'У роботі',
  won: 'Успішний',
  lost: 'Закритий',
  response: 'Відгук',
  clarification: 'Уточнення',
  booked: 'Запис',
  reminder: 'Нагадування',
  lesson: 'Урок',
  result: 'Результат',
  completed: 'Проведено',
  cancelled: 'Скасовано',
  rescheduled: 'Перенесено',
  'no-show': 'Учень пішов',
  scheduled: 'Запис',
  none: 'Немає',
  possible: 'Можливий',
  confirmed: 'Підтверджений',
  'needs-data': 'Бракує даних',
  pending: 'Заплановано',
  due: 'Час нагадати',
  sent: 'Надіслано',
  skipped: 'Пропущено',
  disabled: 'Вимкнено',
  inactive: 'Неактивне',
  expired: 'Урок уже розпочався',
};
export function displayTime(epoch: number | null) {
  return epoch === null
    ? 'Не вказано'
    : new Intl.DateTimeFormat('uk-UA', {
        timeZone: 'Europe/Kyiv',
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(new Date(epoch * 1000));
}
