'use client';

import { useRef, useSyncExternalStore } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { gsap, matchMotion, useGSAP } from '@/components/motion/gsap';
import { VIEWS, type ViewKey } from '@/components/shell/views';
import { Tooltip } from '@/components/ui/tooltip';
import { APP_VERSION } from '@/lib/app-meta';
import { cn } from '@/lib/utils';

const KEY = 'work-os:rail-open';
const listeners = new Set<() => void>();
let open: boolean | null = null;

function readOpen(): boolean {
  if (open === null) {
    try { open = window.localStorage.getItem(KEY) === '1'; } catch { open = false; }
  }
  return open;
}
function setOpen(next: boolean) {
  open = next;
  try { window.localStorage.setItem(KEY, next ? '1' : '0'); } catch { /* ігноруємо */ }
  listeners.forEach((listener) => listener());
}
function useRailOpen(): boolean {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, readOpen, () => false);
}

type Props = {
  active: ViewKey;
  leadCount: number;
  canExpand: boolean;
  onNavigate: (view: ViewKey) => void;
  /** Передзавантаження коду розділу при наведенні чи фокусі. */
  onPrefetch?: (view: ViewKey) => void;
  onOpenRelease: () => void;
};

export function Rail({ active, leadCount, canExpand, onNavigate, onPrefetch, onOpenRelease }: Props) {
  const stored = useRailOpen();
  const expanded = canExpand && stored;
  const root = useRef<HTMLElement>(null);
  const first = useRef(true);

  // Розгортання 76 → 248px (єдина дозволена анімація layout-властивості), підписи з'являються стагером.
  useGSAP(() => {
    const node = root.current;
    if (!node) return;
    const width = expanded ? 248 : 76;
    if (first.current) { first.current = false; gsap.set(node, { width }); return; }
    const labels = node.querySelectorAll('[data-rail-label]');
    const mm = matchMotion((reduced) => {
      gsap.to(node, { width, duration: reduced ? 0.01 : 0.24, ease: 'expo.out' });
      if (expanded && !reduced) gsap.fromTo(labels, { opacity: 0 }, { opacity: 1, duration: 0.15, delay: 0.1, clearProps: 'opacity' });
    });
    return () => mm.revert();
  }, { dependencies: [expanded] });

  return (
    <nav ref={root} aria-label="Основна навігація" className="on-rail relative z-10 flex h-full shrink-0 flex-col justify-between overflow-hidden rounded-panel bg-rail py-5 text-rail-ink" style={{ width: 76 }}>
      <div className="flex flex-col gap-1 px-3">
        <div className={cn('mb-4 flex h-11 items-center gap-3 px-1.5', expanded ? 'justify-start' : 'justify-center')}>
          <span aria-hidden="true" className="inline-grid size-10 shrink-0 place-items-center rounded-full border border-rail-line text-[15px] font-medium">W</span>
          {expanded ? <span data-rail-label className="whitespace-nowrap text-[15px] font-medium">Work OS</span> : null}
        </div>
        {VIEWS.filter((view) => view.key !== 'settings').map((view) => (
          <RailButton key={view.key} label={view.label} icon={view.icon} active={active === view.key} expanded={expanded} onClick={() => onNavigate(view.key)} onPrefetch={onPrefetch ? () => onPrefetch(view.key) : undefined} badge={view.key === 'leads' && expanded ? leadCount : undefined} />
        ))}
      </div>
      <div className="flex flex-col gap-1 px-3">
        {expanded ? (
          <div className="mb-2 px-1.5">
            <button type="button" data-rail-label onClick={onOpenRelease} className="min-w-0 text-left text-[12px] leading-tight text-rail-ink-2 hover:text-rail-ink">
              <span className="block">v{APP_VERSION}</span>
              <span className="block truncate">Що змінилося</span>
            </button>
          </div>
        ) : null}
        <RailButton label="Налаштування" icon={VIEWS[VIEWS.length - 1].icon} active={active === 'settings'} expanded={expanded} onClick={() => onNavigate('settings')} />
        {canExpand ? (
          <RailButton label={expanded ? 'Згорнути' : 'Закріпити розгорнутою'} icon={expanded ? PanelLeftClose : PanelLeftOpen} active={false} expanded={expanded} onClick={() => setOpen(!expanded)} />
        ) : null}
      </div>
    </nav>
  );
}

function RailButton({ label, icon: Icon, active, expanded, onClick, onPrefetch, badge }: { label: string; icon: (typeof VIEWS)[number]['icon']; active: boolean; expanded: boolean; onClick: () => void; onPrefetch?: () => void; badge?: number }) {
  const button = (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      aria-label={label}
      onClick={onClick}
      onPointerEnter={onPrefetch}
      onFocus={onPrefetch}
      className={cn(
        'flex h-11 items-center gap-3 rounded-full px-[11px] transition-colors duration-200 active:scale-[0.985]',
        expanded ? 'w-full justify-start' : 'w-11 justify-center px-0',
        active ? 'bg-rail-ink text-rail' : 'text-rail-ink-2 hover:bg-rail-ink/10',
      )}
    >
      <Icon aria-hidden="true" strokeWidth={1.5} className="size-5 shrink-0" />
      {expanded ? <span data-rail-label className="flex-1 whitespace-nowrap text-left text-[14px] font-medium">{label}</span> : null}
      {badge !== undefined && badge > 0 ? <span data-rail-label className="font-mono text-[11px] opacity-70">{badge}</span> : null}
    </button>
  );
  return expanded ? button : <Tooltip content={label} side="right">{button}</Tooltip>;
}
