'use client';

import { X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const COMPACT_ON = 48;
const COMPACT_OFF = 8;
const MIN_OVERFLOW = 120;

/**
 * Каркас панелі деталей: заголовок і вкладки лишаються над прокручуваною областю (вміст ніколи не залазить під них),
 * вміст перемикається коротким crossfade за `contentKey`, а прокрутка при цьому стає на початок.
 * Під скролом заголовок стискається, лише якщо вмісту достатньо, щоб стиск не змінив межі прокрутки.
 */
export function Inspector({ title, subtitle, actions, tabs, onClose, contentKey, children, className }: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
  onClose: () => void;
  contentKey?: string;
  children: ReactNode;
  className?: string;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);

  useEffect(() => { scroll.current?.scrollTo({ top: 0 }); }, [contentKey]);

  const onScroll = () => {
    const node = scroll.current;
    if (!node) return;
    const overflow = node.scrollHeight - node.clientHeight;
    if (!compact && node.scrollTop > COMPACT_ON && overflow > MIN_OVERFLOW) setCompact(true);
    else if (compact && node.scrollTop < COMPACT_OFF) setCompact(false);
  };

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      <header className={cn('flex shrink-0 items-start justify-between gap-3 px-5 transition-[padding] duration-150', compact ? 'pb-2 pt-3' : 'pb-3 pt-5')}>
        <div className="min-w-0">
          <h2 className="m-0 truncate text-[17px] font-medium">{title}</h2>
          {subtitle && !compact ? <p className="m-0 mt-1 truncate text-[13px] text-ink-2">{subtitle}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {actions}
          <Button variant="icon" size="md" aria-label="Закрити" onClick={onClose}><X aria-hidden="true" strokeWidth={1.5} /></Button>
        </div>
      </header>
      {tabs ? <div className="shrink-0 border-b border-line px-5 pb-3">{tabs}</div> : <div className="shrink-0 border-b border-line" />}
      <div ref={scroll} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 pt-4">
        <div key={contentKey} className="tab-fade">{children}</div>
      </div>
    </div>
  );
}
