'use client';

import { useShell } from '@/components/shell/shell-context';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';

/** Розбивка результату за платформами: чотири числа на рядок, без кольорового декору. */
export function PlatformBreakdown() {
  const { snapshot, navigate } = useShell();
  const rows = snapshot.platforms.filter((platform) => snapshot.enabledPlatforms.includes(platform.key) || platform.key === 'threads' || platform.key === 'unknown');
  return (
    <Surface variant="glass" radius="card" data-reveal className="flex flex-col gap-4 p-5" aria-labelledby="breakdown-title">
      <div className="flex items-center justify-between gap-3">
        <h2 id="breakdown-title" className="m-0 text-[17px] font-medium">Платформи сьогодні</h2>
        <Button variant="ghost" size="sm" onClick={() => navigate('platforms')}>Відкрити</Button>
      </div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-left text-xs font-medium text-ink-2">
            <th scope="col" className="pb-2 font-medium">Платформа</th>
            <th scope="col" className="pb-2 text-right font-medium" title="Публікації">Публ.</th>
            <th scope="col" className="pb-2 text-right font-medium" title="Нові чати">Нові</th>
            <th scope="col" className="pb-2 text-right font-medium" title="Відгуки">Відг.</th>
            <th scope="col" className="pb-2 text-right font-medium" title="Записи">Зап.</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((platform) => (
            <tr key={platform.key} className="border-t border-line">
              <th scope="row" className="py-2.5 text-left font-normal">{platform.name}</th>
              <td className="py-2.5 text-right font-mono">{platform.publications}</td>
              <td className="py-2.5 text-right font-mono">{platform.joined}</td>
              <td className="py-2.5 text-right font-mono">{platform.responses}</td>
              <td className="py-2.5 text-right font-mono">{platform.bookings}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Surface>
  );
}
