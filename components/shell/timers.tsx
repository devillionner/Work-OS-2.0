'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { BellRing, Check, Clock3, Plus, X } from 'lucide-react';
import { useCommand } from '@/components/shell/command-bus';
import { announcedTimers, dismissTimer, formatTimerDuration, splitTimers, startTimer, syncTimers, useTimers, type TimerItem, type TimerPlatform } from '@/components/shell/timers-store';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';

const PLATFORM_OPTIONS: Array<{ key: TimerPlatform; label: string }> = [
  { key: 'telegram', label: 'Telegram' }, { key: 'whatsapp', label: 'WhatsApp' }, { key: 'viber', label: 'Viber' },
  { key: 'facebook', label: 'Facebook' }, { key: 'general', label: 'Загальний' },
];

/**
 * Таймери в Topbar. Дані читаються один раз при відкритті застосунку, при поверненні у вкладку, при
 * відновленні мережі й при відкритті меню; секундний відлік локальний і нічого не запитує.
 */
export function TimersButton({ enabledPlatforms, viewKey }: { enabledPlatforms: string[]; viewKey: string }) {
  const { timers, now, error, busy } = useTimers();
  const [open, setOpen] = useState(false);
  const [selectedPlatform, setPlatform] = useState<TimerPlatform>('telegram');
  const [selectedDuration, setDuration] = useState(15);
  const previousViewKey = useRef(viewKey);
  const audioContext = useRef<AudioContext | null>(null);

  const platformOptions = useMemo(() => PLATFORM_OPTIONS.filter((item) => item.key === 'general' || enabledPlatforms.includes(item.key)), [enabledPlatforms]);
  const platform = platformOptions.some((item) => item.key === selectedPlatform) ? selectedPlatform : (platformOptions[0]?.key ?? 'general');
  const duration = platform === 'telegram' ? 15 : selectedDuration;
  const { running, completed } = splitTimers(timers, now);
  const nearest = running.reduce<TimerItem | null>((best, timer) => (!best || timer.endsAt < best.endsAt ? timer : best), null);

  useEffect(() => {
    for (const timer of completed) {
      if (announcedTimers.has(timer.id)) continue;
      announcedTimers.add(timer.id);
      playAlarm(audioContext.current);
      queueMicrotask(() => setOpen(true));
    }
  }, [completed]);

  useEffect(() => {
    if (previousViewKey.current === viewKey) return;
    previousViewKey.current = viewKey;
    queueMicrotask(() => setOpen(false));
  }, [viewKey]);

  useCommand('timers:open', () => setOpen(true));

  async function start() {
    if (!audioContext.current) audioContext.current = new AudioContext();
    if (audioContext.current.state === 'suspended') await audioContext.current.resume();
    await startTimer(platform, duration);
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) return;
    if (!audioContext.current) audioContext.current = new AudioContext();
    if (audioContext.current.state === 'suspended') void audioContext.current.resume().catch(() => {});
    syncTimers(true);
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger render={<Button variant="outline" size="md" aria-label="Таймери" className={cn('font-mono', completed.length > 0 && 'border-hot text-hot')} />}>
        <Clock3 aria-hidden="true" strokeWidth={1.5} />
        <span className={nearest ? undefined : 'max-md:sr-only'}>{nearest ? formatTimerDuration(nearest.endsAt - now) : 'Таймери'}</span>
        {timers.length > 0 ? <Badge>{timers.length}</Badge> : null}
      </PopoverTrigger>
      <PopoverContent label="Таймери">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            <Select aria-label="Платформа таймера" value={platform} onChange={(event) => { const next = event.target.value as TimerPlatform; setPlatform(next); if (next === 'telegram') setDuration(15); }}>
              {platformOptions.map((item) => <option value={item.key} key={item.key}>{item.label}</option>)}
            </Select>
            <div className="flex items-center justify-between gap-3">
              <Segmented label="Тривалість" size="sm" value={String(duration)} onValueChange={(value) => { if (platform !== 'telegram') setDuration(Number(value)); }} items={[5, 10, 15].map((value) => ({ value: String(value), label: `${value} хв` }))} />
              <Button variant="action" size="sm" busy={busy} onClick={() => void start()}><Plus aria-hidden="true" strokeWidth={1.5} />Запустити</Button>
            </div>
          </div>
          {error ? <p role="alert" className="m-0 text-xs text-hot">{error}</p> : null}
          <ul className="m-0 flex max-h-72 list-none flex-col gap-2 overflow-y-auto p-0">
            {completed.map((timer) => <TimerRow key={timer.id} timer={timer} now={now} completed onDismiss={() => void dismissTimer(timer.id)} />)}
            {running.map((timer) => <TimerRow key={timer.id} timer={timer} now={now} onDismiss={() => void dismissTimer(timer.id)} />)}
          </ul>
          {!timers.length ? <EmptyState text="Тут з’являться запущені таймери. Вони працюють після переходів і перезавантаження сторінки." /> : <p className="m-0 text-xs text-ink-2">Звук лунає, поки застосунок відкритий.</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function TimerRow({ timer, now, completed = false, onDismiss }: { timer: TimerItem; now: number; completed?: boolean; onDismiss: () => void }) {
  const left = Math.max(0, timer.endsAt - now);
  const elapsed = Math.min(timer.durationSeconds, Math.max(0, now - timer.startedAt));
  const progress = completed ? 1 : elapsed / timer.durationSeconds;
  return (
    <li className={cn('flex items-center gap-3 rounded-inner border px-3 py-2.5', completed ? 'border-hot/50' : 'border-line')}>
      <span aria-hidden="true" className="inline-grid size-9 shrink-0 place-items-center rounded-full bg-sunken">
        {completed ? <BellRing strokeWidth={1.5} className="size-4 text-hot" /> : <Clock3 strokeWidth={1.5} className="size-4 text-ink-2" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="m-0 truncate text-sm font-medium">{timer.label}</p>
        <p className="m-0 font-mono text-xs text-ink-2">{completed ? 'Час завершився' : formatTimerDuration(left)}</p>
        <div aria-hidden="true" className="mt-1.5 h-0.5 overflow-hidden rounded-full bg-line">
          <div className="h-full origin-left rounded-full bg-ink" style={{ transform: `scaleX(${progress})`, transition: 'transform 1s linear' }} />
        </div>
      </div>
      <Button variant="icon" size="sm" aria-label={completed ? 'Підтвердити завершення' : 'Скасувати таймер'} onClick={onDismiss}>
        {completed ? <Check aria-hidden="true" strokeWidth={1.5} /> : <X aria-hidden="true" strokeWidth={1.5} />}
      </Button>
    </li>
  );
}

function playAlarm(context: AudioContext | null) {
  if (!context || context.state !== 'running') return;
  const start = context.currentTime;
  [0, 0.28, 0.56].forEach((delay) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, start + delay);
    gain.gain.exponentialRampToValueAtTime(0.16, start + delay + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + delay + 0.18);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start + delay);
    oscillator.stop(start + delay + 0.2);
  });
}
