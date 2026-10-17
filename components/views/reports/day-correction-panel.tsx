'use client';

import { useId, useMemo, useState, type ReactNode } from 'react';
import { Plus, X } from 'lucide-react';
import { Panel } from '@/components/shell/panel';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Ghost } from '@/components/ui/ghost';
import { humanError } from '@/components/ui/human-error';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { labels } from '@/components/views/leads/client';
import { Confirmation } from '@/components/views/leads/form';
import { LeadEditor } from '@/components/views/leads/lead-editor';
import { useRemote } from '@/components/views/shared/use-remote';
import { announceDataChange } from '@/lib/client-sync';
import type { ReportEventDetail } from '@/lib/reports/details';
import type { ReportManualAdjustments } from '@/lib/reports/manual-adjustments';
import { cn } from '@/lib/utils';
import { formatDate } from './types';

export type CorrectionTab = 'publications' | 'chats' | 'leads' | 'lessons';

type Metrics = ReportManualAdjustments;
type MetricKey = keyof Metrics;
type Snapshot = { date: string; reportExists: boolean; revision: number | null; facts: Metrics; adjustments: Metrics; totals: Metrics; details: ReportEventDetail[]; error?: string };
type Account = { id: string; number: number; name: string; enabled: boolean };
type StagedPublication = { key: string; chatId: string; name: string; platform: string; accountId: string; advertisementId: string; language: string };
type StagedChat = { key: string; requestId: string; link: string; name: string; accountId: string };
type ResultStatus = 'completed' | 'cancelled' | 'no-show';
type StagedLesson = { requestId: string; status: ResultStatus; reason: string };
type LessonOption = { lessonId: string; leadId: string; leadName: string; studentName: string; subject: string; lessonTime: string; status: string };

const ZERO: Metrics = { publications: 0, responses: 0, bookings: 0 };
const TAB_BASE = [
  { value: 'publications', label: 'Публікації' },
  { value: 'chats', label: 'Нові чати' },
  { value: 'leads', label: 'Відгуки й записи' },
  { value: 'lessons', label: 'Уроки' },
] as const;
const RESULT_LABEL: Record<ResultStatus, string> = { completed: 'Проведено', cancelled: 'Скасовано', 'no-show': 'Не з’явився' };
const TELEGRAM_LINK = /(?:^|\/\/)(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)(?:\/|$)/i;

async function send<T>(url: string, body: unknown, fallback: string): Promise<T> {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(value.error || fallback);
  return value;
}

function Loading() {
  return <div aria-busy="true" className="flex flex-col gap-2"><Ghost className="h-14 rounded-inner" /><Ghost className="h-14 rounded-inner" /></div>;
}

function Note({ children }: { children: ReactNode }) {
  return <p className="m-0 text-[13px] text-ink-2">{children}</p>;
}

function Sub({ title, children }: { title: string; children: ReactNode }) {
  return <section className="flex flex-col gap-3 border-t border-line pt-4" aria-label={title}><h3 className="m-0 text-sm font-medium">{title}</h3>{children}</section>;
}

function sourcesOf(key: MetricKey, details: readonly ReportEventDetail[]): ReportEventDetail[] {
  if (key === 'publications') return details.filter((event) => event.eventType === 'publication');
  if (key === 'responses') return details.filter((event) => event.eventType === 'lead_created');
  return details.filter((event) => event.eventType === 'lesson_booked' || event.eventType === 'curator_booking_pending');
}

function SourceList({ events, name }: { events: readonly ReportEventDetail[]; name: (event: ReportEventDetail) => string }) {
  return events.length === 0 ? <p className="m-0 mt-2 text-xs text-ink-2">Активних джерел немає.</p> : (
    <ul className="m-0 mt-2 flex list-none flex-col p-0">
      {events.map((event) => (
        <li key={event.id} className="border-t border-line py-2 first:border-t-0">
          <p className="m-0 truncate text-sm">{name(event)}</p>
          <p className="m-0 truncate text-xs text-ink-2">{labels[event.platform || ''] ?? event.platform ?? 'Платформа не вказана'}{event.lessonSubject || event.leadSubject ? ` · ${event.lessonSubject || event.leadSubject}` : ''}</p>
        </li>
      ))}
    </ul>
  );
}

/** Рядок показника: ліворуч авто-факт із джерелами, праворуч правка (різниця у звіті); змінений рядок підсвічений. */
function MetricRow({ label, fact, value, onChange, disabled, sources, sourceName }: { label: string; fact: number; value: number; onChange: (value: number) => void; disabled: boolean; sources: readonly ReportEventDetail[]; sourceName: (event: ReportEventDetail) => string }) {
  const changed = value !== 0;
  return (
    <li className={cn('rounded-inner border border-line p-3', changed && 'bg-raised')}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_96px_auto] items-center gap-x-3">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-right font-mono text-[15px]" aria-label={`Авто-факт: ${fact}`}>{fact}</span>
        <Input type="number" inputMode="numeric" aria-label={`Правка: ${label}`} min={-fact} max={9999} step={1} value={value} disabled={disabled} onChange={(event) => { const next = Number(event.target.value); if (Number.isSafeInteger(next) && Math.abs(next) <= 9999) onChange(next); }} />
        <span className="text-right font-mono text-[15px]" aria-label={`У звіті: ${fact + value}`}>{fact + value}</span>
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-ink-2 hover:text-ink">Джерела авто-факту ({sources.length})</summary>
        <SourceList events={sources} name={sourceName} />
      </details>
    </li>
  );
}

function MetricHeader() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_96px_auto] items-center gap-x-3 text-xs text-ink-2">
      <span /><span className="text-right">Авто-факт</span><span>Правка</span><span className="text-right">У звіті</span>
    </div>
  );
}

function Staged({ children, onRemove, label }: { children: ReactNode; onRemove: () => void; label: string }) {
  return (
    <li className="flex items-start justify-between gap-2 rounded-inner border border-line bg-raised px-3.5 py-2.5">
      <div className="min-w-0">{children}</div>
      <Button variant="icon" size="sm" aria-label={label} onClick={onRemove}><X aria-hidden="true" strokeWidth={1.5} /></Button>
    </li>
  );
}

function PublicationAdder({ date, enabled, taken, onAdd }: { date: string; enabled: boolean; taken: ReadonlySet<string>; onAdd: (item: StagedPublication) => void }) {
  const [search, setSearch] = useState('');
  const [platform, setPlatform] = useState('');
  const [applied, setApplied] = useState({ search: '', platform: '' });
  const [chatId, setChatId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [advertisementId, setAdvertisementId] = useState('');
  const [language, setLanguage] = useState('');
  const url = useMemo(() => {
    const params = new URLSearchParams({ date });
    if (applied.search.trim()) params.set('search', applied.search.trim());
    if (applied.platform) params.set('platform', applied.platform);
    return `/api/reports/publication-correction?${params}`;
  }, [date, applied]);
  const { data, error, loading } = useRemote<{ chats: Array<{ id: string; name: string; link: string; platform: string; status: string; telegramAccountId: string | null }>; accounts: Account[]; advertisements: Array<{ id: string; title: string }> }>(url, { enabled, fallback: 'Не вдалося завантажити чати.' });
  const chats = data?.chats.filter((item) => !taken.has(item.id)) ?? [];
  const chat = chats.find((item) => item.id === chatId) ?? null;
  const telegram = chat?.platform === 'telegram';
  const choose = (id: string) => {
    setChatId(id);
    const picked = chats.find((item) => item.id === id);
    setAccountId(picked?.platform === 'telegram' ? picked.telegramAccountId || data?.accounts.find((account) => account.enabled)?.id || data?.accounts[0]?.id || '' : '');
  };
  return (
    <div className="flex flex-col gap-3">
      <form className="flex flex-col gap-2" onSubmit={(event) => { event.preventDefault(); setApplied({ search, platform }); setChatId(''); }}>
        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Назва або посилання чату" aria-label="Пошук чату" />
        <div className="flex gap-2">
          <Select aria-label="Платформа" value={platform} onChange={(event) => setPlatform(event.target.value)}>
            <option value="">Усі платформи</option>
            {['telegram', 'whatsapp', 'viber', 'facebook', 'threads'].map((key) => <option key={key} value={key}>{labels[key]}</option>)}
          </Select>
          <Button type="submit" variant="outline" size="md" disabled={loading}>Знайти</Button>
        </div>
      </form>
      {error && !data ? <p role="alert" className="m-0 text-sm text-hot">{error}</p> : !data ? <Loading /> : chats.length === 0 ? (
        <EmptyState text="Чатів без уже зафіксованої публікації на цю дату не знайдено." />
      ) : (
        <ul aria-label="Чати для корекції" className="m-0 flex max-h-72 list-none flex-col gap-2 overflow-y-auto p-0">
          {chats.map((item) => (
            <li key={item.id}>
              <button type="button" aria-pressed={item.id === chatId} onClick={() => choose(item.id)} className={cn('flex w-full flex-col rounded-inner border px-3.5 py-2.5 text-left transition-colors duration-200 active:scale-[0.985]', item.id === chatId ? 'border-line-strong bg-raised' : 'border-line hover:bg-raised')}>
                <span className="truncate text-sm font-medium">{item.name}</span>
                <span className="truncate text-xs text-ink-2">{labels[item.platform] ?? item.platform} · {item.status} · {item.link}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {chat && data ? (
        <div className="flex flex-col gap-3 border-t border-line pt-3">
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
          <Button variant="outline" size="md" disabled={telegram && !accountId} onClick={() => { onAdd({ key: crypto.randomUUID(), chatId: chat.id, name: chat.name, platform: chat.platform, accountId, advertisementId, language }); setChatId(''); setAdvertisementId(''); setLanguage(''); }}>Додати до правок</Button>
        </div>
      ) : null}
    </div>
  );
}

function ChatAdder({ enabled, onAdd }: { enabled: boolean; onAdd: (item: StagedChat) => void }) {
  const id = useId();
  const [link, setLink] = useState('');
  const [name, setName] = useState('');
  const [accountId, setAccountId] = useState('');
  const telegram = TELEGRAM_LINK.test(link.trim());
  const { data, loading } = useRemote<{ accounts: Account[] }>('/api/reports/chat-correction', { enabled: enabled && telegram, fallback: 'Не вдалося завантажити Telegram-акаунти.' });
  return (
    <div className="flex flex-col gap-3">
      <Field label="Посилання" htmlFor={`${id}-link`}>
        <Input id={`${id}-link`} value={link} onChange={(event) => setLink(event.target.value)} maxLength={2048} placeholder="https://t.me/…" autoComplete="off" />
      </Field>
      <Field label="Назва" htmlFor={`${id}-name`} hint="Необов’язково: можна визначити з посилання.">
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
      <Button variant="outline" size="md" disabled={!link.trim() || (telegram && !accountId)} onClick={() => { onAdd({ key: crypto.randomUUID(), requestId: crypto.randomUUID(), link: link.trim(), name: name.trim(), accountId: telegram ? accountId : '' }); setLink(''); setName(''); setAccountId(''); }}>Додати до правок</Button>
    </div>
  );
}

/**
 * Inspector «Корекція дня»: єдине місце, де правиться звіт за дату. Ліворуч авто-факт із подій, праворуч правка; змінене
 * підсвічене. Правки (числа звіту, додані публікації й чати, результати уроків) накопичуються й записуються одним
 * «Зберегти»: після нього звіт перечитується, а рядки цілей у тексті оновлюються.
 */
export function DayCorrectionPanel({ open, onOpenChange, date, tab, onTabChange, onEnsureDraft, onSaved, onCreateLead }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: string;
  tab: CorrectionTab;
  onTabChange: (tab: CorrectionTab) => void;
  /** Зберігає чернетку звіту, якщо його ще немає (числа корекції живуть у звіті); false — не вийшло. */
  onEnsureDraft: () => Promise<boolean>;
  onSaved: () => void;
  onCreateLead: (values: Record<string, unknown>) => Promise<void>;
}) {
  const toast = useToast();
  const [attempt, setAttempt] = useState(0);
  const [deltaDraft, setDeltaDraft] = useState<Metrics | null>(null);
  const [pubs, setPubs] = useState<StagedPublication[]>([]);
  const [chats, setChats] = useState<StagedChat[]>([]);
  const [lessons, setLessons] = useState<Record<string, StagedLesson>>({});
  const [addingPublication, setAddingPublication] = useState(false);
  const [addingChat, setAddingChat] = useState(false);
  const [creatingLead, setCreatingLead] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const snapshot = useRemote<Snapshot>(`/api/reports/manual-adjustments?date=${encodeURIComponent(date)}`, { refresh: attempt, enabled: open, revalidateOnEnable: true, fallback: 'Не вдалося завантажити факт за день.' });
  const lessonList = useRemote<{ lessons: LessonOption[] }>(`/api/reports/lesson-result-correction?date=${encodeURIComponent(date)}`, { refresh: attempt, enabled: open && tab === 'lessons', fallback: 'Не вдалося завантажити уроки.' });
  const data = snapshot.data;
  const values = deltaDraft ?? data?.adjustments ?? ZERO;
  const metricChanged = (key: MetricKey) => Boolean(data) && values[key] !== data!.adjustments[key];
  const invalid = Boolean(data) && (['publications', 'responses', 'bookings'] as const).some((key) => data!.facts[key] + values[key] < 0);
  const lessonsMissingReason = Object.values(lessons).some((item) => item.status !== 'completed' && !item.reason.trim());
  const counts = {
    publications: pubs.length + Number(metricChanged('publications')),
    chats: chats.length,
    leads: Number(metricChanged('responses')) + Number(metricChanged('bookings')),
    lessons: Object.keys(lessons).length,
  };
  const total = counts.publications + counts.chats + counts.leads + counts.lessons;
  const tabs = TAB_BASE.map((item) => ({ value: item.value, label: counts[item.value] ? `${item.label} · ${counts[item.value]}` : item.label }));

  const setMetric = (key: MetricKey, value: number) => setDeltaDraft({ ...values, [key]: value });
  const reset = () => { setDeltaDraft(null); setPubs([]); setChats([]); setLessons({}); setError(''); };

  const save = async () => {
    if (!data || saving || invalid || lessonsMissingReason) return;
    setSaving(true);
    setError('');
    try {
      // Події додаються по одній: те, що вже записано, одразу зникає з правок, тож повтор після збою нічого не задвоїть.
      for (const item of pubs) {
        await send('/api/reports/publication-correction', { date, chatId: item.chatId, telegramAccountId: item.accountId || null, advertisementId: item.advertisementId || null, language: item.language || null }, `Не вдалося додати публікацію в «${item.name}».`);
        setPubs((current) => current.filter((entry) => entry.key !== item.key));
      }
      for (const item of chats) {
        await send('/api/reports/chat-correction', { requestId: item.requestId, date, name: item.name, link: item.link, telegramAccountId: item.accountId || null }, `Не вдалося додати чат ${item.name || item.link}.`);
        setChats((current) => current.filter((entry) => entry.key !== item.key));
      }
      for (const [lessonId, item] of Object.entries(lessons)) {
        await send('/api/reports/lesson-result-correction', { requestId: item.requestId, date, lessonId, status: item.status, reason: item.reason }, 'Не вдалося зберегти результат уроку.');
        setLessons((current) => { const next = { ...current }; delete next[lessonId]; return next; });
      }
      if (metricChanged('publications') || metricChanged('responses') || metricChanged('bookings')) {
        let fresh = await fetchSnapshot(date);
        if (!fresh.reportExists || fresh.revision === null) {
          if (!await onEnsureDraft()) throw new Error('Числа звіту зберігаються разом зі звітом: спершу додай текст звіту й збережи чернетку.');
          fresh = await fetchSnapshot(date);
        }
        if ((['publications', 'responses', 'bookings'] as const).some((key) => fresh.facts[key] + values[key] < 0)) throw new Error('Підсумкове число не може бути від’ємним.');
        await send('/api/reports/manual-adjustments', { date, adjustments: values, expectedRevision: fresh.revision }, 'Не вдалося зберегти правку чисел.');
      }
      setDeltaDraft(null);
      announceDataChange('all');
      toast.push({ message: `Корекцію за ${formatDate(date)} збережено. Звіт оновлено.`, tone: 'ok' });
      setAttempt((value) => value + 1);
      onSaved();
    } catch (reason) {
      const message = humanError(reason, 'Не вдалося зберегти корекцію.');
      setError(message);
      toast.push({ message, tone: 'hot', duration: 7000 });
      setAttempt((value) => value + 1);
    } finally {
      setSaving(false);
    }
  };

  const takenChats = useMemo(() => new Set(pubs.map((item) => item.chatId)), [pubs]);
  const loadingData = !data && !snapshot.error;

  return (
    <Panel<CorrectionTab>
      open={open}
      onOpenChange={(next) => { if (!next && total > 0 && !saving) setLeaving(true); else onOpenChange(next); }}
      title="Корекція дня"
      subtitle={formatDate(date)}
      tabs={tabs}
      tab={tab}
      onTabChange={onTabChange}
      footer={(
        <div className="flex flex-col gap-2">
          {error ? <p role="alert" className="m-0 text-sm text-hot">{error}</p> : null}
          {invalid ? <p role="alert" className="m-0 text-sm text-hot">Підсумкове число не може бути від’ємним.</p> : null}
          <div className="flex items-center justify-between gap-3">
            <Button variant="ghost" size="sm" disabled={saving || total === 0} onClick={reset}>Скасувати зміни</Button>
            <Button variant="action" size="sm" busy={saving} disabled={saving || total === 0 || invalid || lessonsMissingReason || !data} onClick={() => void save()}>{saving ? 'Зберігаємо…' : `Зберегти${total ? ` (${total})` : ''}`}</Button>
          </div>
        </div>
      )}
    >
      {snapshot.error && !data ? (
        <div className="flex flex-col items-start gap-3">
          <p role="alert" className="m-0 text-sm text-hot">{snapshot.error}</p>
          <Button variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>Спробувати ще раз</Button>
        </div>
      ) : loadingData ? <Loading /> : data ? (
        <div className="flex flex-col gap-5">
          <Note>Авто-числа беруться з подій. Додані події (публікації, чати, результати уроків) потрапляють у всю статистику; правка чисел змінює лише звіт, «Сьогодні» й «Аналітика» від неї не змінюються.</Note>
          {tab === 'publications' ? (
            <>
              <MetricHeader />
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                <MetricRow label="Оголошення" fact={data.facts.publications} value={values.publications} onChange={(value) => setMetric('publications', value)} disabled={saving} sources={sourcesOf('publications', data.details)} sourceName={(event) => event.chatName || 'Чат недоступний'} />
              </ul>
              <Sub title="Додати публікацію, якої не було в обліку">
                {pubs.length ? (
                  <ul aria-label="Додані публікації" className="m-0 flex list-none flex-col gap-2 p-0">
                    {pubs.map((item) => (
                      <Staged key={item.key} label={`Прибрати публікацію в «${item.name}»`} onRemove={() => setPubs((current) => current.filter((entry) => entry.key !== item.key))}>
                        <p className="m-0 truncate text-sm font-medium">{item.name}</p>
                        <p className="m-0 truncate text-xs text-ink-2">{labels[item.platform] ?? item.platform} · +1 публікація за {formatDate(date)}</p>
                      </Staged>
                    ))}
                  </ul>
                ) : null}
                {addingPublication ? <PublicationAdder date={date} enabled={open} taken={takenChats} onAdd={(item) => setPubs((current) => [...current, item])} /> : null}
                <div><Button variant="outline" size="sm" onClick={() => setAddingPublication((value) => !value)}><Plus aria-hidden="true" strokeWidth={1.5} />{addingPublication ? 'Сховати вибір чату' : 'Додати публікацію'}</Button></div>
              </Sub>
            </>
          ) : null}
          {tab === 'chats' ? (
            <>
              <div className="rounded-inner border border-line p-3">
                <div className="flex items-center justify-between gap-3"><span className="text-sm font-medium">Приєднані чати</span><span className="font-mono text-[15px]" aria-label={`Авто-факт: ${data.details.filter((event) => event.eventType === 'chat_joined').length}`}>{data.details.filter((event) => event.eventType === 'chat_joined').length}</span></div>
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-ink-2 hover:text-ink">Джерела авто-факту ({data.details.filter((event) => event.eventType === 'chat_joined').length})</summary>
                  <SourceList events={data.details.filter((event) => event.eventType === 'chat_joined')} name={(event) => event.chatName || 'Чат недоступний'} />
                </details>
              </div>
              <Sub title="Додати чат, який був приєднаний цього дня">
                <Note>Додавай чат лише якщо він реально був приєднаний {formatDate(date)}. Для Telegram за сьогодні 6-годинне очікування рахується від моменту внесення.</Note>
                {chats.length ? (
                  <ul aria-label="Додані чати" className="m-0 flex list-none flex-col gap-2 p-0">
                    {chats.map((item) => (
                      <Staged key={item.key} label={`Прибрати чат ${item.name || item.link}`} onRemove={() => setChats((current) => current.filter((entry) => entry.key !== item.key))}>
                        <p className="m-0 truncate text-sm font-medium">{item.name || item.link}</p>
                        <p className="m-0 truncate text-xs text-ink-2">{item.link}</p>
                      </Staged>
                    ))}
                  </ul>
                ) : null}
                {addingChat ? <ChatAdder enabled={open} onAdd={(item) => setChats((current) => [...current, item])} /> : null}
                <div><Button variant="outline" size="sm" onClick={() => setAddingChat((value) => !value)}><Plus aria-hidden="true" strokeWidth={1.5} />{addingChat ? 'Сховати форму чату' : 'Додати чат'}</Button></div>
              </Sub>
            </>
          ) : null}
          {tab === 'leads' ? (
            <>
              <MetricHeader />
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                <MetricRow label="Відгуки" fact={data.facts.responses} value={values.responses} onChange={(value) => setMetric('responses', value)} disabled={saving} sources={sourcesOf('responses', data.details)} sourceName={(event) => event.leadName || 'Лід недоступний'} />
                <MetricRow label="Записи" fact={data.facts.bookings} value={values.bookings} onChange={(value) => setMetric('bookings', value)} disabled={saving} sources={sourcesOf('bookings', data.details)} sourceName={(event) => event.leadName || 'Лід недоступний'} />
              </ul>
              <Sub title="Ліда, якого не було в обліку">
                <Note>Новий лід з датою відгуку {formatDate(date)} потрапить у цей день одразу після збереження картки ліда (окремо від правок вище).</Note>
                <div><Button variant="outline" size="sm" onClick={() => setCreatingLead(true)}><Plus aria-hidden="true" strokeWidth={1.5} />Новий лід за дату</Button></div>
              </Sub>
            </>
          ) : null}
          {tab === 'lessons' ? (
            <Sub title="Результат уроків за дату">
              <Note>Доступні лише незавершені уроки, заплановані на {formatDate(date)}. Фактичний час внесення зберігається окремо від дати обліку.</Note>
              {lessonList.error && !lessonList.data ? <p role="alert" className="m-0 text-sm text-hot">{lessonList.error}</p> : !lessonList.data ? <Loading /> : lessonList.data.lessons.length === 0 ? (
                <EmptyState text="Незавершених уроків на цю дату немає." />
              ) : (
                <ul aria-label="Уроки" className="m-0 flex list-none flex-col gap-3 p-0">
                  {lessonList.data.lessons.map((lesson) => {
                    const staged = lessons[lesson.lessonId];
                    return (
                      <li key={lesson.lessonId} className={cn('flex flex-col gap-2 rounded-inner border border-line p-3', staged && 'bg-raised')}>
                        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,160px)] items-center gap-3">
                          <div className="min-w-0">
                            <p className="m-0 truncate text-sm font-medium">{lesson.studentName || lesson.leadName} · {lesson.subject}</p>
                            <p className="m-0 truncate text-xs text-ink-2">{lesson.lessonTime || 'час не вказано'} · {labels[lesson.status] ?? lesson.status}</p>
                          </div>
                          <Select aria-label={`Результат уроку: ${lesson.studentName || lesson.leadName}`} value={staged?.status ?? ''} disabled={saving} onChange={(event) => {
                            const status = event.target.value as ResultStatus | '';
                            setLessons((current) => {
                              const next = { ...current };
                              if (!status) delete next[lesson.lessonId];
                              else next[lesson.lessonId] = { requestId: current[lesson.lessonId]?.requestId ?? crypto.randomUUID(), status, reason: current[lesson.lessonId]?.reason ?? '' };
                              return next;
                            });
                          }}>
                            <option value="">Без змін</option>
                            {(Object.keys(RESULT_LABEL) as ResultStatus[]).map((status) => <option key={status} value={status}>{RESULT_LABEL[status]}</option>)}
                          </Select>
                        </div>
                        {staged && staged.status !== 'completed' ? (
                          <Field label="Причина (обов’язково)">
                            <Input value={staged.reason} maxLength={2000} disabled={saving} onChange={(event) => setLessons((current) => ({ ...current, [lesson.lessonId]: { ...staged, reason: event.target.value } }))} />
                          </Field>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Sub>
          ) : null}
        </div>
      ) : null}
      {creatingLead ? (
        <LeadEditor
          defaultResponseDate={date}
          close={() => setCreatingLead(false)}
          save={async (values) => { await onCreateLead(values); setAttempt((value) => value + 1); }}
        />
      ) : null}
      {leaving ? (
        <Confirmation
          title="Закрити без збереження?"
          description="Внесені правки не збережені й зникнуть."
          close={() => setLeaving(false)}
          run={async () => { reset(); onOpenChange(false); }}
        />
      ) : null}
    </Panel>
  );
}

async function fetchSnapshot(date: string): Promise<Snapshot> {
  const response = await fetch(`/api/reports/manual-adjustments?date=${encodeURIComponent(date)}`, { cache: 'no-store' });
  const body = await response.json().catch(() => ({})) as Snapshot;
  if (!response.ok) throw new Error(body.error || 'Не вдалося оновити факт за день.');
  return body;
}
