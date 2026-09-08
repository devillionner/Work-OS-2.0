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
const pendingCommands = new Map<string, string>();
export async function postCommand(
  action: string,
  data: Record<string, unknown>,
  lead?: LeadDetail['lead'],
  entityId?: string,
): Promise<string> {
  const payload = {
    action,
    data,
    leadId: lead?.id,
    version: lead?.version ?? 0,
    entityId,
  };
  const key = JSON.stringify(payload);
  let body = pendingCommands.get(key);
  if (!body) {
    body = JSON.stringify({ commandId: crypto.randomUUID(), ...payload });
    pendingCommands.set(key, body);
  }
  const send = () =>
    fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
  // Retry transport failures with the exact same command ID. No duplicate booking.
  const response = await send().catch(() => send());
  const result = (await response.json()) as {
    id: string;
    error?: string;
    details?: { duplicates?: Array<{ name: string }> };
  };
  if (response.ok || response.status < 500) pendingCommands.delete(key);
  if (!response.ok) {
    const names = result.details?.duplicates
      ?.map((d: { name: string }) => d.name)
      .join(', ');
    throw new Error(
      `${result.error || 'Не вдалося зберегти.'}${names ? ` Збіги: ${names}.` : ''}`,
    );
  }
  return result.id;
}
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
  completed: 'Завершено',
  cancelled: 'Скасовано',
  rescheduled: 'Перенесено',
  'no-show': 'Не з’явився',
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
