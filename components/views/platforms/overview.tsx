'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Ring } from '@/components/ui/ring';
import { Surface } from '@/components/ui/surface';
import { goalTone } from '@/components/ui/ring';
import { dayProgress } from '@/components/views/shared/pace';

export type PlatformLinkItem = { id?: string; name?: string; link?: string };
export type PublicationPace = { completed: number; target: number };

/** Огляд платформи: ціль публікацій, приєднані й опубліковані сьогодні (з копіюванням посилань). */
export function PlatformOverview({ pace, available, joined, published }: { pace?: PublicationPace; available?: PlatformLinkItem[]; joined?: PlatformLinkItem[]; published?: PlatformLinkItem[] }) {
  const safe = pace ?? { completed: 0, target: 0 };
  const ratio = safe.target > 0 ? safe.completed / safe.target : 0;
  return (
    <section aria-label="Сьогоднішній стан" className="grid gap-3 @xl:grid-cols-2 @4xl:grid-cols-3">
      <Surface variant="glass" radius="card" className="flex items-center gap-4 p-4 @xl:col-span-2 @4xl:col-span-1">
        <Ring value={ratio} tone={safe.target > 0 ? goalTone(ratio, dayProgress()) : 'ink'} size={64} stroke={5} label={`Ціль публікацій: ${safe.completed} із ${safe.target}`}>{Math.round(ratio * 100)}%</Ring>
        <div className="min-w-0">
          <p className="m-0 text-[13px] text-ink-2">Ціль публікацій</p>
          <p className="m-0 font-mono text-[28px] leading-tight">{safe.completed} <span className="text-base text-ink-2">/ {safe.target}</span></p>
        </div>
      </Surface>
      {available ? <LinkStat label="Доступні для публікації" items={available} /> : null}
      <LinkStat label="Приєднано сьогодні" items={joined ?? []} />
      <LinkStat label="Опубліковано сьогодні" items={published ?? []} />
    </section>
  );
}

function LinkStat({ label, items }: { label: string; items: PlatformLinkItem[] }) {
  const [copied, setCopied] = useState<'links' | 'names' | null>(null);
  async function copy(names: boolean) {
    if (!items.length) return;
    const lines = items.flatMap((item, index) => [`${names && item.name ? `${item.name} — ` : ''}${item.link || ''}`, ...((index + 1) % 5 === 0 && index < items.length - 1 ? [''] : [])]);
    await navigator.clipboard.writeText(lines.join('\n'));
    setCopied(names ? 'names' : 'links');
    setTimeout(() => setCopied(null), 1800);
  }
  return (
    <Surface variant="glass" radius="card" className="flex flex-col justify-between gap-3 p-4">
      <div><p className="m-0 text-[13px] text-ink-2">{label}</p><p className="m-0 font-mono text-[28px] leading-tight">{items.length}</p></div>
      <div className="flex gap-1.5">
        <Button variant="outline" size="sm" disabled={!items.length} aria-label={`Копіювати посилання · ${label}`} onClick={() => void copy(false)}>{copied === 'links' ? <><Check aria-hidden="true" strokeWidth={1.5} />Скопійовано</> : <><Copy aria-hidden="true" strokeWidth={1.5} />Посилання</>}</Button>
        <Button variant="ghost" size="sm" disabled={!items.length} title={`Копіювати назви й посилання · ${label}`} onClick={() => void copy(true)}>{copied === 'names' ? 'Скопійовано' : 'З назвами'}</Button>
      </div>
    </Surface>
  );
}
