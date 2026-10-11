'use client';

import { useId, useMemo, useState, type ReactNode } from 'react';
import { Panel } from '@/components/shell/panel';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Ghost } from '@/components/ui/ghost';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { labels } from '@/components/views/leads/client';
import { useRemote } from '@/components/views/shared/use-remote';
import { announceDataChange } from '@/lib/client-sync';
import { cn } from '@/lib/utils';
import { formatDate } from './types';

export type CorrectionTab = 'publication' | 'lesson' | 'chat';
const TABS = [
  { value: 'publication', label: 'Публікація' },
  { value: 'lesson', label: 'Результат уроку' },
  { value: 'chat', label: 'Новий чат' },
] as const;

type Account = { id: string; number: number; name: string; enabled: boolean };

function Pick({ selected, onClick, title, hint }: { selected: boolean; onClick: () => void; title: string; hint: string }) {
  return (
    <li>
      <button type="button" aria-pressed={selected} onClick={onClick} className={cn('flex w-full flex-col rounded-inner border px-3.5 py-2.5 text-left transition-colors duration-200 active:scale-[0.985]', selected ? 'border-line-strong bg-raised' : 'border-line hover:bg-raised')}>
        <span className="truncate text-sm font-medium">{title}</span>
        <span className="truncate text-xs text-ink-2">{hint}</span>
      </button>
    </li>
  );
}

function Loading() {
  return <div aria-busy="true" className="flex flex-col gap-2"><Ghost className="h-14 rounded-inner" /><Ghost className="h-14 rounded-inner" /><Ghost className="h-14 rounded-inner" /></div>;
}

function Retry({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3">
      <p role="alert" className="m-0 text-sm text-hot">{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>Спробувати ще раз</Button>
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="m-0 text-[13px] text-ink-2">{children}</p>;
}

async function post(url: string, body: unknown, fallback: string): Promise<{ name?: string }> {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json().catch(() => ({})) as { error?: string; name?: string };
  if (!response.ok) throw new Error(value.error || fallback);
  return value;
}

function PublicationForm({ date, enabled }: { date: string; enabled: boolean }) {
  const toast = useToast();
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState('');
  const [platform, setPlatform] = useState('');
  const [applied, setApplied] = useState({ search: '', platform: '' });
  const [chatId, setChatId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [advertisementId, setAdvertisementId] = useState('');
  const [language, setLanguage] = useState('');
  const [saving, setSaving] = useState(false);
  const url = useMemo(() => {
    const params = new URLSearchParams({ date });
    if (applied.search.trim()) params.set('search', applied.search.trim());
    if (applied.platform) params.set('platform', applied.platform);
    return `/api/reports/publication-correction?${params}`;
  }, [date, applied]);
  const { data, error, loading } = useRemote<{ chats: Array<{ id: string; name: string; link: string; platform: string; status: string; telegramAccountId: string | null }>; accounts: Account[]; advertisements: Array<{ id: string; title: string }> }>(url, { refresh: attempt, enabled, keepPrevious: true, fallback: 'Не вдалося завантажити чати для корекції.' });
  const chat = data?.chats.find((item) => item.id === chatId) ?? null;
  const telegram = chat?.platform === 'telegram';

  const choose = (id: string) => {
    setChatId(id);
    const picked = data?.chats.find((item) => item.id === id);
    if (picked?.platform === 'telegram') setAccountId(picked.telegramAccountId || data?.accounts.find((account) => account.enabled)?.id || data?.accounts[0]?.id || '');
    else setAccountId('');
  };

  const save = async () => {
    if (!chat || saving || (telegram && !accountId)) return;
    setSaving(true);
    try {
      await post('/api/reports/publication-correction', { date, chatId: chat.id, telegramAccountId: accountId || null, advertisementId: advertisementId || null, language: language || null }, 'Не вдалося додати історичну публікацію.');
      announceDataChange('all');
      toast.push({ message: `Публікацію за ${formatDate(date)} додано. Підсумки синхронізуються автоматично.`, tone: 'ok' });
      setChatId(''); setAdvertisementId(''); setLanguage('');
      setAttempt((value) => value + 1);
    } catch (reason) {
      toast.push({ message: reason instanceof Error ? reason.message : 'Не вдалося додати історичну публікацію.', tone: 'hot' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Note>Факт записується на {formatDate(date)} і не змінює сьогоднішній Telegram-розклад чи частоту публікацій. Обери чат, у якому публікація реально була цього дня.</Note>
      <form className="flex flex-col gap-2" onSubmit={(event) => { event.preventDefault(); setApplied({ search, platform }); setChatId(''); }}>
        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Назва або посилання чату" aria-label="Пошук чату" />
        <div className="flex gap-2">
          <Select aria-label="Платформа" value={platform} onChange={(event) => setPlatform(event.target.value)}>
            <option value="">Усі платформи</option>
            {Object.entries(labels).filter(([key]) => ['telegram', 'whatsapp', 'viber', 'facebook', 'threads'].includes(key)).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </Select>
          <Button type="submit" variant="outline" size="md" disabled={loading}>Знайти</Button>
        </div>
      </form>
      {error && !data ? <Retry message={error} onRetry={() => setAttempt((value) => value + 1)} /> : !data ? <Loading /> : data.chats.length === 0 ? (
        <EmptyState text="Чатів без уже зафіксованої публікації на цю дату не знайдено." />
      ) : (
        <ul aria-label="Чати для корекції" className="m-0 flex list-none flex-col gap-2 p-0">
          {data.chats.map((item) => <Pick key={item.id} selected={item.id === chatId} onClick={() => choose(item.id)} title={item.name} hint={`${labels[item.platform] ?? item.platform} · ${item.status} · ${item.link}`} />)}
        </ul>
      )}
      {chat && data ? (
        <div className="flex flex-col gap-3 border-t border-line pt-4">
          {telegram ? (
            <Field label="Telegram-акаунт">
              <Select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
                <option value="">Обери акаунт</option>
                {data.accounts.map((account) => <option key={account.id} value={account.id}>#{account.number} {account.name}{account.enabled ? '' : ' · вимкнений'}</option>)}
              </Select>
            </Field>
          ) : null}
          <Field label="Оголошення">
            <Select value={advertisementId} onChange={(event) => setAdvertisementId(event.target.value)}>
              <option value="">Без прив’язаного матеріалу</option>
              {data.advertisements.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
            </Select>
          </Field>
          <Field label="Мова">
            <Select value={language} onChange={(event) => setLanguage(event.target.value)}>
              <option value="">Не вказувати</option>
              <option value="uk">Українська</option>
              <option value="ru">Російська</option>
            </Select>
          </Field>
          <Button variant="action" size="md" busy={saving} disabled={telegram && !accountId} onClick={() => void save()}>{saving ? 'Зберігаємо…' : 'Додати до звіту'}</Button>
        </div>
      ) : null}
    </div>
  );
}

function LessonForm({ date, enabled }: { date: string; enabled: boolean }) {
  const toast = useToast();
  const [attempt, setAttempt] = useState(0);
  const [lessonId, setLessonId] = useState('');
  const [status, setStatus] = useState<'completed' | 'cancelled' | 'no-show'>('completed');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const { data, error } = useRemote<{ lessons: Array<{ lessonId: string; leadId: string; leadName: string; studentName: string; subject: string; lessonTime: string; status: string }> }>(`/api/reports/lesson-result-correction?date=${encodeURIComponent(date)}`, { refresh: attempt, enabled, fallback: 'Не вдалося завантажити уроки.' });
  const needsReason = status !== 'completed';

  const save = async () => {
    if (!lessonId || saving || (needsReason && !reason.trim())) return;
    setSaving(true);
    try {
      await post('/api/reports/lesson-result-correction', { requestId, date, lessonId, status, reason }, 'Не вдалося зберегти результат уроку.');
      toast.push({ message: `Результат уроку за ${formatDate(date)} збережено. Оновіть звіт, щоб побачити новий підсумок.`, tone: 'ok' });
      setLessonId(''); setReason(''); setStatus('completed'); setRequestId(crypto.randomUUID());
      setAttempt((value) => value + 1);
    } catch (failure) {
      toast.push({ message: failure instanceof Error ? failure.message : 'Не вдалося зберегти результат уроку.', tone: 'hot' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Note>Доступні лише незавершені уроки, заплановані на {formatDate(date)}. Фактичний час внесення зберігається окремо від дати обліку.</Note>
      {error && !data ? <Retry message={error} onRetry={() => setAttempt((value) => value + 1)} /> : !data ? <Loading /> : data.lessons.length === 0 ? (
        <EmptyState text="Незавершених уроків на цю дату немає." />
      ) : (
        <ul aria-label="Уроки" className="m-0 flex list-none flex-col gap-2 p-0">
          {data.lessons.map((lesson) => <Pick key={lesson.lessonId} selected={lesson.lessonId === lessonId} onClick={() => setLessonId(lesson.lessonId)} title={`${lesson.studentName || lesson.leadName} · ${lesson.subject}`} hint={`${lesson.lessonTime || 'час не вказано'} · лід: ${lesson.leadName}`} />)}
        </ul>
      )}
      {lessonId ? (
        <div className="flex flex-col gap-3 border-t border-line pt-4">
          <Field label="Результат">
            <Select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
              <option value="completed">Проведено</option>
              <option value="cancelled">Скасовано</option>
              <option value="no-show">Не з’явився</option>
            </Select>
          </Field>
          <Field label={needsReason ? 'Причина (обов’язково)' : 'Причина (необов’язково)'}>
            <Input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={2000} />
          </Field>
          <Button variant="action" size="md" busy={saving} disabled={needsReason && !reason.trim()} onClick={() => void save()}>{saving ? 'Зберігаємо…' : 'Зберегти результат'}</Button>
        </div>
      ) : null}
    </div>
  );
}

const TELEGRAM_LINK = /(?:^|\/\/)(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)(?:\/|$)/i;

function ChatForm({ date, enabled }: { date: string; enabled: boolean }) {
  const toast = useToast();
  const id = useId();
  const [link, setLink] = useState('');
  const [name, setName] = useState('');
  const [accountId, setAccountId] = useState('');
  const [saving, setSaving] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const telegram = TELEGRAM_LINK.test(link.trim());
  const { data, loading } = useRemote<{ accounts: Account[] }>('/api/reports/chat-correction', { enabled: enabled && telegram, fallback: 'Не вдалося завантажити Telegram-акаунти.' });

  const save = async () => {
    if (!link.trim() || saving || (telegram && !accountId)) return;
    setSaving(true);
    try {
      const result = await post('/api/reports/chat-correction', { requestId, date, name, link, telegramAccountId: telegram ? accountId : null }, 'Не вдалося додати історичний чат.');
      toast.push({ message: `${result.name || 'Чат'} додано до звіту за ${formatDate(date)}.`, tone: 'ok' });
      setLink(''); setName(''); setAccountId(''); setRequestId(crypto.randomUUID());
    } catch (reason) {
      toast.push({ message: reason instanceof Error ? reason.message : 'Не вдалося додати історичний чат.', tone: 'hot' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Note>Додавай чат лише якщо він реально був приєднаний {formatDate(date)}. Work OS збереже підтверджену дату для звіту, але не вигадуватиме точний час і не змінюватиме поточний прогрів Telegram. Для Telegram за сьогодні 6-годинне очікування рахується від моменту внесення.</Note>
      <Field label="Посилання" htmlFor={`${id}-link`}>
        <Input id={`${id}-link`} value={link} onChange={(event) => setLink(event.target.value)} maxLength={2048} placeholder="https://t.me/…" autoComplete="off" />
      </Field>
      <Field label="Назва" htmlFor={`${id}-name`} hint="Необов’язково — можна визначити з посилання.">
        <Input id={`${id}-name`} value={name} onChange={(event) => setName(event.target.value)} maxLength={1000} />
      </Field>
      {telegram ? (
        <Field label="Telegram-акаунт">
          <Select value={accountId} disabled={loading} onChange={(event) => setAccountId(event.target.value)}>
            <option value="">Обери акаунт</option>
            {data?.accounts.map((account) => <option key={account.id} value={account.id}>#{account.number} {account.name}{account.enabled ? '' : ' · вимкнений'}</option>)}
          </Select>
        </Field>
      ) : null}
      <Button variant="action" size="md" busy={saving} disabled={!link.trim() || (telegram && !accountId)} onClick={() => void save()}>{saving ? 'Зберігаємо…' : 'Додати чат'}</Button>
    </div>
  );
}

/** Ручні корекції за вибрану дату: історична публікація, результат уроку, новий чат. */
export function CorrectionsPanel({ open, onOpenChange, date, tab, onTabChange }: { open: boolean; onOpenChange: (open: boolean) => void; date: string; tab: CorrectionTab; onTabChange: (tab: CorrectionTab) => void }) {
  return (
    <Panel<CorrectionTab> open={open} onOpenChange={onOpenChange} title="Додати за датою" subtitle={formatDate(date)} tabs={TABS} tab={tab} onTabChange={onTabChange}>
      {tab === 'publication' ? <PublicationForm key={date} date={date} enabled={open} /> : null}
      {tab === 'lesson' ? <LessonForm key={date} date={date} enabled={open} /> : null}
      {tab === 'chat' ? <ChatForm key={date} date={date} enabled={open} /> : null}
    </Panel>
  );
}
