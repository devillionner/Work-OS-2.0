export class LeadError extends Error {
  status: number;
  details: unknown;
  constructor(message: string, status = 400, details: unknown = null) {
    super(message);
    this.name = 'LeadError';
    this.status = status;
    this.details = details;
  }
}
export const PLATFORMS = [
  'telegram',
  'whatsapp',
  'viber',
  'facebook',
  'threads',
] as const;
export const LEAD_STATUSES = ['new', 'active', 'won', 'lost'] as const;
export const FUNNEL_STAGES = [
  'response',
  'clarification',
  'booked',
  'reminder',
  'lesson',
  'result',
] as const;
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new LeadError('Очікується об’єкт.');
  return value as Record<string, unknown>;
}
export function only(input: Record<string, unknown>, keys: string[]) {
  if (Object.keys(input).some((key) => !keys.includes(key)))
    throw new LeadError('Невідоме поле запиту.');
}
export function string(
  value: unknown,
  label: string,
  max = 200,
  required = false,
): string {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (required && !value.trim())
  )
    throw new LeadError(`Перевірте поле «${label}».`);
  return value.trim();
}
export function choice<T extends string>(
  value: unknown,
  options: readonly T[],
  label: string,
): T {
  if (typeof value !== 'string' || !options.includes(value as T))
    throw new LeadError(`Невірне значення «${label}».`);
  return value as T;
}
export function integer(
  value: unknown,
  label: string,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    throw new LeadError(`Перевірте поле «${label}».`);
  return value;
}
export function nullableEpoch(value: unknown, label: string): number | null {
  return value === null ? null : integer(value, label, 0, 253402300799);
}
export function date(value: unknown, label: string): string {
  const v = string(value, label, 10, true);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
    !Number.isFinite(Date.parse(v)) ||
    new Date(v).toISOString().slice(0, 10) !== v
  )
    throw new LeadError(`Невірна дата «${label}».`);
  return v;
}
export function url(value: unknown, label: string): string {
  const v = string(value, label, 2000);
  if (v && !safeUrl(v))
    throw new LeadError(`«${label}»: потрібне посилання https:// або http://.`);
  return v;
}
export function safeUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (
      ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password
    );
  } catch {
    return false;
  }
}
export function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, '').replace(/^00/, '');
  return /^0\d{9}$/.test(digits) ? `38${digits}` : digits;
}
export function normalizeTelegram(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\/(?:www\.)?(?:t\.me|telegram\.me)\//i, '')
    .replace(/^@/, '')
    .replace(/\/$/, '')
    .toLowerCase();
}
export function phone(value: unknown) {
  const v = string(value, 'Телефон', 40);
  if (v && (!/^[+\d\s().-]+$/.test(v) || !/^\d{7,15}$/.test(normalizePhone(v))))
    throw new LeadError('Некоректний телефон.');
  return v;
}
export function telegram(value: unknown) {
  const v = string(value, 'Telegram username', 200);
  if (v && !/^[a-z][a-z0-9_]{3,31}$/.test(normalizeTelegram(v)))
    throw new LeadError('Некоректний Telegram username.');
  return v;
}
export function grade(value: unknown): number | null {
  return value === null ? null : integer(value, 'Клас', 1, 11);
}
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
