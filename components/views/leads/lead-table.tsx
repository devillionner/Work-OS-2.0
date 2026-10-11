'use client';

import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';
import { labels } from './client';
import { agoLabel, type LeadRow } from './lead-board';

type SortKey = 'name' | 'funnelStage' | 'nextContactAt' | 'responseDate';

/** Щільна таблиця лідів: липкий заголовок і сортування по поточній сторінці. */
export function LeadTable({ leads, selectedId, onOpen }: { leads: LeadRow[]; selectedId: string | null; onOpen: (id: string) => void }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);
  const rows = useMemo(() => {
    if (!sort) return leads;
    const value = (lead: LeadRow): string | number => sort.key === 'nextContactAt' ? (lead.nextContactAt ?? Number.MAX_SAFE_INTEGER) : (lead[sort.key] ?? '');
    return [...leads].sort((a, b) => {
      const left = value(a); const right = value(b);
      return (typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right), 'uk')) * sort.dir;
    });
  }, [leads, sort]);

  const header = (key: SortKey, label: string, className?: string) => (
    <th scope="col" aria-sort={sort?.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} className={cn('sticky top-0 z-10 bg-glass-strong px-3 py-2.5 text-left text-xs font-medium text-ink-2 first:rounded-tl-inner last:rounded-tr-inner', className)}>
      <button type="button" onClick={() => setSort((current) => (current?.key === key ? { key, dir: current.dir === 1 ? -1 : 1 } : { key, dir: 1 }))} className="inline-flex items-center gap-1 hover:text-ink">
        {label}
        {sort?.key === key ? (sort.dir === 1 ? <ArrowUp aria-hidden="true" strokeWidth={1.5} className="size-3" /> : <ArrowDown aria-hidden="true" strokeWidth={1.5} className="size-3" />) : null}
      </button>
    </th>
  );

  if (!rows.length) return <EmptyState text="Лідів за цим фільтром немає." />;
  return (
    <div className="overflow-x-auto rounded-card border border-line">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr>
            {header('name', 'Ім’я')}
            <th scope="col" className="sticky top-0 z-10 bg-glass-strong px-3 py-2.5 text-left text-xs font-medium text-ink-2">Предмет</th>
            {header('funnelStage', 'Етап')}
            <th scope="col" className="sticky top-0 z-10 bg-glass-strong px-3 py-2.5 text-left text-xs font-medium text-ink-2">Наступна дія</th>
            {header('nextContactAt', 'Термін')}
            {header('responseDate', 'Відгук', 'text-right')}
          </tr>
        </thead>
        <tbody>
          {rows.map((lead) => (
            <tr key={lead.id} className={cn('relative border-t border-line transition-colors hover:bg-raised', selectedId === lead.id && 'bg-raised')}>
              <td className="px-3 py-2.5">
                <button type="button" onClick={() => onOpen(lead.id)} className="flex items-center gap-3 text-left after:absolute after:inset-0" aria-label={`Відкрити ліда ${lead.name}`}>
                  <Avatar name={lead.name} size={32} />
                  <span className="min-w-0">
                    <span className="block max-w-[200px] truncate font-medium">{lead.name}</span>
                    <span className="block text-xs text-ink-2">{labels[lead.platform] ?? lead.platform}</span>
                  </span>
                </button>
              </td>
              <td className="max-w-[180px] truncate px-3 py-2.5 text-ink-2">{lead.subject || '—'}</td>
              <td className="px-3 py-2.5"><span className="inline-flex rounded-full border border-line px-2.5 py-0.5 text-xs">{labels[lead.funnelStage]}{lead.qualification ? ` · ${lead.qualification}` : ''}</span></td>
              <td className="max-w-[220px] truncate px-3 py-2.5 text-ink-2">{lead.nextAction || '—'}</td>
              <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs">
                <span className="inline-flex items-center gap-2">{lead.overdue ? <i aria-label="Прострочено" className="size-1.5 rounded-full bg-hot" /> : null}{lead.nextContactAt ? new Intl.DateTimeFormat('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' }).format(new Date(lead.nextContactAt * 1000)) : '—'}</span>
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs text-ink-2">{agoLabel(lead.responseDate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
