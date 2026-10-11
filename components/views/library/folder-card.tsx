'use client';

import { Plus } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { cleanLibraryPlatforms } from '@/lib/library';
import { displayPlatforms, platformLabel, type Item } from './types';

/** Картка матеріалу: платформи або версія праворуч угорі, два рядки опису, «Відкрити» й копіювання UA/RU одним кліком. */
export function FolderCard({ item, onOpen, onCopy }: { item: Item; onOpen: () => void; onCopy: (language: 'uk' | 'ru') => void }) {
  const ad = item.collection === 'advertisement';
  const missing = ad && (!item.ukText.trim() || !item.ruText.trim()) ? (item.ukText.trim() ? 'RU' : 'UA') : null;
  const used = cleanLibraryPlatforms(item.usedTodayPlatforms);
  const platforms = displayPlatforms(item.platforms);
  return (
    <li>
      <Surface variant="glass" radius="card" lift data-reveal className="flex h-full min-h-[224px] flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="m-0 line-clamp-2 text-[15px] font-medium leading-snug">{item.title}</h3>
          {ad ? (
            <span className="flex shrink-0 -space-x-2" aria-label={`Платформи: ${platforms.map(platformLabel).join(', ')}`}>
              {platforms.slice(0, 3).map((value) => <Avatar key={value} name={platformLabel(value)} size={28} className="ring-2 ring-[var(--solid)]" />)}
              {platforms.length > 3 ? <Avatar name={`+${platforms.length - 3}`} size={28} className="ring-2 ring-[var(--solid)]" /> : null}
            </span>
          ) : (
            <Badge className="shrink-0" aria-label={`Версія ${item.version}`}>v{item.version}</Badge>
          )}
        </div>
        <p className="m-0 line-clamp-2 text-[13px] text-ink-2">{item.ukText || item.ruText}</p>
        <div className="flex flex-col gap-1 text-xs text-ink-2">
          {missing ? <Badge tone="warn">Додай {missing} версію перед наступним збереженням</Badge> : null}
          {used.length ? <span>Сьогодні: {used.map(platformLabel).join(', ')}</span> : null}
          {item.tags.length ? <span className="truncate">{item.tags.slice(0, 3).map((tag) => `#${tag}`).join(' ')}{item.tags.length > 3 ? ` +${item.tags.length - 3}` : ''}</span> : null}
          {ad ? <span className="font-mono">v{item.version}</span> : null}
        </div>
        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          <Button variant="action" size="sm" onClick={onOpen}>Відкрити</Button>
          {item.ukText.trim() && item.ruText.trim() ? (
            <span className="flex items-center gap-0.5">
              <Button variant="ghost" size="sm" onClick={() => onCopy('uk')}>Копіювати UA</Button>
              <Button variant="ghost" size="sm" aria-label="Копіювати RU" onClick={() => onCopy('ru')}>RU</Button>
            </span>
          ) : item.ukText.trim() || item.ruText.trim() ? (
            <Button variant="ghost" size="sm" onClick={() => onCopy(item.ukText.trim() ? 'uk' : 'ru')}>Копіювати</Button>
          ) : null}
        </div>
      </Surface>
    </li>
  );
}

/** Остання «картка» сітки: пунктирний контур «+ Додати». */
export function AddCard({ onClick }: { onClick: () => void }) {
  return (
    <li>
      <button type="button" onClick={onClick} className="flex h-full min-h-[224px] w-full flex-col items-center justify-center gap-2 rounded-card border border-dashed border-line-strong text-ink-2 transition-colors duration-200 hover:bg-raised hover:text-ink active:scale-[0.985]">
        <Plus aria-hidden="true" strokeWidth={1.5} className="size-6" />
        <span className="text-sm font-medium">Додати</span>
      </button>
    </li>
  );
}
