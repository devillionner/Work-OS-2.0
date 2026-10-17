import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { readJsonObject, sameOrigin } from '@/lib/http-json';
import {
  CUSTOM_REMINDER_LIMIT, nextCustomReminderAt, parseCustomReminders, trimCustomReminders, validReminderAt, validReminderText,
  type CustomReminder,
} from '@/lib/leads/domain/custom-reminders';

const OPS = ['add', 'update', 'done', 'reopen', 'delete'] as const;
type Op = (typeof OPS)[number];

/** Ручні нагадування ліду: додати, змінити, виконати, повернути, видалити. Зберігаються в самому ліді (JSON), без таблиці. */
export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Недійсний запит.' }, { status: 403 });
  const body = await readJsonObject(request, 8 * 1024);
  if (body instanceof Response) return body;
  const leadId = typeof body.leadId === 'string' ? body.leadId.trim().slice(0, 200) : '';
  const op = OPS.find((candidate) => candidate === body.op) as Op | undefined;
  if (!leadId || !op) return Response.json({ error: 'Некоректний запит.' }, { status: 400 });
  const now = Math.floor(Date.now() / 1000);

  const row = await env.DB.prepare('SELECT custom_reminders_json AS json FROM leads WHERE id=?1 AND user_id=?2 LIMIT 1')
    .bind(leadId, user.id).first<{ json: string | null }>();
  if (!row) return Response.json({ error: 'Ліда не знайдено.' }, { status: 404 });
  const items = parseCustomReminders(row.json);
  const reminderId = typeof body.reminderId === 'string' ? body.reminderId : '';
  const index = items.findIndex((item) => item.id === reminderId);
  let next: CustomReminder[] = items;

  if (op === 'add') {
    const text = validReminderText(body.text);
    const at = validReminderAt(body.at, now);
    if (!text) return Response.json({ error: 'Напишіть, що нагадати (до 300 символів).' }, { status: 400 });
    if (at === null) return Response.json({ error: 'Вкажіть час нагадування: не раніше ніж доба тому й не далі ніж за три роки.' }, { status: 400 });
    if (items.filter((item) => item.doneAt === null).length >= CUSTOM_REMINDER_LIMIT - 10)
      return Response.json({ error: 'Забагато невиконаних нагадувань для одного ліда. Виконайте чи видаліть зайві.' }, { status: 409 });
    next = [...items, { id: crypto.randomUUID(), text, at, doneAt: null }];
  } else {
    if (index < 0) return Response.json({ error: 'Нагадування вже змінено. Оновіть картку.' }, { status: 404 });
    if (op === 'delete') next = items.filter((_, position) => position !== index);
    else if (op === 'done') next = items.map((item, position) => (position === index && item.doneAt === null ? { ...item, doneAt: now } : item));
    else if (op === 'reopen') next = items.map((item, position) => (position === index ? { ...item, doneAt: null } : item));
    else {
      const text = body.text === undefined ? items[index].text : validReminderText(body.text);
      const at = body.at === undefined ? items[index].at : validReminderAt(body.at, now);
      if (!text) return Response.json({ error: 'Напишіть, що нагадати (до 300 символів).' }, { status: 400 });
      if (at === null) return Response.json({ error: 'Вкажіть час нагадування: не раніше ніж доба тому й не далі ніж за три роки.' }, { status: 400 });
      next = items.map((item, position) => (position === index ? { ...item, text, at } : item));
    }
  }

  next = trimCustomReminders(next);
  const json = next.length ? JSON.stringify(next) : null;
  // Запис лише якщо JSON не змінили між читанням і записом (інший пристрій): інакше нічого не затираємо.
  const result = await env.DB.prepare(`UPDATE leads SET custom_reminders_json=?3,next_custom_reminder_at=?4
      WHERE id=?1 AND user_id=?2 AND custom_reminders_json IS ?5`)
    .bind(leadId, user.id, json, nextCustomReminderAt(next), row.json).run();
  if (!result.meta.changes) return Response.json({ error: 'Нагадування змінили на іншому пристрої. Оновіть картку.' }, { status: 409 });
  const sorted = [...next].sort((a, b) => Number(a.doneAt !== null) - Number(b.doneAt !== null) || a.at - b.at);
  return Response.json({ ok: true, customReminders: sorted }, { headers: { 'Cache-Control': 'no-store' } });
}
