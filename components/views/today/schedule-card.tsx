'use client';

import { useEffect, useRef, useState } from 'react';
import { Archive, Check } from 'lucide-react';
import { emitCommand } from '@/components/shell/command-bus';
import { useShell } from '@/components/shell/shell-context';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Ghost } from '@/components/ui/ghost';
import { Surface } from '@/components/ui/surface';
import { useToast } from '@/components/ui/toast';
import { ArchiveReasonDialog } from '@/components/views/platforms/archive-reason-dialog';
import { useTelegramAccounts } from '@/components/views/platforms/telegram-accounts';
import { telegramSchedule, useTelegramSchedule, type ScheduleSlot } from '@/components/views/platforms/telegram-schedule-store';
import { isMissed, nextPending, slotTime } from '@/components/views/today/schedule-slots';
import { cn } from '@/lib/utils';

/**
 * Розклад Telegram на сьогодні: вертикальний список слотів із позначкою «зараз»; найближчий слот підсвічений, а список
 * при відкритті гортається до нього. Повне керування розкладом — «Платформи → Telegram → Розклад».
 */
export function ScheduleCard({ className }: { className?: string }) {
  const { snapshot, navigate } = useShell();
  const toast = useToast();
  const enabled = snapshot.enabledPlatforms.includes('telegram');
  const { accountId, loaded, error: accountError } = useTelegramAccounts(enabled);
  const { snapshot: schedule, loading, error, busy } = useTelegramSchedule(enabled ? accountId : null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [archiveSlot, setArchiveSlot] = useState<ScheduleSlot | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const marker = useRef<HTMLLIElement>(null);

  // Лінія «зараз» зсувається локально раз на хвилину; до мережі це не звертається.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const slots = schedule?.slots ?? [];
  const nowIndex = slots.findIndex((slot) => slot.scheduledAt > now);
  const markerAt = nowIndex === -1 ? slots.length : nowIndex;
  const next = nextPending(slots, now);

  // Список відкривається на «зараз», а не на початку дня.
  useEffect(() => {
    if (list.current && marker.current) list.current.scrollTop = Math.max(0, marker.current.offsetTop - 28);
  }, [markerAt, slots.length]);

  async function markPublished(slot: ScheduleSlot) {
    if (!accountId) return;
    const ok = await telegramSchedule.markPublished(accountId, slot);
    if (ok) toast.push({ message: `Публікацію в «${slot.chatName || 'чаті'}» відмічено.` });
  }

  if (!enabled) return null;

  const openSchedule = () => { navigate('platforms'); emitCommand('platforms:telegram-schedule'); };

  return (
    <Surface variant="glass" radius="card" data-reveal className={cn('@container flex min-w-0 flex-col gap-3 p-5', className)} aria-labelledby="schedule-title">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="schedule-title" className="m-0 text-[17px] font-medium">Розклад Telegram</h2>
        <div className="flex items-center gap-3">
          {schedule && slots.length ? <span className="font-mono text-sm tabular-nums text-ink-2">{schedule.completed}/{schedule.completed + schedule.pending}</span> : null}
          <Button variant="ghost" size="sm" onClick={openSchedule}>Керувати</Button>
        </div>
      </div>

      {accountError || error ? <p role="alert" className="m-0 text-sm text-hot">{accountError || error}</p> : null}

      {!loaded || (loading && !schedule) ? (
        <div className="flex flex-col gap-2" aria-busy="true">{[0, 1, 2].map((item) => <Ghost key={item} className="h-11 rounded-inner" />)}</div>
      ) : !accountId ? (
        <EmptyState text="Додай робочий Telegram-акаунт у «Платформи», і тут з’явиться розклад." action={<Button variant="outline" size="sm" onClick={() => navigate('platforms')}>Відкрити платформи</Button>} />
      ) : !slots.length ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="m-0 text-sm text-ink-2">Розклад на сьогодні не створено.</p>
          <Button variant="outline" size="sm" onClick={openSchedule}>Створити</Button>
        </div>
      ) : (
        <ol ref={list} aria-label="Слоти публікацій" className="hide-scrollbar relative m-0 flex max-h-[24rem] list-none flex-col overflow-y-auto p-0">
          {slots.map((slot, index) => {
            const missed = isMissed(slot, now);
            const free = slot.chatId === null && slot.status === 'pending';
            return (
              <li key={slot.id} ref={index === markerAt ? marker : undefined} className="flex flex-col">
                {index === markerAt ? <NowLine /> : null}
                <div className={cn('flex min-h-11 items-center gap-3 rounded-inner px-2 py-1.5', slot.status === 'completed' && 'opacity-60', next?.id === slot.id && 'bg-raised')}>
                  <span className="w-12 shrink-0 font-mono text-sm tabular-nums">{slotTime(slot.scheduledAt)}</span>
                  <span className={cn('min-w-0 flex-1 truncate text-sm', free ? 'text-ink-3' : 'text-ink-2')} title={slot.chatName ?? undefined}>{slot.chatName || (free ? 'Вільний слот' : 'Чат не призначено')}</span>
                  {slot.status === 'completed' ? <span className="flex shrink-0 items-center gap-1 text-xs text-ok"><i aria-hidden="true" className="size-1.5 rounded-full bg-ok" />Готово</span> : null}
                  {missed ? <span className="flex shrink-0 items-center gap-1 text-xs text-hot"><i aria-hidden="true" className="size-1.5 rounded-full bg-hot" />Пропущено</span> : null}
                  {slot.status === 'pending' && slot.chatId ? (
                    <span className="flex shrink-0 items-center gap-1">
                      <Button variant="outline" size="sm" busy={busy} disabled={!slot.chatStateToken} title="Відмітити публікацію" aria-label={`Відмітити публікацію о ${slotTime(slot.scheduledAt)}`} onClick={() => void markPublished(slot)} className="@max-md:w-11 @max-md:px-0"><Check aria-hidden="true" strokeWidth={1.5} /><span className="sr-only @md:not-sr-only">Готово</span></Button>
                      <Button variant="icon" size="sm" aria-label="Перенести чат в архів" title="Перенести чат в архів" disabled={busy} onClick={() => setArchiveSlot(slot)}><Archive aria-hidden="true" strokeWidth={1.5} /></Button>
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
          {markerAt === slots.length ? <li ref={marker} className="flex flex-col"><NowLine /></li> : null}
        </ol>
      )}

      <ArchiveReasonDialog
        open={archiveSlot !== null}
        chatName={archiveSlot?.chatName ?? null}
        busy={busy}
        error={error}
        onCancel={() => setArchiveSlot(null)}
        onConfirm={(reason) => {
          const slot = archiveSlot;
          if (!slot || !accountId) return;
          void telegramSchedule.archiveSlot(accountId, slot, reason).then((nextSnapshot) => {
            if (nextSnapshot) { setArchiveSlot(null); toast.push({ message: 'Чат перенесено в архів, розклад перебудовано.' }); }
          });
        }}
      />
    </Surface>
  );
}

function NowLine() {
  return (
    <span className="flex items-center gap-2 px-2 py-1 text-[11px] font-medium text-hot" aria-label="Зараз">
      зараз<i aria-hidden="true" className="h-px flex-1 bg-hot" />
    </span>
  );
}
