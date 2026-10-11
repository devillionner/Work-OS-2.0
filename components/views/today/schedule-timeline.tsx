'use client';

import { useEffect, useState } from 'react';
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
import { businessDateTime } from '@/lib/leads/domain/time';
import { cn } from '@/lib/utils';

const MISSED_AFTER_SECONDS = 5 * 60;

function slotTime(epoch: number) { return businessDateTime(epoch).slice(11, 16); }

/**
 * Розклад Telegram на сьогодні: горизонтальна шкала зі слотами. «Зараз» — вертикальна лінія `--signal-hot`.
 * Повне керування розкладом живе в «Платформи → Telegram → Розклад».
 */
export function ScheduleTimeline() {
  const { snapshot, navigate } = useShell();
  const toast = useToast();
  const enabled = snapshot.enabledPlatforms.includes('telegram');
  const { accountId, loaded, error: accountError } = useTelegramAccounts(enabled);
  const { snapshot: schedule, loading, error, busy } = useTelegramSchedule(enabled ? accountId : null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [archiveSlot, setArchiveSlot] = useState<ScheduleSlot | null>(null);

  // Лінія «зараз» зсувається локально раз на хвилину; до мережі це не звертається.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  async function markPublished(slot: ScheduleSlot) {
    if (!accountId) return;
    const ok = await telegramSchedule.markPublished(accountId, slot);
    if (ok) toast.push({ message: `Публікацію в «${slot.chatName || 'чаті'}» відмічено.` });
  }

  if (!enabled) return null;

  const openSchedule = () => { navigate('platforms'); emitCommand('platforms:telegram-schedule'); };
  const slots = schedule?.slots ?? [];
  const nowIndex = slots.findIndex((slot) => slot.scheduledAt > now);
  const markerAt = nowIndex === -1 ? slots.length : nowIndex;

  return (
    <Surface variant="glass" radius="card" data-reveal className="flex flex-col gap-4 p-5 sm:p-6" aria-labelledby="schedule-title">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="schedule-title" className="m-0 text-[17px] font-medium">Розклад Telegram</h2>
        <div className="flex items-center gap-3">
          {schedule ? <span className="font-mono text-sm text-ink-2">{schedule.completed}/{schedule.completed + schedule.pending}</span> : null}
          <Button variant="ghost" size="sm" onClick={openSchedule}>Керувати</Button>
        </div>
      </div>

      {accountError || error ? <p role="alert" className="m-0 text-sm text-hot">{accountError || error}</p> : null}

      {!loaded || (loading && !schedule) ? (
        <div className="flex gap-3 overflow-hidden" aria-busy="true">{[0, 1, 2, 3].map((item) => <Ghost key={item} className="h-24 w-44 shrink-0 rounded-inner" />)}</div>
      ) : !accountId ? (
        <EmptyState text="Додай робочий Telegram-акаунт у «Платформи», і тут з’явиться розклад публікацій." action={<Button variant="outline" size="sm" onClick={() => navigate('platforms')}>Відкрити платформи</Button>} />
      ) : !slots.length ? (
        <EmptyState text="Розклад публікацій ще не створено." action={<Button variant="outline" size="sm" onClick={openSchedule}>Створити розклад</Button>} />
      ) : (
        <ol className="m-0 flex list-none snap-x snap-mandatory gap-3 overflow-x-auto p-0 pb-1 hide-scrollbar" aria-label="Слоти публікацій">
          {slots.map((slot, index) => {
            const missed = slot.status === 'pending' && slot.chatId !== null && now - slot.scheduledAt > MISSED_AFTER_SECONDS;
            const free = slot.chatId === null && slot.status === 'pending';
            return (
              <li key={slot.id} className="flex snap-start items-stretch gap-3">
                {index === markerAt ? <NowMarker /> : null}
                <div className={cn('flex w-44 shrink-0 flex-col justify-between gap-3 rounded-inner border p-3.5', free ? 'border-dashed border-line-strong' : 'border-line bg-sunken', slot.status === 'completed' && 'opacity-60')}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-base">{slotTime(slot.scheduledAt)}</span>
                    {slot.status === 'completed' ? <span className="flex items-center gap-1 text-xs text-ok"><i aria-hidden="true" className="size-1.5 rounded-full bg-ok" />Готово</span>
                      : missed ? <span className="flex items-center gap-1 text-xs text-hot"><i aria-hidden="true" className="size-1.5 rounded-full bg-hot" />Пропущено</span>
                      : free ? <span className="text-xs text-ink-2">Вільний</span> : null}
                  </div>
                  <p className="m-0 line-clamp-2 min-h-8 text-[13px] leading-snug text-ink-2">{slot.chatName || 'Чат не призначено'}</p>
                  {slot.status === 'pending' && slot.chatId ? (
                    <div className="flex items-center gap-1.5">
                      <Button variant="outline" size="sm" className="flex-1" busy={busy} disabled={!slot.chatStateToken} onClick={() => void markPublished(slot)}><Check aria-hidden="true" strokeWidth={1.5} />Готово</Button>
                      <Button variant="icon" size="sm" aria-label="Перенести чат в архів" disabled={busy} onClick={() => setArchiveSlot(slot)}><Archive aria-hidden="true" strokeWidth={1.5} /></Button>
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
          {markerAt === slots.length ? <li className="flex items-stretch"><NowMarker /></li> : null}
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
          void telegramSchedule.archiveSlot(accountId, slot, reason).then((next) => {
            if (next) { setArchiveSlot(null); toast.push({ message: 'Чат перенесено в архів, розклад перебудовано.' }); }
          });
        }}
      />
    </Surface>
  );
}

function NowMarker() {
  return (
    <div className="flex shrink-0 flex-col items-center" aria-label="Зараз">
      <span className="text-[11px] font-medium text-hot">зараз</span>
      <i aria-hidden="true" className="mt-1 w-0.5 flex-1 rounded-full bg-hot" />
    </div>
  );
}
