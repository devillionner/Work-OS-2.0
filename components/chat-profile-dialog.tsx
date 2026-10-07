'use client';

import { useEffect, useRef, useState } from 'react';
import { CalendarDays, Check, ExternalLink, Loader2, SlidersHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { ChatProfile, ProfileCadence } from '@/lib/chats/profile';
import { PROFILE_CADENCES } from '@/lib/chats/profile';
import { createActionGate } from '@/lib/action-gate';

export type ChatWithProfile = {
  id: string;
  name: string;
  link?: string;
  platform: string;
  stateToken: string;
  profile: ChatProfile;
};

type ChatProfileDialogProps = {
  open: boolean;
  chat: ChatWithProfile | null;
  onClose: () => void;
  onSaved: (chatId: string, profile: ChatProfile) => void;
  onOpenChat?: () => void;
  finalFocus?: React.RefObject<HTMLElement | null>;
};

const cadenceNames: Record<ProfileCadence, string> = {
  any: 'Будь-коли',
  daily: 'Щодня',
  weekly: 'Раз на тиждень',
  monthly: 'Раз на місяць',
  custom: 'Спеціальний інтервал',
};

const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];

export function ChatProfileDialog({
  open,
  chat,
  onClose,
  onSaved,
  onOpenChat,
  finalFocus,
}: ChatProfileDialogProps) {
  const [name, setName] = useState(chat?.name || '');
  const [language, setLanguage] = useState<'uk' | 'ru' | ''>(chat?.profile.language || '');
  const [cadence, setCadence] = useState<ProfileCadence>(chat?.profile.cadence || 'any');
  const [weekdaysSelected, setWeekdaysSelected] = useState<number[]>(chat?.profile.weekdays || []);
  const [customIntervalDays, setCustomIntervalDays] = useState(
    chat?.profile.customIntervalDays ? String(chat.profile.customIntervalDays) : ''
  );
  const [nextAllowedOn, setNextAllowedOn] = useState(chat?.profile.nextAllowedOn || '');
  const [directions, setDirections] = useState(chat?.profile.directions.join('\n') || '');
  const [note, setNote] = useState(chat?.profile.note || '');
  const [reviewStatus, setReviewStatus] = useState<'draft' | 'confirmed'>(chat?.profile.reviewStatus || 'draft');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const gate = useRef(createActionGate());

  useEffect(()=>{
    if (!open || !chat) return;
    // oxlint-disable-next-line
    setName(chat.name);
    setLanguage(chat.profile.language || '');
    setCadence(chat.profile.cadence || 'any');
    setWeekdaysSelected(chat.profile.weekdays || []);
    setCustomIntervalDays(chat.profile.customIntervalDays ? String(chat.profile.customIntervalDays) : '');
    setNextAllowedOn(chat.profile.nextAllowedOn || '');
    setDirections(chat.profile.directions.join('\n'));
    setNote(chat.profile.note || '');
    setReviewStatus(chat.profile.reviewStatus || 'draft');
    setError('');
  }, [open, chat]);

  async function save() {
    if (!chat) return;
    await gate.current(async () => {
      setBusy(true);
      setError('');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      try {
        const response = await fetch('/api/chats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            id: chat.id,
            action: 'profile',
            stateToken: chat.stateToken,
            profile: {
              name,
              language: language || null,
              cadence,
              weekdays: weekdaysSelected,
              customIntervalDays: cadence === 'custom' ? Number(customIntervalDays) : null,
              nextAllowedOn: nextAllowedOn || null,
              directions: directions
                .split(/\r?\n|,/)
                .map((value) => value.trim())
                .filter(Boolean),
              note,
              reviewStatus,
            },
          }),
        });
        const value: unknown = await response.json();
        if (!response.ok || !value || typeof value !== 'object' || !('profile' in value))
          throw new Error(
            value && typeof value === 'object' && 'error' in value && typeof value.error === 'string'
              ? value.error
              : 'Не вдалося зберегти профіль. Оновіть список і спробуйте ще раз.'
          );
        onSaved(chat.id, (value as { profile: ChatProfile }).profile);
        onClose();
      } catch (reason) {
        setError(
          reason instanceof Error && reason.name !== 'AbortError' && reason.name !== 'TypeError'
            ? reason.message
            : 'Не вдалося зберегти профіль. Перевірте з’єднання та спробуйте ще раз.'
        );
      } finally {
        clearTimeout(timeout);
        setBusy(false);
      }
    });
  }

  function toggleWeekday(index1: number) {
    if (busy) return;
    setWeekdaysSelected((current) =>
      current.includes(index1) ? current.filter((v) => v !== index1) : [...current, index1].sort()
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent className="chat-profile-dialog" showCloseButton={false} finalFocus={finalFocus}>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="size-4 text-primary" />
            <DialogTitle>Профіль і правила чату</DialogTitle>
          </div>
          <DialogDescription>
            Налаштуйте правила публікації, частоту, дозволені дні та напрямки для точного автоматичного підбору оголошень.
          </DialogDescription>
        </DialogHeader>

        <Button
          className="chat-profile-close"
          variant="ghost"
          size="icon"
          aria-label="Закрити"
          disabled={busy}
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>

        {error && (
          <div className="workspace-error" role="alert">
            {error}
          </div>
        )}

        {chat && (
          <>
            <div className="chat-profile-chat">
              <div className="flex items-center justify-between gap-3">
                <strong className="text-sm font-semibold text-foreground">{chat.name}</strong>
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onOpenChat}>
                  <ExternalLink data-icon="inline-start" className="size-3.5" />
                  Відкрити чат
                </Button>
              </div>
              <span className="text-xs text-muted-foreground break-all">{chat.link}</span>
            </div>

            <div className="grid gap-3.5">
              <label htmlFor="chat-profile-name" className="grid gap-1.5 text-xs font-semibold text-foreground">
                Назва чату
                <Input
                  id="chat-profile-name"
                  value={name}
                  maxLength={180}
                  disabled={busy}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Вкажіть актуальну назву чату"
                />
              </label>

              <div className="chat-profile-grid">
                <label htmlFor="chat-profile-language" className="grid gap-1.5 text-xs font-semibold text-foreground">
                  Мова публікації
                  <select
                    id="chat-profile-language"
                    value={language}
                    disabled={busy}
                    onChange={(event) => setLanguage(event.target.value as 'uk' | 'ru' | '')}
                    className="chat-profile-select"
                  >
                    <option value="">Не визначено</option>
                    <option value="uk">Українська</option>
                    <option value="ru">Російська</option>
                  </select>
                </label>

                <label htmlFor="chat-profile-cadence" className="grid gap-1.5 text-xs font-semibold text-foreground">
                  Частота публікації
                  <select
                    id="chat-profile-cadence"
                    value={cadence}
                    disabled={busy}
                    onChange={(event) => setCadence(event.target.value as ProfileCadence)}
                    className="chat-profile-select"
                  >
                    {PROFILE_CADENCES.map((value) => (
                      <option key={value} value={value}>
                        {cadenceNames[value]}
                      </option>
                    ))}
                  </select>
                </label>

                {cadence === 'custom' && (
                  <label htmlFor="chat-profile-custom-interval" className="grid gap-1.5 text-xs font-semibold text-foreground">
                    Інтервал, днів
                    <Input
                      id="chat-profile-custom-interval"
                      type="number"
                      min={1}
                      max={3650}
                      value={customIntervalDays}
                      disabled={busy}
                      onChange={(event) => setCustomIntervalDays(event.target.value)}
                      placeholder="Наприклад, 14"
                    />
                  </label>
                )}

                <label htmlFor="chat-profile-next-allowed" className="grid gap-1.5 text-xs font-semibold text-foreground">
                  Наступна дозволена дата
                  <Input
                    id="chat-profile-next-allowed"
                    type="date"
                    value={nextAllowedOn}
                    disabled={busy}
                    onChange={(event) => setNextAllowedOn(event.target.value)}
                  />
                </label>
              </div>

              <fieldset disabled={busy} className="chat-profile-days-fieldset">
                <legend className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <CalendarDays className="size-3.5 text-primary" />
                  <span>Дозволені дні тижня</span>
                </legend>
                <div className="chat-profile-days">
                  {weekdays.map((day, index) => {
                    const selectedDay = weekdaysSelected.includes(index + 1);
                    return (
                      <button
                        key={day}
                        type="button"
                        className={`chat-profile-day-btn ${selectedDay ? 'is-selected' : ''}`}
                        onClick={() => toggleWeekday(index + 1)}
                        disabled={busy}
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <label htmlFor="chat-profile-directions" className="grid gap-1.5 text-xs font-semibold text-foreground">
                <div className="flex items-center justify-between">
                  <span>Цільові напрямки</span>
                  <span className="text-[11px] font-normal text-muted-foreground">по одному в рядку</span>
                </div>
                <Textarea
                  id="chat-profile-directions"
                  rows={2}
                  maxLength={1000}
                  value={directions}
                  disabled={busy}
                  onChange={(event) => setDirections(event.target.value)}
                  placeholder="Математика&#10;Англійська мова"
                  className="chat-profile-textarea"
                />
              </label>

              <label htmlFor="chat-profile-note" className="grid gap-1.5 text-xs font-semibold text-foreground">
                <div className="flex items-center justify-between">
                  <span>Нотатка про правила</span>
                  <span className="text-[11px] font-normal text-muted-foreground">особливості чату</span>
                </div>
                <Textarea
                  id="chat-profile-note"
                  rows={3}
                  maxLength={1000}
                  value={note}
                  disabled={busy}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Коли краще публікувати, суворість адмінів, додаткові вимоги…"
                  className="chat-profile-textarea"
                />
              </label>

              <label className="chat-profile-confirm-card">
                <input
                  type="checkbox"
                  checked={reviewStatus === 'confirmed'}
                  disabled={busy}
                  onChange={(event) => setReviewStatus(event.target.checked ? 'confirmed' : 'draft')}
                  className="size-4 rounded accent-primary"
                />
                <div className="min-w-0">
                  <strong className="block text-xs font-semibold text-foreground">Правила чату перевірені</strong>
                  <span className="block text-[11px] text-muted-foreground">
                    Чат перейде з «Уточнити профіль» у повноцінний робочий статус.
                  </span>
                </div>
              </label>
            </div>

            <div className="dialog-actions chat-profile-footer">
              <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
                Скасувати
              </Button>
              <Button type="button" disabled={busy || !name.trim()} onClick={() => void save()}>
                {busy ? (
                  <Loader2 data-icon="inline-start" className="size-4 animate-spin" />
                ) : (
                  <Check data-icon="inline-start" className="size-4" />
                )}
                {busy ? 'Зберігаємо…' : 'Зберегти профіль'}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
