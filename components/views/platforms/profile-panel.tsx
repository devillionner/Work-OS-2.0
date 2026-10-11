'use client';

import { useRef, useState } from 'react';
import { Check, ExternalLink } from 'lucide-react';
import { Panel } from '@/components/shell/panel';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/toggle';
import { Chip } from '@/components/ui/chip';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { ChatProfile, ProfileCadence } from '@/lib/chats/profile';
import { PROFILE_CADENCES } from '@/lib/chats/profile';
import { createActionGate } from '@/lib/action-gate';
import { humanError } from '@/components/ui/human-error';

export type ChatWithProfile = { id: string; name: string; link?: string; platform: string; stateToken: string; profile: ChatProfile };

const CADENCE_NAMES: Record<ProfileCadence, string> = { any: 'Будь-коли', daily: 'Щодня', several_week: 'Кілька разів на тиждень', weekly: 'Раз на тиждень', monthly: 'Раз на місяць', custom: 'Спеціальний інтервал' };
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];

/** Профіль і правила чату: частота, дозволені дні, напрямки. Відкривається з рядка чату. */
export function ProfilePanel({ open, chat, onClose, onSaved, onOpenChat }: { open: boolean; chat: ChatWithProfile | null; onClose: () => void; onSaved: (chatId: string, profile: ChatProfile) => void; onOpenChat?: () => void }) {
  return (
    <Panel open={open && chat !== null} onOpenChange={(next) => { if (!next) onClose(); }} title="Профіль і правила чату" subtitle="Правила публікації, частота, дозволені дні та напрямки для точного підбору оголошень.">
      {chat ? <ProfileForm key={chat.id} chat={chat} onClose={onClose} onSaved={onSaved} onOpenChat={onOpenChat} /> : null}
    </Panel>
  );
}

function ProfileForm({ chat, onClose, onSaved, onOpenChat }: { chat: ChatWithProfile; onClose: () => void; onSaved: (chatId: string, profile: ChatProfile) => void; onOpenChat?: () => void }) {
  const [name, setName] = useState(chat.name);
  const [language, setLanguage] = useState<'uk' | 'ru' | ''>(chat.profile.language || '');
  const [cadence, setCadence] = useState<ProfileCadence>(chat.profile.cadence || 'any');
  const [weekdays, setWeekdays] = useState<number[]>(chat.profile.weekdays || []);
  const [customIntervalDays, setCustomIntervalDays] = useState(chat.profile.customIntervalDays ? String(chat.profile.customIntervalDays) : '');
  const [nextAllowedOn, setNextAllowedOn] = useState(chat.profile.nextAllowedOn || '');
  const [directions, setDirections] = useState(chat.profile.directions.join('\n'));
  const [note, setNote] = useState(chat.profile.note || '');
  const [reviewStatus, setReviewStatus] = useState<'draft' | 'confirmed'>(chat.profile.reviewStatus || 'draft');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const gate = useRef(createActionGate());

  async function save() {
    await gate.current(async () => {
      setBusy(true); setError('');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      try {
        const response = await fetch('/api/chats', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
          body: JSON.stringify({
            id: chat.id, action: 'profile', stateToken: chat.stateToken,
            profile: { name, language: language || null, cadence, weekdays, customIntervalDays: cadence === 'custom' ? Number(customIntervalDays) : null, nextAllowedOn: nextAllowedOn || null, directions: directions.split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean), note, reviewStatus },
          }),
        });
        const value: unknown = await response.json();
        if (!response.ok || !value || typeof value !== 'object' || !('profile' in value)) {
          throw new Error(value && typeof value === 'object' && 'error' in value && typeof value.error === 'string' ? value.error : 'Не вдалося зберегти профіль. Онови список і спробуй ще раз.');
        }
        onSaved(chat.id, (value as { profile: ChatProfile }).profile);
        onClose();
      } catch (reason) {
        setError(humanError(reason, 'Не вдалося зберегти профіль. Перевір з’єднання та спробуй ще раз.'));
      } finally { clearTimeout(timeout); setBusy(false); }
    });
  }

  const toggleDay = (day: number) => { if (!busy) setWeekdays((current) => (current.includes(day) ? current.filter((value) => value !== day) : [...current, day].sort())); };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3 rounded-inner border border-line bg-sunken px-4 py-3">
        <div className="min-w-0">
          <p className="m-0 truncate text-sm font-medium">{chat.name}</p>
          <p className="m-0 break-all font-mono text-[11px] text-ink-2">{chat.link}</p>
        </div>
        <Button variant="outline" size="sm" disabled={busy} onClick={onOpenChat}><ExternalLink aria-hidden="true" strokeWidth={1.5} />Відкрити</Button>
      </div>
      {error ? <p role="alert" className="m-0 text-sm text-hot">{error}</p> : null}
      <Field label="Назва чату" htmlFor="chat-profile-name"><Input id="chat-profile-name" value={name} maxLength={180} disabled={busy} placeholder="Актуальна назва чату" onChange={(event) => setName(event.target.value)} /></Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Мова публікації" htmlFor="chat-profile-language">
          <Select id="chat-profile-language" value={language} disabled={busy} onChange={(event) => setLanguage(event.target.value as 'uk' | 'ru' | '')}>
            <option value="">Не визначено</option><option value="uk">Українська</option><option value="ru">Російська</option>
          </Select>
        </Field>
        <Field label="Частота публікації" htmlFor="chat-profile-cadence">
          <Select id="chat-profile-cadence" value={cadence} disabled={busy} onChange={(event) => setCadence(event.target.value as ProfileCadence)}>
            {PROFILE_CADENCES.map((value) => <option key={value} value={value}>{CADENCE_NAMES[value]}</option>)}
          </Select>
        </Field>
        {cadence === 'custom' ? <Field label="Інтервал, днів" htmlFor="chat-profile-custom-interval"><Input id="chat-profile-custom-interval" type="number" min={1} max={3650} value={customIntervalDays} disabled={busy} placeholder="Наприклад, 14" onChange={(event) => setCustomIntervalDays(event.target.value)} /></Field> : null}
        <Field label="Наступна дозволена дата" htmlFor="chat-profile-next-allowed"><Input id="chat-profile-next-allowed" type="date" value={nextAllowedOn} disabled={busy} onChange={(event) => setNextAllowedOn(event.target.value)} /></Field>
      </div>
      <fieldset disabled={busy} className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-2 p-0 text-xs font-medium text-ink-2">Дозволені дні тижня</legend>
        <div className="flex flex-wrap gap-2">{WEEKDAYS.map((day, index) => <Chip key={day} pressed={weekdays.includes(index + 1)} onClick={() => toggleDay(index + 1)}>{day}</Chip>)}</div>
      </fieldset>
      <Field label="Цільові напрямки — по одному в рядку" htmlFor="chat-profile-directions"><Textarea id="chat-profile-directions" rows={2} maxLength={1000} value={directions} disabled={busy} placeholder={'Математика\nАнглійська мова'} onChange={(event) => setDirections(event.target.value)} /></Field>
      <Field label="Нотатка про правила" htmlFor="chat-profile-note"><Textarea id="chat-profile-note" rows={3} maxLength={1000} value={note} disabled={busy} placeholder="Коли краще публікувати, суворість адмінів, додаткові вимоги…" onChange={(event) => setNote(event.target.value)} /></Field>
      <label className="flex items-start gap-3 rounded-inner border border-line px-4 py-3">
        <Checkbox checked={reviewStatus === 'confirmed'} disabled={busy} onCheckedChange={(checked) => setReviewStatus(checked ? 'confirmed' : 'draft')} aria-label="Правила чату перевірені" />
        <span className="min-w-0"><strong className="block text-sm font-medium">Правила чату перевірені</strong><span className="block text-xs text-ink-2">Чат перейде з «Уточнити профіль» у повноцінний робочий статус.</span></span>
      </label>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" disabled={busy} onClick={onClose}>Скасувати</Button>
        <Button variant="action" busy={busy} disabled={!name.trim()} onClick={() => void save()}><Check aria-hidden="true" strokeWidth={1.5} />{busy ? 'Зберігаємо…' : 'Зберегти профіль'}</Button>
      </div>
    </div>
  );
}
