'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { gsap, useGSAP } from '@/components/motion/gsap';
import { Draggable } from '@/components/motion/draggable';
import { Flip } from '@/components/motion/flip';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { FUNNEL_STAGES } from '@/lib/leads/domain/validation';
import { cn } from '@/lib/utils';
import { labels, type LeadList } from './client';

export type LeadRow = LeadList['leads'][number];

export function agoLabel(responseDate: string | null): string {
  if (!responseDate) return 'без дати';
  const days = Math.floor((Date.now() - Date.parse(`${responseDate}T12:00:00Z`)) / 86_400_000);
  if (days <= 0) return 'сьогодні';
  if (days === 1) return 'вчора';
  return `${days} дн. тому`;
}

/**
 * Дошка за реальними етапами воронки. Перетягування (миша й стилус): картка нахиляється на 2.5°,
 * колонка-ціль підсвічується, інші картки перебудовуються через Flip. Скидання оптимістичне, з відкатом.
 * На телефоні дошка — стрічка колонок зі scroll-snap; етап змінюється в картці ліда.
 */
export function LeadBoard({ leads, selectedId, canDrag, onOpen, onCreate, onMove }: {
  leads: LeadRow[];
  selectedId: string | null;
  canDrag: boolean;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onMove: (leadId: string, stage: string) => Promise<void>;
}) {
  const board = useRef<HTMLDivElement>(null);
  const flip = useRef<ReturnType<typeof Flip.getState> | null>(null);
  const toast = useToast();
  const [seen, setSeen] = useState(leads);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  if (seen !== leads) { setSeen(leads); setOverrides({}); }

  const stageOf = (lead: LeadRow) => overrides[lead.id] ?? lead.funnelStage;
  const signature = leads.map((lead) => `${lead.id}:${stageOf(lead)}`).join('|');

  useLayoutEffect(() => {
    if (!flip.current) return;
    const state = flip.current;
    flip.current = null;
    Flip.from(state, { duration: 0.35, ease: 'power3.out' });
  });

  const capture = () => {
    flip.current = Flip.getState(board.current?.querySelectorAll('[data-lead-card]') ?? []);
  };

  useGSAP(() => {
    const root = board.current;
    if (!root || !canDrag) return;
    const cards = gsap.utils.toArray<HTMLElement>('[data-lead-card]', root);
    const columnAt = (x: number, y: number) => document.elementsFromPoint(x, y).find((node) => node instanceof HTMLElement && node.dataset.stageCol !== undefined) as HTMLElement | undefined;
    const clearOver = () => root.querySelectorAll('[data-over]').forEach((node) => node.removeAttribute('data-over'));
    const instances = cards.map((card) => Draggable.create(card, {
      type: 'x,y',
      zIndexBoost: true,
      dragClickables: true,
      minimumMovement: 6,
      onPress: () => { gsap.to(card, { rotation: 2.5, scale: 1.02, duration: 0.18 }); card.classList.add('shadow-float'); },
      onDrag: function () {
        clearOver();
        const column = columnAt(this.pointerX, this.pointerY);
        if (column && column.dataset.stageCol !== card.dataset.stage) column.setAttribute('data-over', 'true');
      },
      onRelease: () => { gsap.to(card, { rotation: 0, scale: 1, duration: 0.18 }); card.classList.remove('shadow-float'); },
      onClick: () => onOpen(card.dataset.leadId ?? ''),
      onDragEnd: function () {
        const target = columnAt(this.pointerX, this.pointerY)?.dataset.stageCol;
        clearOver();
        const leadId = card.dataset.leadId ?? '';
        const from = card.dataset.stage ?? '';
        if (!target || target === from) { gsap.to(card, { x: 0, y: 0, duration: 0.35, ease: 'expo.out' }); return; }
        capture();
        gsap.set(card, { x: 0, y: 0, rotation: 0, scale: 1 });
        setOverrides((current) => ({ ...current, [leadId]: target }));
        onMove(leadId, target).catch((reason: unknown) => {
          capture();
          setOverrides((current) => { const next = { ...current }; delete next[leadId]; return next; });
          toast.push({ message: reason instanceof Error ? reason.message : 'Не вдалося змінити етап.', tone: 'hot' });
        });
      },
    })[0]);
    return () => instances.forEach((instance) => instance.kill());
  }, { scope: board, dependencies: [signature, canDrag] });

  return (
    <div ref={board} className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-3 hide-scrollbar md:snap-none" aria-label="Дошка лідів">
      {FUNNEL_STAGES.map((stage) => {
        const items = leads.filter((lead) => stageOf(lead) === stage);
        return (
          <section key={stage} data-stage-col={stage} aria-label={labels[stage]} className="flex w-[78vw] shrink-0 snap-start flex-col gap-2 rounded-card border border-line bg-sunken p-2.5 transition-colors duration-200 data-[over=true]:border-line-strong data-[over=true]:bg-raised md:w-[272px]">
            <header className="flex items-center justify-between gap-2 px-2 pb-1 pt-1.5">
              <h3 className="m-0 text-sm font-medium">{labels[stage]}</h3>
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-raised px-1.5 font-mono text-[11px] text-ink-2">{items.length}</span>
            </header>
            <ul className="m-0 flex min-h-12 list-none flex-col gap-2 p-0">
              {items.map((lead) => (
                <li key={lead.id}>
                  <div
                    data-lead-card=""
                    data-lead-id={lead.id}
                    data-stage={stage}
                    data-flip-id={lead.id}
                    className={cn('cv-auto relative flex flex-col gap-2 rounded-inner border bg-solid p-3 text-left transition-colors duration-200', selectedId === lead.id ? 'border-line-strong' : 'border-line', canDrag ? 'cursor-grab touch-none active:cursor-grabbing' : '')}
                  >
                    <button type="button" onClick={(event) => { if (!canDrag || event.detail === 0) onOpen(lead.id); }} className="flex items-start gap-3 text-left outline-offset-4" aria-label={`Відкрити ліда ${lead.name}`}>
                      <Avatar name={lead.name} size={36} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="min-w-0 truncate text-sm font-medium">{lead.name}</span>
                          {lead.overdue ? <i aria-label="Прострочено" className="size-1.5 shrink-0 rounded-full bg-hot" /> : null}
                        </span>
                        <span className="block truncate text-xs text-ink-2">{lead.subject || 'Предмет не вказано'}</span>
                      </span>
                    </button>
                    {lead.nextAction ? <p className="m-0 line-clamp-1 text-xs text-ink-2">{lead.nextAction}</p> : null}
                    <div className="flex items-center justify-between gap-2 text-[11px] text-ink-3">
                      <span>{labels[lead.platform] ?? lead.platform}{lead.qualification ? ` · ${lead.qualification}` : ''}</span>
                      <span className="font-mono">{agoLabel(lead.responseDate)}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            {stage === 'response' ? (
              <Button variant="ghost" size="sm" className="justify-start" onClick={onCreate}><Plus aria-hidden="true" strokeWidth={1.5} />Додати ліда</Button>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
