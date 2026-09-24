export const APP_VERSION = '0.2.60';
export const APP_RELEASE_DATE = '2026-09-24';

// User-facing copy only. Keep each note short and plain; technical details belong in docs and commits.
export const APP_CHANGES = [
  'Якщо Cloudflare D1 вичерпав денний ліміт, Work OS показує зрозумілий recovery-екран замість generic browser error.',
  'Фонові D1-запити сповільнюються при бездіяльності й помилках, а Platforms не префетчить сусідні черги без запиту.',
  'WhatsApp і Viber мають однаковий розгортний блок «Приєднані сьогодні».',
] as const;
