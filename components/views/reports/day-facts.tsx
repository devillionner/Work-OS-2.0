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

/** Події в базі за день, згруповані за платформою: оголошення, відгуки, записи. */
export function EventSummary({ summary, className }: { summary: ReportData['summary']; className?: string }) {
  const grouped = new Map<string, Record<string, number>>();
  for (const row of summary) {
    const current = grouped.get(row.platform) || {};
    current[row.eventType] = (current[row.eventType] || 0) + row.count;
    grouped.set(row.platform, current);
  }
  return (
    <SectionCard title="Події в базі за цей день" className={className}>
      {grouped.size === 0 ? (
        <EmptyState text="За цей день у базі ще немає подій." />
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs font-medium text-ink-2">
              <th scope="col" className="pb-2 font-medium">Платформа</th>
              <th scope="col" className="pb-2 text-right font-medium">Огол.</th>
              <th scope="col" className="pb-2 text-right font-medium">Відгуки</th>
              <th scope="col" className="pb-2 text-right font-medium">Записи</th>
            </tr>
          </thead>
          <tbody>
            {Array.from(grouped).map(([platform, values]) => (
              <tr key={platform} className="border-t border-line">
                <th scope="row" className="py-2.5 text-left font-normal">{platformName(platform)}</th>
                <td className="py-2.5 text-right font-mono">{values.publication || 0}</td>
                <td className="py-2.5 text-right font-mono">{values.lead_created || 0}</td>
                <td className="py-2.5 text-right font-mono">{(values.lesson_booked || 0) + (values.curator_booking_pending || 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </SectionCard>
  );
}

function EventList({ title, events, onOpenLead }: { title: string; events: ReportEventDetail[]; onOpenLead: (leadId: string) => void }) {
  return (
    <div className="min-w-0">
      <h3 className="m-0 mb-2 flex items-baseline gap-2 text-sm font-medium">{title}<span className="font-mono text-xs text-ink-2">{events.length}</span></h3>
      {events.length === 0 ? (
        <p className="m-0 text-xs text-ink-2">Немає активних подій.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {events.map((event) => {
            const source = event.eventType === 'chat_joined' || event.eventType === 'publication';
            const primary = source ? event.chatName || 'Чат недоступний' : event.leadName || 'Лід недоступний';
            const platform = platformName(event.platform);
            const detail = source
              ? `${platform} · ${event.eventType === 'chat_joined' ? 'приєднання чату' : 'публікація'}`
              : `${platform} · ${event.eventType === 'lead_created' ? event.leadSubject || 'предмет не вказано' : event.lessonSubject || event.leadSubject || 'предмет не вказано'}`;
            return (
              <li key={event.id} className="flex items-center justify-between gap-3 border-t border-line py-2.5 first:border-t-0 first:pt-0">
                <div className="min-w-0"><p className="m-0 truncate text-sm">{primary}</p><p className="m-0 truncate text-xs text-ink-2">{detail}</p></div>
                {event.leadId ? <Button variant="ghost" size="sm" className="shrink-0" onClick={() => onOpenLead(event.leadId!)}>Відкрити</Button> : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Джерела та деталізація подій дня: приєднання й публікації, відгуки, записи; ліда можна відкрити. */
export function EventDetails({ details, onOpenLead, className }: { details: ReportEventDetail[]; onOpenLead: (leadId: string) => void; className?: string }) {
  const sources = details.filter((event) => event.eventType === 'chat_joined' || event.eventType === 'publication');
  const responses = details.filter((event) => event.eventType === 'lead_created');
  const bookings = details.filter((event) => event.eventType === 'lesson_booked' || event.eventType === 'curator_booking_pending');
  return (
    <SectionCard title="Джерела та деталізація" note={`Показано подій: ${details.length}`} className={className}>
      <div className="grid grid-cols-1 gap-6 @4xl:grid-cols-3">
        <EventList title="Джерельні події" events={sources} onOpenLead={onOpenLead} />
        <EventList title="Відгуки" events={responses} onOpenLead={onOpenLead} />
        <EventList title="Записи" events={bookings} onOpenLead={onOpenLead} />
      </div>
    </SectionCard>
  );
}
