export type ReportSummaryItem = { platform: string; eventType: string; count: number };
export type ReportBookingDetail = { eventType:string; platform:string|null; lessonSubject:string|null; leadSubject:string|null; lessonTeacherName:string|null; lessonDate:string|null };

const PLATFORM_ORDER = ['telegram','threads','whatsapp','facebook','viber'] as const;
const PLATFORM_LABELS: Record<string,string> = {
  telegram:'Telegram', threads:'Threads', whatsapp:'WhatsApp', facebook:'Facebook', viber:'Viber',
};

export function composeDailyReportText(date: string, rows: ReportSummaryItem[], details: ReportBookingDetail[] = []): string {
  const grouped = new Map<string,Map<string,number>>();
  for (const row of rows) {
    const platform = row.platform || 'unknown';
    const events = grouped.get(platform) || new Map<string,number>();
    events.set(row.eventType,(events.get(row.eventType)||0)+Math.max(0,Number(row.count)||0));
    grouped.set(platform,events);
  }
  const extraPlatforms = Array.from(grouped.keys()).filter((value) => !PLATFORM_ORDER.includes(value as typeof PLATFORM_ORDER[number])).sort();
  const platforms = [...PLATFORM_ORDER,...extraPlatforms];
  const lines:string[] = [`Загальний звіт ${formatReportDate(date)}`,''];
  platforms.forEach((platform,index) => {
    const events = grouped.get(platform) || new Map<string,number>();
    lines.push(PLATFORM_LABELS[platform] || platform);
    lines.push(`Оголошення: ${read(events,'publication')}`);
    if (platform !== 'threads') lines.push(`Нові чати: ${read(events,'chat_joined')}`);
    lines.push(`Відгуки: ${read(events,'lead_created')}`);
    lines.push(`Записи: ${read(events,'lesson_booked') + read(events,'curator_booking_pending')}`);
    for (const booking of bookingLines(details,platform)) lines.push(booking);
    if (index < platforms.length - 1) lines.push('');
  });
  return lines.join('\n');
}

function read(events: Map<string,number>, key: string): number { return events.get(key) || 0; }
function formatReportDate(value: string): string {
  const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}.${match[2]}.${match[1].slice(2)}` : value;
}

function bookingLines(details: ReportBookingDetail[], platform: string): string[] {
  return details.filter((item) => item.eventType === 'lesson_booked' && (item.platform || 'unknown') === platform && item.lessonDate)
    .map((item) => `${item.lessonSubject || item.leadSubject || 'Предмет не вказано'} — ${item.lessonTeacherName || 'Викладач не вказаний'} — ${formatReportDate(item.lessonDate!)};`);
}
