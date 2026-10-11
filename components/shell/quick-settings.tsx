'use client';

import { ThemePicker } from '@/components/shell/theme-picker';
import { useTheme, type AtmospherePreset } from '@/components/shell/theme-provider';
import type { ViewKey } from '@/components/shell/views';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Sheet } from '@/components/ui/sheet';

const ATMOSPHERES: Array<{ key: AtmospherePreset; label: string }> = [
  { key: 'fog', label: 'Туман' }, { key: 'coast', label: 'Узбережжя' }, { key: 'forest', label: 'Ліс' }, { key: 'road', label: 'Дорога' },
];

/** Швидкі налаштування з шестерні PulseRail: тема, атмосфера й перехід до налаштувань. */
export function QuickSettings({ open, onOpenChange, onNavigate }: { open: boolean; onOpenChange: (open: boolean) => void; onNavigate: (view: ViewKey) => void }) {
  const { atmosphere, setAtmosphere } = useTheme();
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Швидкі налаштування" side="bottom" snap="half">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-ink-2">Тема</span>
          <ThemePicker compact />
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-ink-2">Атмосфера</span>
          <div className="flex flex-wrap gap-2">
            {ATMOSPHERES.map((item) => <Chip key={item.key} pressed={atmosphere === item.key} onClick={() => setAtmosphere(item.key)}>{item.label}</Chip>)}
          </div>
        </div>
        <Button variant="outline" onClick={() => { onOpenChange(false); onNavigate('settings'); }}>Усі налаштування</Button>
      </div>
    </Sheet>
  );
}
