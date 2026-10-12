'use client';

import { AtmosphereSwatch } from '@/components/shell/atmosphere';
import { PRESET_GROUPS } from '@/components/shell/atmosphere-presets';
import { useTheme } from '@/components/shell/theme-provider';
import type { ViewKey } from '@/components/shell/views';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Sheet } from '@/components/ui/sheet';

/** Швидкі налаштування з шестерні PulseRail: атмосфера й перехід до налаштувань. */
export function QuickSettings({ open, onOpenChange, onNavigate }: { open: boolean; onOpenChange: (open: boolean) => void; onNavigate: (view: ViewKey) => void }) {
  const { atmosphere, setAtmosphere } = useTheme();
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Швидкі налаштування" side="bottom" snap="half">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-4">
          <span className="text-xs font-medium text-ink-2">Атмосфера</span>
          {PRESET_GROUPS.map((group) => (
            <fieldset key={group.label} className="m-0 min-w-0 border-0 p-0">
              <legend className="mb-2 p-0 text-xs text-ink-3">{group.label}</legend>
              <div className="flex flex-wrap gap-2">
                {group.items.map((item) => (
                  <Chip key={item.key} pressed={atmosphere === item.key} onClick={() => setAtmosphere(item.key)} className="pl-1.5">
                    <AtmosphereSwatch preset={item.key} className="size-5" />
                    {item.label}
                  </Chip>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
        <Button variant="outline" onClick={() => { onOpenChange(false); onNavigate('settings'); }}>Усі налаштування</Button>
      </div>
    </Sheet>
  );
}
