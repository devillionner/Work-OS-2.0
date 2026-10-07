'use client';

import { useState } from 'react';
import { Check, Copy, Gauge, Layers, Send, Target, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type PlatformLinkItem = { id?: string; name?: string; link?: string };
export type PublicationPace = { ratePerHour: number; completed: number; target: number };

export function PlatformOverview({
  pace,
  available,
  joined,
  published,
}: {
  pace?: PublicationPace;
  available?: PlatformLinkItem[];
  joined?: PlatformLinkItem[];
  published?: PlatformLinkItem[];
}) {
  const safePace = pace ?? { ratePerHour: 0, completed: 0, target: 0 };
  const safeJoined = joined ?? [];
  const safePublished = published ?? [];

  return (
    <section className={`platform-overview ${available ? 'has-available' : ''}`} aria-label="Сьогоднішній стан">
      <DailyStat label="Темп" value={`${safePace.ratePerHour}/год`} icon={<Gauge className="size-3.5" />} />
      <DailyStat label="Ціль" value={`${safePace.completed} / ${safePace.target}`} icon={<Target className="size-3.5" />} />
      {available && <DailyLinkStat label="Доступні" items={available} icon={<Layers className="size-3.5" />} />}
      <DailyLinkStat label="Приєднано" items={safeJoined} icon={<UserPlus className="size-3.5" />} />
      <DailyLinkStat label="Опубліковано" items={safePublished} icon={<Send className="size-3.5" />} />
    </section>
  );
}

function DailyStat({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="platform-stat">
      <span className="platform-stat-label">
        {icon}
        {label}
      </span>
      <strong className="platform-stat-value">{value}</strong>
    </div>
  );
}

function DailyLinkStat({ label, items, icon }: { label: string; items: PlatformLinkItem[]; icon?: React.ReactNode }) {
  const [copiedLinks, setCopiedLinks] = useState(false);
  const [copiedNames, setCopiedNames] = useState(false);

  async function copy(names: boolean) {
    if (!items.length) return;
    const lines = items.flatMap((item, index) => [
      `${names && item.name ? `${item.name} — ` : ''}${item.link || ''}`,
      ...((index + 1) % 5 === 0 && index < items.length - 1 ? [''] : []),
    ]);
    await navigator.clipboard.writeText(lines.join('\n'));
    if (names) {
      setCopiedNames(true);
      setTimeout(() => setCopiedNames(false), 1800);
    } else {
      setCopiedLinks(true);
      setTimeout(() => setCopiedLinks(false), 1800);
    }
  }

  return (
    <div className="platform-stat has-actions">
      <span className="platform-stat-label">
        {icon}
        {label}
      </span>
      <strong className="platform-stat-value">{items.length}</strong>
      <div className="platform-stat-actions">
        <Button
          variant="ghost"
          size="icon"
          title={`Копіювати посилання · ${label}`}
          aria-label={`Копіювати посилання · ${label}`}
          onClick={() => void copy(false)}
          disabled={!items.length}
          className={copiedLinks ? 'is-copied' : ''}
        >
          {copiedLinks ? <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="size-3.5" />}
        </Button>
        <Button
          className={`platform-stat-names ${copiedNames ? 'is-copied' : ''}`}
          variant="ghost"
          size="sm"
          title={`Копіювати назви й посилання · ${label}`}
          onClick={() => void copy(true)}
          disabled={!items.length}
        >
          {copiedNames ? (
            <>
              <Check className="size-3 text-emerald-600 dark:text-emerald-400" />
              Скопійовано
            </>
          ) : (
            'З назвами'
          )}
        </Button>
      </div>
    </div>
  );
}
