'use client';

import { useRef, useSyncExternalStore } from 'react';
import { Moon, PanelLeftClose, PanelLeftOpen, Sun } from 'lucide-react';
import { gsap, matchMotion, useGSAP } from '@/components/motion/gsap';
import { LiveOrb } from '@/components/shell/live-orb';
import { useTheme } from '@/components/shell/theme-provider';
import { VIEWS, type ViewKey } from '@/components/shell/views';
import { useLiveStatus } from '@/components/shell/use-live';
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
  onOpenRelease: () => void;
  onOpenService: () => void;
};

export function Rail({ active, leadCount, canExpand, onNavigate, onOpenRelease, onOpenService }: Props) {
  const stored = useRailOpen();
  const expanded = canExpand && stored;
  const root = useRef<HTMLElement>(null);
  const first = useRef(true);
  const { resolved, toggle } = useTheme();
  const { connected, runnerConnected } = useLiveStatus();

  // Розгортання 76 → 248px (єдина дозволена анімація layout-властивості), підписи з'являються стагером.
  useGSAP(() => {
    const node = root.current;
    if (!node) return;
    const width = expanded ? 248 : 76;
    if (first.current) { first.current = false; gsap.set(node, { width }); return; }
    const labels = node.querySelectorAll('[data-rail-label]');
    const mm = matchMotion((reduced) => {
      gsap.to(node, { width, duration: reduced ? 0.01 : 0.42, ease: 'expo.out' });
      if (expanded && !reduced) gsap.fromTo(labels, { opacity: 0 }, { opacity: 1, stagger: 0.02, duration: 0.3, delay: 0.1, clearProps: 'opacity' });
    });
    return () => mm.revert();
  }, { dependencies: [expanded] });

  const orbLabel = connected ? (runnerConnected ? 'Live-канал і runner на зв’язку' : 'Live-канал на зв’язку') : 'Live-канал офлайн, оновлення за таймером';

  return (
    <nav ref={root} aria-label="Основна навігація" className="on-rail relative z-10 flex h-full shrink-0 flex-col justify-between overflow-hidden rounded-panel bg-rail py-5 text-rail-ink" style={{ width: 76 }}>
      <div className="flex flex-col gap-1 px-3">
        <div className={cn('mb-4 flex h-11 items-center gap-3 px-1.5', expanded ? 'justify-start' : 'justify-center')}>
          <span aria-hidden="true" className="inline-grid size-10 shrink-0 place-items-center rounded-full border border-rail-line text-[15px] font-medium">W</span>
          {expanded ? <span data-rail-label className="whitespace-nowrap text-[15px] font-medium">Work OS</span> : null}
        </div>
        {VIEWS.filter((view) => view.key !== 'settings').map((view) => (
          <RailButton key={view.key} label={view.label} icon={view.icon} active={active === view.key} expanded={expanded} onClick={() => onNavigate(view.key)} badge={view.key === 'leads' && expanded ? leadCount : undefined} />
        ))}
      </div>
      <div className="flex flex-col gap-1 px-3">
        <div className={cn('mb-2 flex items-center gap-3 px-1.5', expanded ? 'justify-start' : 'justify-center')}>
          <Tooltip content={orbLabel} side="right">
            <button type="button" aria-label={`${orbLabel}. Відкрити сервіс`} onClick={onOpenService} className="inline-flex rounded-full active:scale-95"><LiveOrb size={36} /></button>
          </Tooltip>
          {expanded ? (
            <button type="button" data-rail-label onClick={onOpenRelease} className="min-w-0 text-left text-[12px] leading-tight text-rail-ink-2">
              <span className="block">v{APP_VERSION}</span>
              <span className="block truncate">Що змінилося</span>
            </button>
          ) : null}
        </div>
        <RailButton label={resolved === 'day' ? 'Тема: День' : 'Тема: Ніч'} icon={resolved === 'day' ? Sun : Moon} active={false} expanded={expanded} onClick={toggle} />
        <RailButton label="Налаштування" icon={VIEWS[VIEWS.length - 1].icon} active={active === 'settings'} expanded={expanded} onClick={() => onNavigate('settings')} />
        {canExpand ? (
          <RailButton label={expanded ? 'Згорнути' : 'Закріпити розгорнутою'} icon={expanded ? PanelLeftClose : PanelLeftOpen} active={false} expanded={expanded} onClick={() => setOpen(!expanded)} />
        ) : null}
      </div>
    </nav>
  );
}

function RailButton({ label, icon: Icon, active, expanded, onClick, badge }: { label: string; icon: (typeof VIEWS)[number]['icon']; active: boolean; expanded: boolean; onClick: () => void; badge?: number }) {
  const button = (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      aria-label={label}
      onClick={onClick}
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
