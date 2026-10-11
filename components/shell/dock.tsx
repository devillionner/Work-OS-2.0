'use client';

import { Ellipsis } from 'lucide-react';
import { VIEWS, type ViewKey } from '@/components/shell/views';
import { cn } from '@/lib/utils';

const DOCK_VIEWS: ViewKey[] = ['today', 'platforms', 'leads', 'analytics'];
const MORE_VIEWS: ViewKey[] = ['reports', 'library', 'settings'];

/** Плаваюча чорна pill знизу: 4 розділи й «Ще». Активна іконка — біле коло. */
export function Dock({ active, onNavigate, onPrefetch, onMore }: { active: ViewKey; onNavigate: (view: ViewKey) => void; onPrefetch?: (view: ViewKey) => void; onMore: () => void }) {
  const moreActive = MORE_VIEWS.includes(active);
  return (
    <nav aria-label="Основна навігація" className="on-rail fixed inset-x-3 z-30 flex h-16 items-center justify-around rounded-full bg-rail px-2 text-rail-ink-2 shadow-float" style={{ bottom: 'calc(12px + env(safe-area-inset-bottom))' }}>
      {DOCK_VIEWS.map((key) => {
        const view = VIEWS.find((item) => item.key === key)!;
        return <DockButton key={key} label={view.label} active={active === key} onClick={() => onNavigate(key)} onPrefetch={onPrefetch ? () => onPrefetch(key) : undefined}><view.icon aria-hidden="true" strokeWidth={1.5} className="size-[22px]" /></DockButton>;
      })}
      <DockButton label="Ще" active={moreActive} onClick={onMore}><Ellipsis aria-hidden="true" strokeWidth={1.5} className="size-[22px]" /></DockButton>
    </nav>
  );
}

function DockButton({ label, active, onClick, onPrefetch, children }: { label: string; active: boolean; onClick: () => void; onPrefetch?: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      onPointerEnter={onPrefetch}
      onFocus={onPrefetch}
      className={cn('inline-grid size-12 place-items-center rounded-full transition-colors duration-200 active:scale-95', active ? 'bg-rail-ink text-rail' : 'text-rail-ink-2')}
    >
      {children}
    </button>
  );
}
