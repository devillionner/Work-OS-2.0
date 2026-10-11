'use client';

import { useMemo, useState } from 'react';
import { Archive, Check, Copy, ExternalLink, RefreshCw, Shuffle, Trash2, Unlink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Ghost } from '@/components/ui/ghost';
import { Input } from '@/components/ui/input';
import { SearchField } from '@/components/ui/search-field';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { Surface } from '@/components/ui/surface';
import { useToast } from '@/components/ui/toast';
import { ArchiveReasonDialog } from '@/components/views/platforms/archive-reason-dialog';
import { telegramSchedule, useTelegramSchedule, type ScheduleSlot } from '@/components/views/platforms/telegram-schedule-store';
import { businessDate, businessDateTime, lessonEpoch } from '@/lib/leads/domain/time';
import { cn } from '@/lib/utils';

const formatNumber = (value: number) => Number(value.toFixed(6)).toString();
const formatTime = (epoch: number) => businessDateTime(epoch).slice(11, 16);
const normalizeTime = (value: string) => { const digits = value.replace(/\D/g, '').slice(0, 4); return digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits; };

/** Повний розклад публікацій Telegram-акаунта: налаштування, генерація, слоти, архівація чату зі слота. */
export function ScheduleTab({ accountId }: { accountId: string }) {
  const toast = useToast();
  const { snapshot: data, loading, error, busy } = useTelegramSchedule(accountId);
  // Поля форми живуть, поки знімок не змінить версію налаштувань: тоді підтягуємо серверні значення.
  const settingsKey = data ? `${data.accountId}:${data.settings.version}` : '';
  return data ? <ScheduleForm key={settingsKey} accountId={accountId} data={data} busy={busy} error={error} onToast={toast.push} /> : (
    <div className="flex flex-col gap-3">
      {error ? <p role="alert" className="m-0 text-sm text-hot">{error}</p> : null}
      {loading ? <div aria-busy="true" className="flex flex-col gap-2">{[0, 1, 2].map((item) => <Ghost key={item} className="h-20 rounded-card" />)}</div> : null}
    </div>
  );
}

type Data = NonNullable<ReturnType<typeof useTelegramSchedule>['snapshot']>;

function ScheduleForm({ accountId, data, busy, error, onToast }: { accountId: string; data: Data; busy: boolean; error: string; onToast: (toast: { message: string; tone?: 'hot' | 'ok' }) => number }) {
  const [localError, setLocalError] = useState('');
  const [search, setSearch] = useState('');
  const [intervalText, setIntervalText] = useState(formatNumber(data.settings.intervalMinutes));
  const [rateText, setRateText] = useState(formatNumber(60 / data.settings.intervalMinutes));
  const [baseTime, setBaseTime] = useState(businessDateTime(data.settings.baseAt).slice(11, 16));
  const [mode, setMode] = useState<'auto' | 'manual'>(data.settings.selectionMode);
  const [manualIds, setManualIds] = useState<string[]>(data.settings.manualChatIds);
  const [slotCount, setSlotCount] = useState(7);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [archiveSlot, setArchiveSlot] = useState<ScheduleSlot | null>(null);

  const selectedSet = useMemo(() => new Set(manualIds), [manualIds]);
  const visibleChats = useMemo(() => { const q = search.trim().toLowerCase(); return q ? data.eligibleChats.filter((chat) => chat.name.toLowerCase().includes(q) || chat.link.toLowerCase().includes(q)) : data.eligibleChats; }, [data, search]);
  const pendingChatIds = useMemo(() => new Set(data.slots.filter((slot) => slot.status === 'pending' && slot.chatId).map((slot) => slot.chatId!)), [data]);
  const total = data.pending + data.completed;
  const progress = total ? data.completed / total : 0;

  function changeInterval(value: string) { setIntervalText(value); const interval = Number(value.replace(',', '.')); if (Number.isFinite(interval) && interval > 0) setRateText(formatNumber(60 / interval)); }
  function changeRate(value: string) { setRateText(value); const rate = Number(value.replace(',', '.')); if (Number.isFinite(rate) && rate > 0) setIntervalText(formatNumber(60 / rate)); }

  async function saveSettings() {
    const interval = Number(intervalText.replace(',', '.'));
    const baseAt = lessonEpoch(businessDate(Math.floor(Date.now() / 1000)), baseTime);
    if (!Number.isFinite(interval) || interval <= 0) { setLocalError('Інтервал має бути більшим за нуль.'); return null; }
    if (baseAt === null) { setLocalError('Введи час у форматі HH:MM.'); return null; }
    setLocalError('');
    return telegramSchedule.save(accountId, { expectedVersion: data.settings.version, intervalMinutes: interval, baseAt, selectionMode: mode, manualChatIds: manualIds });
  }
  async function generate() { const saved = await saveSettings(); if (saved) await telegramSchedule.generate(accountId, slotCount); }
  async function editTime(slot: ScheduleSlot, time: string) {
    const epoch = lessonEpoch(businessDate(slot.scheduledAt), time);
    if (epoch === null) { setLocalError('Введи час слота у форматі HH:MM.'); return; }
    setLocalError('');
    await telegramSchedule.editSlot(accountId, slot, { scheduledAt: epoch });
  }
  async function copyPlan() {
    const lines = data.slots.map((slot) => `${slot.status === 'completed' ? '✓' : '○'} ${formatTime(slot.scheduledAt)} — ${slot.chatName || 'Без чату'}${slot.chatLink ? ` — ${slot.chatLink}` : ''}`);
    await navigator.clipboard.writeText(lines.join('\n'));
    onToast({ message: 'План скопійовано.' });
  }
  function randomForSlots() {
    const pool = [...visibleChats];
    for (let i = pool.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    setManualIds(pool.slice(0, Math.min(slotCount, pool.length)).map((chat) => chat.id));
    setMode('manual');
  }

  return (
    <div className="flex flex-col gap-4">
      <Surface variant="glass" radius="card" className="flex flex-col gap-1 p-5" aria-labelledby="schedule-head">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 id="schedule-head" className="m-0 text-[17px] font-medium">План публікацій</h2><p className="m-0 mt-1 text-xs text-ink-2">{data.nextSlot ? `Наступна: ${formatTime(data.nextSlot.scheduledAt)} · ${data.nextSlot.chatName || 'призначити чат'}` : 'Окремий розклад для поточного Telegram-акаунта'}</p></div>
          <span className="font-mono text-sm text-ink-2">{data.completed}/{total} · {Math.round(progress * 100)}%</span>
        </div>
      </Surface>

      {error || localError ? <p role="alert" className="m-0 text-sm text-hot">{error || localError}</p> : null}

      <Surface variant="glass" radius="card" className="flex flex-col gap-5 p-5">
        <div className="grid grid-cols-2 gap-3 @3xl:grid-cols-4">
          <label htmlFor="telegram-rate" className="flex flex-col gap-1.5 text-xs font-medium text-ink-2">Публікацій на годину<Input id="telegram-rate" className="font-mono" inputMode="decimal" value={rateText} disabled={busy} onChange={(event) => changeRate(event.target.value)} /></label>
          <label htmlFor="telegram-interval" className="flex flex-col gap-1.5 text-xs font-medium text-ink-2">Інтервал, хв<Input id="telegram-interval" className="font-mono" inputMode="decimal" value={intervalText} disabled={busy} onChange={(event) => changeInterval(event.target.value)} /></label>
          <label htmlFor="telegram-start" className="flex flex-col gap-1.5 text-xs font-medium text-ink-2">Старт (ГГ:ХХ)
            <span className="flex items-center gap-2"><Input id="telegram-start" className="font-mono" inputMode="numeric" maxLength={5} value={baseTime} disabled={busy} onChange={(event) => setBaseTime(normalizeTime(event.target.value))} /><Button variant="icon" size="md" aria-label="Від зараз" title="Від зараз" disabled={busy} onClick={() => setBaseTime(businessDateTime(Math.floor(Date.now() / 1000)).slice(11, 16))}><RefreshCw aria-hidden="true" strokeWidth={1.5} /></Button></span>
          </label>
          <label htmlFor="telegram-slot-count" className="flex flex-col gap-1.5 text-xs font-medium text-ink-2">Кількість слотів<Input id="telegram-slot-count" className="font-mono" type="number" min={1} max={200} value={slotCount} disabled={busy} onChange={(event) => setSlotCount(Math.max(1, Math.min(200, Number(event.target.value) || 1)))} /></label>
        </div>

        <div className="flex flex-col gap-3">
          <Segmented<'auto' | 'manual'> label="Вибір чатів" value={mode} onValueChange={setMode} items={[{ value: 'auto', label: 'Автоматично' }, { value: 'manual', label: 'Вручну' }]} />
          {mode === 'manual' ? (
            <div className="flex flex-col gap-3 rounded-inner border border-line bg-sunken p-3">
              <div className="flex flex-wrap items-center gap-2">
                <SearchField value={search} onValueChange={setSearch} placeholder="Пошук доступних чатів" hotkey={false} wrapperClassName="min-w-[180px] flex-1" aria-label="Пошук чатів для розкладу" />
                <Button variant="outline" size="sm" disabled={busy || !visibleChats.length} onClick={() => { setManualIds((current) => [...new Set([...current, ...visibleChats.map((chat) => chat.id)])]); setMode('manual'); }}>Вибрати всі</Button>
                <Button variant="outline" size="sm" disabled={busy || !visibleChats.length} onClick={randomForSlots}><Shuffle aria-hidden="true" strokeWidth={1.5} />Випадково</Button>
              </div>
              <div className="flex items-center justify-between text-xs text-ink-2"><span>Вибрано {manualIds.length}</span><Button variant="ghost" size="sm" disabled={busy || !manualIds.length} onClick={() => setManualIds([])}>Очистити вибір</Button></div>
              <ul className="m-0 flex max-h-56 list-none flex-col gap-1 overflow-y-auto p-0">
                {visibleChats.map((chat) => (
                  <li key={chat.id}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-raised">
                      <input type="checkbox" aria-label={`Вибрати чат ${chat.name}`} checked={selectedSet.has(chat.id)} disabled={busy} className="size-4 accent-[var(--ink)]" onChange={() => setManualIds((current) => (current.includes(chat.id) ? current.filter((item) => item !== chat.id) : [...current, chat.id]))} />
                      <span className="min-w-0"><span className="block truncate text-sm">{chat.name}</span><small className="block truncate text-[11px] text-ink-2">{chat.link}</small></span>
                    </label>
                  </li>
                ))}
                {!visibleChats.length ? <li className="px-2 py-4 text-center text-sm text-ink-2">За поточним пошуком доступних чатів немає.</li> : null}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="action" busy={busy} onClick={() => void generate()}>Створити розклад</Button>
          <Button variant="outline" disabled={busy} onClick={() => void saveSettings()}>Зберегти налаштування</Button>
          <span className="flex-1" />
          <Button variant="outline" disabled={busy || !data.slots.length} onClick={() => void copyPlan()}><Copy aria-hidden="true" strokeWidth={1.5} />Скопіювати план</Button>
          <Button variant="outline" tone="danger" disabled={busy || !data.pending} onClick={() => setClearConfirm(true)}><Trash2 aria-hidden="true" strokeWidth={1.5} />Очистити невиконані</Button>
        </div>
      </Surface>

      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {data.slots.map((slot, index) => {
          const candidates = data.eligibleChats.filter((chat) => !pendingChatIds.has(chat.id) || chat.id === slot.chatId);
          const completed = slot.status === 'completed';
          return (
            <li key={slot.id} className={cn('flex flex-col gap-3 rounded-inner border px-4 py-3 @3xl:flex-row @3xl:items-center', completed ? 'border-line opacity-60' : 'border-line bg-sunken')}>
              <div className="flex items-center gap-3 @3xl:w-44 @3xl:shrink-0">
                <span className="w-12 font-mono text-xs text-ink-2">{completed ? 'Готово' : `#${index + 1}`}</span>
                <Input className="h-9 w-[84px] text-center font-mono" aria-label={`Час слота ${index + 1}`} defaultValue={formatTime(slot.scheduledAt)} disabled={busy || completed} onBlur={(event) => { if (event.target.value !== formatTime(slot.scheduledAt)) void editTime(slot, event.target.value); }} />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2 @3xl:flex-row @3xl:items-center">
                <Select aria-label={`Чат слота ${index + 1}`} value={slot.chatId || ''} disabled={busy || completed} onChange={(event) => { const value = event.target.value; if (!value) void telegramSchedule.unlinkSlot(accountId, slot); else void telegramSchedule.editSlot(accountId, slot, { chatId: value }); }}>
                  <option value="">Без чату</option>
                  {slot.chatId && !candidates.some((chat) => chat.id === slot.chatId) ? <option value={slot.chatId}>{slot.chatName || slot.chatId}</option> : null}
                  {candidates.map((chat) => <option key={chat.id} value={chat.id}>{chat.name}</option>)}
                </Select>
                {slot.chatLink ? <a className="inline-flex max-w-[220px] items-center gap-1.5 truncate text-xs text-ink-2 underline-offset-4 hover:underline" href={slot.chatLink} target="_blank" rel="noreferrer" title="Відкрити чат у новій вкладці">{slot.chatLink.replace(/^https:\/\//, '')}<ExternalLink aria-hidden="true" strokeWidth={1.5} className="size-3 shrink-0" /></a> : <span className="text-xs text-ink-3">—</span>}
              </div>
              <div className="flex shrink-0 items-center justify-end gap-1.5">
                {!completed && slot.chatId ? (
                  <>
                    <Button variant="outline" size="sm" disabled={busy || !slot.chatStateToken} onClick={() => void telegramSchedule.markPublished(accountId, slot).then((ok) => { if (ok) onToast({ message: 'Публікацію відмічено.' }); })}><Check aria-hidden="true" strokeWidth={1.5} />Опубліковано</Button>
                    <Button variant="icon" size="sm" aria-label="Перенести чат в архів" title="Перенести чат в архів" disabled={busy} onClick={() => setArchiveSlot(slot)}><Archive aria-hidden="true" strokeWidth={1.5} /></Button>
                    <Button variant="icon" size="sm" aria-label="Відв’язати чат від слота" title="Відв’язати чат від слота" disabled={busy} onClick={() => void telegramSchedule.unlinkSlot(accountId, slot)}><Unlink aria-hidden="true" strokeWidth={1.5} /></Button>
                  </>
                ) : null}
              </div>
            </li>
          );
        })}
        {!data.slots.length ? <li><EmptyState text="Розклад ще не створено. Налаштуй інтервал і натисни «Створити розклад»." /></li> : null}
      </ul>

      <ConfirmDialog open={clearConfirm} title="Очистити невиконані слоти?" description={`Буде видалено ${data.pending} невиконаних слотів лише цього Telegram-акаунта. Виконані слоти лишаться в історії.`} confirmLabel="Очистити слоти" destructive busy={busy} onCancel={() => setClearConfirm(false)} onConfirm={() => { void telegramSchedule.clearPending(accountId).then(() => setClearConfirm(false)); }} />
      <ArchiveReasonDialog open={archiveSlot !== null} chatName={archiveSlot?.chatName ?? null} busy={busy} error={error} onCancel={() => setArchiveSlot(null)} onConfirm={(reason) => { const slot = archiveSlot; if (!slot) return; void telegramSchedule.archiveSlot(accountId, slot, reason).then((next) => { if (next) { setArchiveSlot(null); onToast({ message: 'Чат перенесено в архів, розклад перебудовано.' }); } }); }} />
    </div>
  );
}
