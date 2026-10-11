'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { BarRow, SectionCard } from '@/components/views/shared/card';
import { labels } from '@/components/views/leads/client';
import type { ReportEventDetail } from '@/lib/reports/details';
import type { GoalPlanFact, ReportData } from './types';

const platformName = (key: string | null) => labels[key || 'unknown'] ?? (key === null || key === 'unknown' ? 'Інше' : key);

export function PlanFact({ data, className }: { data: GoalPlanFact; className?: string }) {
  const ratio = (actual: number, target: number) => (target > 0 ? actual / target : 0);
  return (
    <SectionCard title="План і факт" className={className}>
      <ul className="m-0 flex list-none flex-col p-0">
        <BarRow label="День" value={`${data.dailyActual} / ${data.dailyTarget}`} ratio={ratio(data.dailyActual, data.dailyTarget)} faint={data.dailyTarget === 0} />
        <BarRow label="Місяць" value={`${data.monthlyActual} / ${data.monthlyTarget}`} ratio={ratio(data.monthlyActual, data.monthlyTarget)} faint={data.monthlyTarget === 0} />
      </ul>
    </SectionCard>
  );
}

const TOTALS: ReadonlyArray<{ key: string; label: string; types: readonly string[] }> = [
  { key: 'joined', label: 'Приєднано', types: ['chat_joined'] },
  { key: 'publications', label: 'Публікації', types: ['publication'] },
  { key: 'responses', label: 'Відгуки', types: ['lead_created'] },
  { key: 'bookings', label: 'Записи', types: ['lesson_booked', 'curator_booking_pending'] },
  { key: 'completed', label: 'Уроки', types: ['lesson_completed'] },
];
const BREAKDOWN: ReadonlyArray<{ key: string; one: string; few: string; many: string }> = [
  { key: 'joined', one: 'приєднання', few: 'приєднання', many: 'приєднань' },
  { key: 'publications', one: 'публікація', few: 'публікації', many: 'публікацій' },
  { key: 'responses', one: 'відгук', few: 'відгуки', many: 'відгуків' },
  { key: 'bookings', one: 'запис', few: 'записи', many: 'записів' },
  { key: 'completed', one: 'урок', few: 'уроки', many: 'уроків' },
];
const plural = (count: number, one: string, few: string, many: string) => {
  const abs = count % 100;
  if (abs > 10 && abs < 20) return many;
  const last = abs % 10;
  return last === 1 ? one : last > 1 && last < 5 ? few : many;
};

/** Підсумок дня: п'ять чисел зверху й компактний рядок на платформу; без списків чатів. */
export function EventSummary({ summary, className }: { summary: ReportData['summary']; className?: string }) {
  const byPlatform = new Map<string, Record<string, number>>();
  const totals: Record<string, number> = {};
  for (const row of summary) {
    const group = TOTALS.find((item) => item.types.includes(row.eventType));
    if (!group) continue;
    const current = byPlatform.get(row.platform) || {};
    current[group.key] = (current[group.key] || 0) + row.count;
    byPlatform.set(row.platform, current);
    totals[group.key] = (totals[group.key] || 0) + row.count;
  }
  const empty = TOTALS.every((item) => !totals[item.key]);
  return (
    <SectionCard title="Підсумок дня" className={className}>
      {empty ? (
        <EmptyState text="За цей день у базі ще немає подій." />
      ) : (
        <>
          <dl className="m-0 grid grid-cols-5 gap-2 text-center">
            {TOTALS.map((item) => (
              <div key={item.key} className="min-w-0"><dd className="m-0 font-mono text-xl">{totals[item.key] || 0}</dd><dt className="truncate text-[11px] text-ink-2">{item.label}</dt></div>
            ))}
          </dl>
          <ul className="m-0 flex list-none flex-col p-0">
            {Array.from(byPlatform).map(([platform, values]) => (
              <li key={platform} className="flex flex-wrap items-baseline justify-between gap-x-3 border-t border-line py-2 text-sm">
                <span>{platformName(platform)}</span>
                <span className="text-xs text-ink-2">{BREAKDOWN.filter((item) => values[item.key]).map((item) => `${values[item.key]} ${plural(values[item.key], item.one, item.few, item.many)}`).join(' · ')}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </SectionCard>
  );
}

const LEAD_LIMIT = 10;

function EventList({ title, events, onOpenLead }: { title: string; events: ReportEventDetail[]; onOpenLead: (leadId: string) => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? events : events.slice(0, LEAD_LIMIT);
  return (
    <div className="min-w-0">
      <h3 className="m-0 mb-2 flex items-baseline gap-2 text-sm font-medium">{title}<span className="font-mono text-xs text-ink-2">{events.length}</span></h3>
      {events.length === 0 ? (
        <p className="m-0 text-xs text-ink-2">Немає активних подій.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {shown.map((event) => {
            const platform = platformName(event.platform);
            const subject = event.eventType === 'lead_created' ? event.leadSubject || 'предмет не вказано' : event.lessonSubject || event.leadSubject || 'предмет не вказано';
            return (
              <li key={event.id} className="flex items-center justify-between gap-3 border-t border-line py-2.5 first:border-t-0 first:pt-0">
                <div className="min-w-0"><p className="m-0 truncate text-sm">{event.leadName || 'Лід недоступний'}</p><p className="m-0 truncate text-xs text-ink-2">{platform} · {subject}</p></div>
                {event.leadId ? <Button variant="ghost" size="sm" className="shrink-0" onClick={() => onOpenLead(event.leadId!)}>Відкрити</Button> : null}
              </li>
            );
          })}
        </ul>
      )}
      {events.length > LEAD_LIMIT ? <Button variant="ghost" size="sm" className="mt-2" onClick={() => setAll((value) => !value)}>{all ? 'Згорнути' : `Показати всі (${events.length})`}</Button> : null}
    </div>
  );
}

/** Відгуки й записи дня з переходом до ліда; списки чатів не показуємо — їх замінює підсумок дня. */
export function EventDetails({ details, onOpenLead, className }: { details: ReportEventDetail[]; onOpenLead: (leadId: string) => void; className?: string }) {
  const responses = details.filter((event) => event.eventType === 'lead_created');
  const bookings = details.filter((event) => event.eventType === 'lesson_booked' || event.eventType === 'curator_booking_pending');
  if (!responses.length && !bookings.length) return null;
  return (
    <SectionCard title="Відгуки й записи дня" className={className}>
      <div className={responses.length && bookings.length ? 'grid grid-cols-1 gap-6 @4xl:grid-cols-2' : 'grid grid-cols-1 gap-6'}>
        {responses.length ? <EventList title="Відгуки" events={responses} onOpenLead={onOpenLead} /> : null}
        {bookings.length ? <EventList title="Записи" events={bookings} onOpenLead={onOpenLead} /> : null}
      </div>
    </SectionCard>
  );
}
