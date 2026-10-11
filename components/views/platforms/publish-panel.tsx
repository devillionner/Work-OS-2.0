'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, Copy, ExternalLink, Lock, Send } from 'lucide-react';
import { Panel } from '@/components/shell/panel';
import { Button } from '@/components/ui/button';
import { Ghost } from '@/components/ui/ghost';
import { Input, Textarea } from '@/components/ui/input';
import { SearchField } from '@/components/ui/search-field';
import type { ChatProfile } from '@/lib/chats/profile';
import { cn } from '@/lib/utils';
import { humanError } from '@/components/ui/human-error';

export type PublishChat = { id: string; name: string; link: string; platform: string; profileConfirmed: boolean; profile: ChatProfile };
type PublicationDetails = { advertisementId: string | null; language: 'uk' | 'ru' | null };
type AdvertisementItem = {
  id: string; title: string; ukText: string; ruText: string; notes: string; tags: string[]; platforms: string[];
  suggestedLanguage: 'uk' | 'ru' | null; usedToday: boolean; selectable: boolean; recommended: boolean; directionMatch: 'matched' | 'generic' | 'other'; note: string | null;
};
type FocusPlan = {
  currentDirections: string[]; planDirections: string[]; planCreatedAt: number; currentFocusUpdatedAt: number; stale: boolean; addedDirections: string[]; removedDirections: string[];
  source: 'workday' | 'current-focus'; workday: { id: string; workDate: string; version: number } | null;
};
type SelectionPayload = { items: AdvertisementItem[]; publicationAllowed: boolean; publicationReason: string | null; focusPlan: FocusPlan; error?: string };
type Derived = { items: AdvertisementItem[]; rule: { allowed: boolean; reason: string | null }; focusPlan: FocusPlan | null; selectedId: string | null; language: 'uk' | 'ru' | null; notice: string };

const cache = new Map<string, SelectionPayload>();

function derive(payload: SelectionPayload, current: string | null, quickMode: boolean, preferred: string | null, chatLanguage: 'uk' | 'ru' | null | undefined): Derived {
  const rule = { allowed: payload.publicationAllowed !== false, reason: payload.publicationReason || null };
  let selectedId: string | null = current && payload.items.some((item) => item.id === current && item.selectable) ? current : null;
  let language: 'uk' | 'ru' | null = null;
  let notice = '';
  if (!selectedId && quickMode && preferred) {
    const item = payload.items.find((value) => value.id === preferred);
    selectedId = item?.selectable ? item.id : null;
  }
  if (quickMode && preferred) {
    const item = payload.items.find((value) => value.id === preferred);
    if (item?.selectable) { language = item.suggestedLanguage || (chatLanguage === 'ru' ? 'ru' : 'uk'); notice = 'Матеріал швидкого режиму підставлено автоматично.'; }
    else notice = 'Матеріал швидкого режиму не підходить цьому чату за відомими правилами. Пропусти чат або заверши швидкий режим.';
  }
  return { items: payload.items, rule, focusPlan: payload.focusPlan || null, selectedId, language, notice };
}

/** Публікація в чаті: підбір матеріалу, мова, копіювання тексту, фіксація факту публікації. Швидкий режим Viber/WhatsApp. */
export function PublishPanel({ open, chat, quickMode = false, preferredAdvertisementId = null, onClose, onPublished, onOpenChat }: {
  open: boolean;
  chat: PublishChat | null;
  quickMode?: boolean;
  preferredAdvertisementId?: string | null;
  onClose: () => void;
  onPublished: (details: PublicationDetails) => Promise<boolean>;
  onOpenChat: () => void;
}) {
  return (
    <Panel open={open && chat !== null} onOpenChange={(next) => { if (!next) onClose(); }} title={quickMode ? 'Швидка публікація' : 'Підготувати публікацію'} subtitle={chat ? `${chat.name} · ${quickMode ? 'матеріал обирається один раз для серії, а факт публікації ти підтверджуєш для кожного чату вручну.' : 'невикористані придатні оголошення йдуть першими, публікацію ти робиш вручну.'}` : undefined}>
      {chat ? <PublishBody key={chat.id} chat={chat} quickMode={quickMode} preferred={preferredAdvertisementId} onClose={onClose} onPublished={onPublished} onOpenChat={onOpenChat} /> : null}
    </Panel>
  );
}

function PublishBody({ chat, quickMode, preferred, onClose, onPublished, onOpenChat }: { chat: PublishChat; quickMode: boolean; preferred: string | null; onClose: () => void; onPublished: (details: PublicationDetails) => Promise<boolean>; onOpenChat: () => void }) {
  const chatLanguage = chat.profile.language;
  const cached = cache.get(chat.id);
  const initial = cached ? derive(cached, null, quickMode, preferred, chatLanguage) : null;
  const [items, setItems] = useState<AdvertisementItem[]>(initial?.items ?? []);
  const [selectedId, setSelectedId] = useState<string | null>(initial?.selectedId ?? null);
  const [language, setLanguage] = useState<'uk' | 'ru'>(initial?.language ?? (chatLanguage === 'ru' ? 'ru' : 'uk'));
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(initial?.notice ?? '');
  const [rule, setRule] = useState(initial?.rule ?? { allowed: true, reason: null as string | null });
  const [focusPlan, setFocusPlan] = useState<FocusPlan | null>(initial?.focusPlan ?? null);
  const [focusDecision, setFocusDecision] = useState<'kept' | 'refreshed' | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    fetch(`/api/chats/advertisements?chatId=${encodeURIComponent(chat.id)}`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const value: unknown = await response.json();
        if (!response.ok) throw new Error(value && typeof value === 'object' && 'error' in value && typeof value.error === 'string' ? value.error : 'Не вдалося підібрати оголошення.');
        if (!value || typeof value !== 'object' || !Array.isArray((value as SelectionPayload).items)) throw new Error('Не вдалося прочитати підбір оголошень.');
        if (controller.signal.aborted) return;
        const payload = value as SelectionPayload;
        cache.set(chat.id, payload);
        const next = derive(payload, null, quickMode, preferred, chatLanguage);
        setItems(next.items); setRule(next.rule); setFocusPlan(next.focusPlan); setSelectedId((current) => derive(payload, current, quickMode, preferred, chatLanguage).selectedId);
        if (next.language) setLanguage(next.language);
        if (next.notice) setNotice(next.notice);
      })
      .catch((reason) => { if (!controller.signal.aborted) setError(humanError(reason, 'Не вдалося підібрати оголошення. Перевір з’єднання.')); })
      .finally(() => { clearTimeout(timeout); if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); clearTimeout(timeout); };
  }, [chat.id, chatLanguage, quickMode, preferred]);

  const visible = useMemo(() => {
    const candidates = quickMode && preferred ? items.filter((item) => item.id === preferred) : items;
    const needle = search.trim().toLocaleLowerCase('uk-UA');
    if (!needle) return candidates;
    return candidates.filter((item) => `${item.title} ${item.ukText} ${item.ruText} ${item.notes} ${item.tags.join(' ')}`.toLocaleLowerCase('uk-UA').includes(needle));
  }, [items, search, quickMode, preferred]);

  const selected = items.find((item) => item.id === selectedId) || null;
  const text = selected ? (language === 'ru' ? selected.ruText || selected.ukText : selected.ukText || selected.ruText) : '';
  const publicationLanguage = selected ? (language === 'ru' && selected.ruText ? 'ru' : selected.ukText ? 'uk' : selected.ruText ? 'ru' : null) : null;
  const profileMissing = !chat.profileConfirmed && chat.platform === 'telegram';

  function selectItem(item: AdvertisementItem) {
    if (!item.selectable) return;
    setSelectedId(item.id);
    if (item.suggestedLanguage) setLanguage(item.suggestedLanguage);
    setNotice(item.note || '');
  }

  async function refreshFocusPlan() {
    if (!focusPlan?.workday || busy) return;
    setBusy(true); setError('');
    try {
      const workday = focusPlan.workday;
      const response = await fetch('/api/workday', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'refresh-plan', id: workday.id, workDate: workday.workDate, expectedVersion: workday.version }) });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : 'Не вдалося оновити план дня.');
      const selectionResponse = await fetch(`/api/chats/advertisements?chatId=${encodeURIComponent(chat.id)}`, { cache: 'no-store' });
      const selectionValue: unknown = await selectionResponse.json();
      if (!selectionResponse.ok || !selectionValue || typeof selectionValue !== 'object' || !Array.isArray((selectionValue as SelectionPayload).items)) throw new Error('План оновлено, але не вдалося перечитати підбір. Відкрий панель ще раз.');
      const payload = selectionValue as SelectionPayload;
      setItems(payload.items); setFocusPlan(payload.focusPlan); setRule({ allowed: payload.publicationAllowed !== false, reason: payload.publicationReason || null }); setSelectedId(null); setFocusDecision('refreshed');
      setNotice('Невиконану частину плану оновлено під поточний фокус. Уже опубліковані пункти не змінено.');
    } catch (reason) { setError(humanError(reason, 'Не вдалося оновити план дня.')); }
    finally { setBusy(false); }
  }

  async function copyText() {
    if (!text) return;
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); setNotice('Текст скопійовано в буфер обміну.'); }
    catch { setError('Не вдалося скопіювати текст. Виділи його та скопіюй вручну.'); }
  }

  async function publish() {
    if (busy || !rule.allowed || (quickMode && !selectedId)) return;
    setBusy(true); setError('');
    try { if (await onPublished({ advertisementId: selectedId, language: publicationLanguage })) onClose(); }
    catch (reason) { setError(humanError(reason, 'Не вдалося відмітити публікацію. Онови список і спробуй ще раз.')); }
    finally { setBusy(false); }
  }

  const warning = (message: string) => (
    <output className="flex items-start gap-2 rounded-inner border border-warn/40 px-4 py-3 text-sm"><AlertCircle aria-hidden="true" strokeWidth={1.5} className="mt-0.5 size-4 shrink-0 text-warn" /><span>{message}</span></output>
  );

  return (
    <div className="flex flex-col gap-4">
      {error ? <p role="alert" className="m-0 text-sm text-hot">{error}</p> : null}
      {notice ? <output className="block text-sm text-ink-2">{notice}</output> : null}
      <div className="flex items-start justify-between gap-3 rounded-inner border border-line bg-sunken px-4 py-3">
        <div className="min-w-0"><p className="m-0 truncate text-sm font-medium">{chat.name}</p><p className="m-0 break-all font-mono text-[11px] text-ink-2">{chat.link}</p></div>
        <Button variant="outline" size="sm" disabled={busy} onClick={onOpenChat}><ExternalLink aria-hidden="true" strokeWidth={1.5} />Відкрити</Button>
      </div>
      {profileMissing ? warning('Профіль чату ще не підтверджено — публікацію це не блокує, але правила частоти й напрямку для цього чату не перевіряються. Чат лишиться в черзі «Уточнити профіль».') : null}

      {focusPlan ? (
        <section className="flex flex-col gap-3 rounded-inner border border-line p-4" aria-label="Фокус підбору">
          <h3 className="m-0 text-sm font-medium">Фокус підбору матеріалів</h3>
          <dl className="m-0 grid gap-2 sm:grid-cols-2">
            <div className="rounded-field bg-sunken px-3 py-2"><dt className="text-[11px] text-ink-2">Активний фокус</dt><dd className="m-0 text-xs">{focusPlan.currentDirections.length ? focusPlan.currentDirections.join(' · ') : 'Без обмеження'}</dd></div>
            <div className="rounded-field bg-sunken px-3 py-2"><dt className="text-[11px] text-ink-2">Поточний план</dt><dd className="m-0 text-xs">{focusPlan.planDirections.length ? focusPlan.planDirections.join(' · ') : 'Без обмеження'}</dd></div>
          </dl>
          {focusPlan.stale ? (
            <div className="flex flex-col gap-2">
              {warning(`План застарів після зміни фокусу.${focusPlan.addedDirections.length ? ` Додано: ${focusPlan.addedDirections.join(', ')}.` : ''}${focusPlan.removedDirections.length ? ` Прибрано: ${focusPlan.removedDirections.join(', ')}.` : ''}`)}
              {focusDecision === 'kept' ? <small className="text-xs text-ink-2">Поточний план свідомо залишено для цього сеансу.</small> : (
                <div className="flex flex-wrap gap-2">
                  {focusPlan.workday ? <Button variant="action" size="sm" disabled={busy} onClick={() => void refreshFocusPlan()}>Оновити невиконану частину</Button> : null}
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => { setFocusDecision('kept'); setNotice('Поточний план залишено без змін.'); }}>Залишити поточний</Button>
                </div>
              )}
            </div>
          ) : null}
        </section>
      ) : null}

      {!rule.allowed ? warning(`Публікація зараз недоступна: ${rule.reason || 'правила профілю не дозволяють публікацію на цю дату.'}`) : null}
      {quickMode && preferred && !loading && !selected ? warning('Зафіксований матеріал швидкого режиму тут недоступний. Чат не буде позначено опублікованим без цього матеріалу.') : null}

      {quickMode && preferred ? (
        <div className="flex items-start gap-3 rounded-inner border border-line px-4 py-3"><Lock aria-hidden="true" strokeWidth={1.5} className="mt-0.5 size-4 shrink-0 text-ink-2" /><p className="m-0 text-xs text-ink-2"><strong className="block text-sm font-medium text-ink">Матеріал швидкого режиму зафіксовано</strong>Закріплено для серії чатів. Для кожного чату перевіряються його індивідуальні правила.</p></div>
      ) : (
        <SearchField value={search} onValueChange={setSearch} placeholder="Пошук матеріалу за назвою або текстом" hotkey={false} disabled={busy} />
      )}

      {loading && !items.length ? <div aria-busy="true" className="flex flex-col gap-2">{[0, 1, 2].map((item) => <Ghost key={item} className="h-20 rounded-inner" />)}</div> : visible.length ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Оголошення">
          {visible.map((item) => (
            <li key={item.id}>
              <button type="button" aria-pressed={selectedId === item.id} disabled={loading || busy || !item.selectable} onClick={() => selectItem(item)} className={cn('flex w-full flex-col gap-1.5 rounded-inner border px-4 py-3 text-left transition-colors disabled:opacity-45', selectedId === item.id ? 'border-line-strong bg-raised' : 'border-line hover:bg-raised')}>
                <span className="flex items-center justify-between gap-2"><strong className="truncate text-sm font-medium">{item.title}</strong><span className="flex shrink-0 gap-2 text-[11px] text-ink-2">{item.recommended ? <span className="text-ok">Рекомендовано</span> : null}{item.usedToday ? <span>Сьогодні</span> : null}</span></span>
                <span className="line-clamp-2 text-xs text-ink-2">{item.ukText || item.ruText}</span>
                <span className="text-[11px] text-ink-2">{item.directionMatch === 'matched' ? 'Напрямок збігається' : item.directionMatch === 'other' ? 'Інший напрямок' : 'Універсальний матеріал'}{item.note ? ` · ${item.note}` : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="m-0 rounded-inner border border-dashed border-line-strong px-4 py-5 text-sm text-ink-2">{quickMode ? 'Для швидкого режиму потрібен придатний активний матеріал. Пропусти цей чат або заверши швидкий режим.' : 'Придатних активних оголошень для цієї платформи не знайдено. Публікацію все одно можна відмітити без прив’язаного матеріалу.'}</p>}

      {selected ? (
        <section className="flex flex-col gap-3 rounded-inner border border-line bg-sunken p-4">
          <div className="flex items-center justify-between gap-2">
            <strong className="truncate text-sm font-medium">{selected.title}</strong>
            <div className="flex gap-1.5">
              {(['uk', 'ru'] as const).map((value) => (
                <Button key={value} variant={language === value ? 'action' : 'outline'} size="sm" aria-pressed={language === value} disabled={busy || !(value === 'uk' ? selected.ukText : selected.ruText)} onClick={() => setLanguage(value)}>{value === 'uk' ? 'UA' : 'RU'}</Button>
              ))}
            </div>
          </div>
          <Textarea readOnly rows={6} value={text} aria-label="Текст оголошення" />
          <Button variant="outline" size="sm" className="self-start" disabled={busy || !text} onClick={() => void copyText()}>{copied ? <><Check aria-hidden="true" strokeWidth={1.5} />Скопійовано</> : <><Copy aria-hidden="true" strokeWidth={1.5} />Скопіювати текст</>}</Button>
        </section>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" disabled={busy} onClick={onClose}>Скасувати</Button>
        <Button variant="action" busy={busy} disabled={loading || !rule.allowed || (quickMode && !selected)} onClick={() => void publish()}>
          <Send aria-hidden="true" strokeWidth={1.5} />{busy ? 'Зберігаємо…' : selected ? 'Відмітити публікацію' : quickMode ? 'Обери матеріал' : 'Відмітити без матеріалу'}
        </Button>
      </div>
    </div>
  );
}
