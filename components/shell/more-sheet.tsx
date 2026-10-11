'use client';

import { VIEWS, type ViewKey } from '@/components/shell/views';
import { Sheet } from '@/components/ui/sheet';

const MORE: ViewKey[] = ['reports', 'library', 'settings'];

/** «Ще» на телефоні: Звіти, Бібліотека й Налаштування. */
export function MoreSheet({ open, onOpenChange, active, onNavigate }: { open: boolean; onOpenChange: (open: boolean) => void; active: ViewKey; onNavigate: (view: ViewKey) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Ще" side="bottom" snap="half">
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {MORE.map((key) => {
          const view = VIEWS.find((item) => item.key === key)!;
          return (
            <li key={key}>
              <button type="button" aria-current={active === key ? 'page' : undefined} onClick={() => { onOpenChange(false); onNavigate(key); }} className="flex min-h-14 w-full items-center gap-4 rounded-inner px-3 text-left text-[15px] font-medium transition-colors hover:bg-raised aria-[current=page]:bg-raised">
                <view.icon aria-hidden="true" strokeWidth={1.5} className="size-5 text-ink-2" />
                {view.label}
              </button>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
