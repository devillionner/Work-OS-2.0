import type { LeadDetail } from '@/lib/leads/application/queries';
import type { Learner } from '@/lib/leads/data/list';
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
    > & { learners: Learner[] }
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
/** Один формат дат у «Лідах»: «27.11.2026, 14:05» (Київ). */
export function displayTime(epoch: number | null) {
  return epoch === null
    ? 'Не вказано'
    : new Intl.DateTimeFormat('uk-UA', {
        timeZone: 'Europe/Kyiv',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(epoch * 1000));
}

/** Коротка дата й час для щільних рядків: «27.11, 14:05» (Київ). */
export function displayShortTime(epoch: number) {
  return new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(epoch * 1000));
}

/** Дата з бази (`2026-11-27`) у тому самому вигляді, що й `displayTime`: «27.11.2026». */
export function displayDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : iso;
}

/** Тривалість очікування: «4 год 5 хв», «12 хв». */
export function displayWait(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  return hours > 0 ? `${hours} год ${minutes} хв` : `${minutes} хв`;
}
