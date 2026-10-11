import { EmptyState } from '@/components/ui/empty-state';
import { analyticsPercentLabel } from '@/lib/analytics-rate';
import { SectionCard } from '@/components/views/shared/card';
import type { PlatformRow } from './types';

/** Результат за платформами: оголошення, відгуки, записи, проведені й відгук/оголошення. */
export function PlatformsCard({ platforms, className }: { platforms: PlatformRow[]; className?: string }) {
  return (
    <SectionCard className={className} title="Результат за платформами">
      {platforms.length === 0 ? (
        <EmptyState text="За цей період на платформах ще немає подій." />
      ) : (
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[420px] border-collapse text-sm @4xl:table-fixed">
            <thead>
              <tr className="text-left text-xs font-medium text-ink-2">
                <th scope="col" className="pb-2 font-medium @4xl:w-[28%]">Платформа</th>
                <th scope="col" className="pb-2 text-right font-medium" title="Публікації (оголошення)">Огол.</th>
                <th scope="col" className="pb-2 text-right font-medium">Відгуки</th>
                <th scope="col" className="pb-2 text-right font-medium">Записи</th>
                <th scope="col" className="pb-2 text-right font-medium">Проведені</th>
                <th scope="col" className="pb-2 text-right font-medium" title="Відгуки від публікацій">Відг./огол.</th>
              </tr>
            </thead>
            <tbody>
              {platforms.map((platform) => (
                <tr key={platform.key} className="border-t border-line">
                  <th scope="row" className="py-2 text-left font-normal">{platform.name}</th>
                  <td className="py-2 text-right font-mono">{platform.publications}</td>
                  <td className="py-2 text-right font-mono">{platform.responses}</td>
                  <td className="py-2 text-right font-mono">{platform.bookings}</td>
                  <td className="py-2 text-right font-mono">{platform.completed}</td>
                  <td className="py-2 text-right font-mono">{analyticsPercentLabel(platform.responseRate, platform.publications)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}
