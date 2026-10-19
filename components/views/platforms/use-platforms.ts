'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '@/components/ui/toast';
import { telegramAccountAction, useTelegramAccounts, loadTelegramAccounts, type TelegramAccount } from '@/components/views/platforms/telegram-accounts';
import type { PlatformLinkItem as LinkItem, PublicationPace } from '@/components/views/platforms/overview';
import type { WhatsAppAutopostImage, WhatsAppAutopostProgress } from '@/components/views/platforms/autopost-card';
import type { AutopostAttentionItem, AutopostDecision } from '@/components/views/platforms/autopost-attention';
import type { ViberRunnerStatus } from '@/components/views/platforms/viber-autopost-card';
import { batchSkipText } from '@/components/views/platforms/autopost-reasons';
import type { WaitingCheckAction, WaitingCheckProblemAction } from '@/components/views/platforms/waiting-check-card';
import { announceDataChange } from '@/lib/client-sync';
import { createActionGate } from '@/lib/action-gate';
import { createRefreshGate } from '@/lib/refresh-gate';
import { subscribeLiveMessages, subscribeLiveStatus, type LiveStatus } from '@/lib/live-channel';
import { pairThisBrowserExecutor } from '@/lib/chat-discovery/executor-storage';
import { CHAT_PLATFORM_NAMES, type ChatPlatform } from '@/lib/chats/bulk-input';
import type { BulkResult } from '@/lib/chats/bulk';
import type { ChatProfile } from '@/lib/chats/profile';
import { useSelectedLists } from '@/components/views/platforms/use-selected-lists';
import { EMPTY_WAITING_CHECK, parseWaitingCheckView, waitingCheckArchiveReason, type WaitingCheckView } from '@/lib/chats/whatsapp-waiting-check-copy';
import { humanError } from '@/components/ui/human-error';

export type Platform = 'telegram' | 'whatsapp' | 'viber' | 'facebook';
export type WorkflowQueue = 'to_join' | 'waiting' | 'ready' | 'archived';
export type Queue = WorkflowQueue | 'profile_review' | 'selected';
export type ProfileFilter = 'all' | 'needs_review';
export type Chat = {
  id: string; name: string; link: string; platform: Platform; status: WorkflowQueue; archiveReason: string | null; archivedAt: number | null; profileConfirmed: boolean; profile: ChatProfile;
  publishedToday: boolean; joinedAt: number | null; snoozedUntil: number | null; snoozeCount: number; leftAt: number | null; availableAt: number | null; availableNow: boolean;
  telegramAccountId: string | null; stateToken: string; discoveryDecision: 'review' | 'target' | 'rejected' | 'unavailable' | null; autopostJobId: string | null;
  /** Telegram «Для публікації»: чат стоїть у слоті розкладу. */
  inSchedule?: boolean;
  /** Telegram: час відбору в чергу приєднання; `null` — чат серед «Нових чатів». */
  candidateAt?: number | null;
};
type ProfileCounts = { confirmed: number; draft: number; empty: number; needsReview: number };
type PublicationState = { chatId: string; chatPublishedToday: boolean; publishedToday: LinkItem[]; publicationPace: PublicationPace };
/** Розділи Telegram «Для приєднання»: черга вибраного акаунта (candidates) і «Нові чати» (chats зі сторінкою `limit`). */
export type JoinSections = { queue: number; pool: number };
export type ResponseData = {
  /** Ревізія синхронізації, за якою сервер зібрав відповідь: подію live-каналу з такою чи меншою ревізією перечитувати не треба. */
  revision?: number;
  chats: Chat[]; candidates?: Chat[]; sections?: JoinSections; total: number; offset: number; counts: Record<string, number>; profileCounts: Record<string, ProfileCounts>; accountId: string | null;
  joinedToday: LinkItem[]; publishedToday: LinkItem[]; publicationPace: PublicationPace; requestKey?: string;
};
export type UndoSpec = { action: 'restore' | 'unsnooze' | 'undo_published' | 'return_to_join' | 'shortlist' | 'unshortlist'; label: string; /** Додаткові поля для скасування, наприклад `toPool` для відновлення з «Нових чатів». */ extra?: Record<string, unknown> };
export type ChatActionResult = { ok: true } | { ok: false; error: string; refresh: boolean };
export type PlatformConfirmation = { kind: 'assign'; chat: Chat; nextId: string; currentName: string; nextName: string } | { kind: 'return'; chat: Chat };
type WaitingCheckResponse = Record<string, unknown> & { error?: string };

export const PLATFORMS: Array<{ key: Platform; label: string }> = [
  { key: 'telegram', label: 'Telegram' }, { key: 'whatsapp', label: 'WhatsApp' }, { key: 'viber', label: 'Viber' }, { key: 'facebook', label: 'Facebook' },
];
export const QUEUES: Array<{ key: Queue; label: string }> = [
  { key: 'to_join', label: 'Для приєднання' }, { key: 'waiting', label: 'Очікування' }, { key: 'ready', label: 'Для публікації' }, { key: 'profile_review', label: 'Уточнити профіль' }, { key: 'archived', label: 'Архів' },
];

async function readWaitingCheckResponse(response: Response): Promise<WaitingCheckResponse> {
  const raw = await response.text();
  if (!raw.trim()) throw new Error(`Сервер не повернув відповідь (HTTP ${response.status}).`);
  try { return JSON.parse(raw) as WaitingCheckResponse; } catch { throw new Error(`Сервер повернув некоректну відповідь (HTTP ${response.status}).`); }
}

type SavedPlatformView = { queue: Queue; search: string; offset: number; scrollY: number; lastChatId: string | null };
/**
 * Вигляд платформ відновлюється лише після перезавантаження чи автооновлення (хвилини), а не днями: вкладка Work OS живе
 * довго, і застарілий пошук чи платформа відкривалися щоразу. Так само скидається вигляд, коли від розділу були далеко.
 */
const RESTORE_TTL_MS = 10 * 60 * 1000;
const PLATFORM_VIEW_PREFIX = 'work-os:platform-view:';
const LAST_PLATFORM_KEY = 'work-os:last-platform';
function readPlatformView(platform: Platform): SavedPlatformView | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = JSON.parse(window.sessionStorage.getItem(`${PLATFORM_VIEW_PREFIX}${platform}`) || 'null') as Partial<SavedPlatformView> | null;
    const offset = value?.offset; const scrollY = value?.scrollY;
    const savedAt = (value as { savedAt?: unknown } | null)?.savedAt;
    if (typeof savedAt !== 'number' || Date.now() - savedAt > RESTORE_TTL_MS) return null;
    if (!value || !QUEUES.some((item) => item.key === value.queue) && value.queue !== 'selected' || typeof value.search !== 'string' || typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0 || typeof scrollY !== 'number' || !Number.isFinite(scrollY) || scrollY < 0) return null;
    return { queue: value.queue as Queue, search: value.search.slice(0, 150), offset: Math.min(offset, 1_000_000), scrollY: Math.min(scrollY, 10_000_000), lastChatId: typeof value.lastChatId === 'string' ? value.lastChatId.slice(0, 100) : null };
  } catch { return null; }
}
function writePlatformView(platform: Platform, value: SavedPlatformView) { try { window.sessionStorage.setItem(`${PLATFORM_VIEW_PREFIX}${platform}`, JSON.stringify({ ...value, savedAt: Date.now() })); } catch { /* стан розділу діє до перезавантаження */ } }
function readLastPlatform(): string | null {
  try {
    const [value, stamp] = (window.sessionStorage.getItem(LAST_PLATFORM_KEY) ?? '').split(':');
    if (!Number.isFinite(Number(stamp)) || Date.now() - Number(stamp) > RESTORE_TTL_MS) return null;
    return PLATFORMS.some((item) => item.key === value) ? value : null;
  } catch { return null; }
}
function clearPlatformViews() { try { for (const item of PLATFORMS) window.sessionStorage.removeItem(`${PLATFORM_VIEW_PREFIX}${item.key}`); window.sessionStorage.removeItem(LAST_PLATFORM_KEY); } catch { /* ігноруємо */ } }
function writeLastPlatform(platform: Platform) { try { window.sessionStorage.setItem(LAST_PLATFORM_KEY, `${platform}:${Date.now()}`); } catch { /* ігноруємо */ } }

export function activeBreakExpired(accounts: TelegramAccount[], accountId: string | null, clock: number) {
  const account = accounts.find((item) => item.id === accountId);
  return Boolean(account?.breakUntil && account.breakUntil * 1000 <= clock);
}
export function canPublish(chat: Chat, clock: number) { return chat.status === 'ready' && (!chat.discoveryDecision || chat.discoveryDecision === 'target') && (chat.availableAt === null || chat.availableAt <= clock / 1000); }
export function isSnoozed(chat: Chat, clock: number) { return chat.snoozedUntil !== null && chat.snoozedUntil > clock / 1000; }

const WHATSAPP_AUTOPOST_IMAGE_MAX_BYTES = 640 * 1024;
async function normalizeWhatsAppAutopostImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) throw new Error('Обери зображення.');
  if (['image/jpeg', 'image/png', 'image/webp'].includes(file.type) && file.size <= WHATSAPP_AUTOPOST_IMAGE_MAX_BYTES) return file;
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => { const node = new Image(); node.onload = () => resolve(node); node.onerror = () => reject(new Error('Не вдалося прочитати зображення. Спробуй JPG або PNG.')); node.src = url; });
    for (const maxDimension of [1600, 1400, 1200, 1000, 800]) {
      const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Браузер не може підготувати фото.');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.84, 0.74, 0.64, 0.54]) {
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
        if (blob && blob.size <= WHATSAPP_AUTOPOST_IMAGE_MAX_BYTES) { const base = file.name.replace(/\.[^.]+$/u, '').slice(0, 120) || 'work-os-autopost'; return new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: Date.now() }); }
      }
    }
    throw new Error('Фото завелике навіть після стискання. Обери інше зображення.');
  } finally { URL.revokeObjectURL(url); }
}

function safeDecode(value: string) { try { return decodeURIComponent(value); } catch { return value; } }
function nativeChatLink(platform: Platform, link: string) {
  let url: URL;
  try { url = new URL(link.trim()); } catch { return ''; }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const parts = url.pathname.split('/').filter(Boolean);
  if (platform === 'telegram' && ['t.me', 'telegram.me', 'telegram.dog'].includes(host)) {
    if (parts[0]?.startsWith('+')) return `tg://join?invite=${encodeURIComponent(parts[0].slice(1))}`;
    if (parts[0]?.toLowerCase() === 'joinchat' && parts[1]) return `tg://join?invite=${encodeURIComponent(parts[1])}`;
    return parts[0] ? `tg://resolve?domain=${encodeURIComponent(parts[0])}` : '';
  }
  if (platform === 'whatsapp' && host === 'chat.whatsapp.com') { const code = parts[0]?.toLowerCase() === 'invite' ? parts[1] : parts[0]; return code ? `whatsapp://chat?code=${encodeURIComponent(safeDecode(code))}` : ''; }
  if (platform === 'viber' && ['invite.viber.com', 'chats.viber.com'].includes(host)) { const token = /[?&]g2=([^&#]+)/i.exec(link)?.[1]; return token ? `viber://community_invite?data=${encodeURIComponent(safeDecode(token))}` : ''; }
  if (platform === 'facebook' && ['facebook.com', 'm.facebook.com', 'fb.com'].includes(host)) return `fb://facewebmodal/f?href=${encodeURIComponent(url.toString())}`;
  return '';
}
export function openNativeChat(platform: Platform, link: string) {
  if (platform === 'whatsapp') {
    let url: URL;
    try { url = new URL(link.trim()); } catch { return; }
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (url.protocol === 'https:' && host === 'chat.whatsapp.com') {
      const parts = url.pathname.split('/').filter(Boolean);
      const code = parts[0]?.toLowerCase() === 'invite' ? parts[1] : parts[0];
      if (code) window.open(`https://web.whatsapp.com/accept?code=${encodeURIComponent(safeDecode(code))}`, '_blank', 'noopener,noreferrer');
    }
    return;
  }
  if (platform === 'telegram') { window.open(link, '_blank', 'noopener,noreferrer'); return; }
  const native = nativeChatLink(platform, link);
  if (native) window.location.assign(native); else window.open(link, '_blank', 'noopener,noreferrer');
}
export function compactChatLink(link: string) {
  try {
    const url = new URL(link);
    const token = [...url.pathname.split('/').filter(Boolean), url.searchParams.get('g2') || ''].filter(Boolean).at(-1) || '';
    const tail = token.length > 12 ? `…${token.slice(-12)}` : token;
    return tail ? `${url.hostname} · ${tail}` : url.hostname;
  } catch { return 'Посилання на чат'; }
}

/**
 * Весь стан розділу «Платформи»: черги чатів, дії над чатом з відкатом, Telegram-акаунти й перерва, перевірка
 * заявок WhatsApp, автопост, швидкий режим. Мережа: список чатів за ключем (кеш + abort), live-події каналу,
 * таймер лише як фолбек, поки канал недоступний.
 */
export function usePlatforms({ enabledPlatforms, syncRevision, businessDate, active }: { enabledPlatforms: string[]; syncRevision: number; businessDate: string; active: boolean }) {
  const toast = useToast();
  const availablePlatforms = useMemo(() => PLATFORMS.filter((item) => enabledPlatforms.includes(item.key)), [enabledPlatforms]);
  const [platform, setPlatform] = useState<Platform>('telegram');
  const [queue, setQueue] = useState<Queue>('to_join');
  const [search, setSearch] = useState('');
  const [profileFilter, setProfileFilter] = useState<ProfileFilter>('all');
  const [loadedData, setData] = useState<ResponseData | null>(null);
  const [countsByScope, setCountsByScope] = useState<Record<string, ResponseData['counts']>>({});
  const countsRef = useRef(countsByScope);
  const viewCache = useRef(new Map<string, ResponseData>());
  const [cacheState, setCacheState] = useState<Record<string, ResponseData>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [offset, setOffset] = useState(0);
  // Скільки «Нових чатів» Telegram завантажено (сторінка 50, «Показати ще» додає ще 50).
  const [poolLimit, setPoolLimit] = useState(50);
  const [lastOpenedByPlatform, setLastOpenedByPlatform] = useState<Record<string, string | null>>({});
  const [confirmation, setConfirmation] = useState<PlatformConfirmation | null>(null);
  const [deleteChat, setDeleteChat] = useState<Chat | null>(null);
  const [archiveChat, setArchiveChat] = useState<Chat | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [liveStatus, setLiveStatus] = useState<LiveStatus>({ connected: false, runnerConnected: null });
  const [waitingCheck, setWaitingCheck] = useState<WaitingCheckView>(EMPTY_WAITING_CHECK);
  const [quickPublishMode, setQuickPublishMode] = useState(false);
  const [quickAdvertisementId, setQuickAdvertisementId] = useState<string | null>(null);
  const [whatsappImage, setWhatsappImage] = useState<WhatsAppAutopostImage | null>(null);
  const [whatsappImageLoaded, setWhatsappImageLoaded] = useState(false);
  const [whatsappCaption, setWhatsappCaption] = useState('');
  const [whatsappCaptionLoaded, setWhatsappCaptionLoaded] = useState(false);
  const [whatsappProgress, setWhatsappProgress] = useState<WhatsAppAutopostProgress | null>(null);
  const [autopostAttention, setAutopostAttention] = useState<AutopostAttentionItem[]>([]);
  const [viberProgress, setViberProgress] = useState<WhatsAppAutopostProgress | null>(null);
  const [viberStatus, setViberStatus] = useState<ViberRunnerStatus | null>(null);
  const [viberBatchNote, setViberBatchNote] = useState<string | null>(null);
  const [whatsappBatchNote, setWhatsappBatchNote] = useState<string | null>(null);
  const selected = useSelectedLists({ enabled: active && platform === 'telegram', viewing: queue === 'selected' });

  const { accounts, accountId } = useTelegramAccounts(true);
  const runAction = useRef(createActionGate());
  const refreshExpiredBreak = useRef(createRefreshGate(15_000));
  const activeLoad = useRef<AbortController | null>(null);
  const loadNumber = useRef(0);
  const reloadChats = useRef<(silent?: boolean) => Promise<void>>(async () => {});
  const hasLoadedData = useRef(false);
  const lastSyncKey = useRef(`${syncRevision}:${businessDate}`);
  const loadedRevision = useRef(0);
  const previousFilter = useRef('');
  const restoredView = useRef(false);
  const restoreScroll = useRef<number | null>(null);
  const actRef = useRef<(chat: Chat, action: string, extra?: Record<string, unknown>, undoSpec?: UndoSpec) => Promise<ChatActionResult>>(async () => ({ ok: false, error: '', refresh: false }));

  const requestAccountId = platform === 'telegram' ? accountId : null;
  const requestKey = `${platform}:${queue}:${search}:${profileFilter}:${offset}:${requestAccountId || ''}`;
  // «Доступні для публікації» — окремий запит: у списку чатів їх немає (сотні читань на кожне перечитування). Вантажаться, коли
  // відкрито чергу «Для публікації», і ще раз перед копіюванням; свої дії оновлюють їх локально чи скидають.
  const [availableState, setAvailableState] = useState<{ key: string; items: LinkItem[] } | null>(null);
  const availableKey = `${platform}:${requestAccountId || ''}:${businessDate}`;
  const loadAvailable = useCallback(async (): Promise<LinkItem[]> => {
    const params = new URLSearchParams({ platform, status: 'ready', section: 'available' });
    if (requestAccountId) params.set('account', requestAccountId);
    const response = await fetch(`/api/chats?${params}`, { cache: 'no-store' });
    const body = await response.json() as { availableToday?: LinkItem[]; error?: string };
    if (!response.ok) throw new Error(body.error || 'Не вдалося завантажити доступні чати.');
    const items = body.availableToday || [];
    setAvailableState({ key: availableKey, items });
    return items;
  }, [platform, requestAccountId, availableKey]);
  useEffect(() => {
    if (!active || queue !== 'ready' || availableState?.key === availableKey) return;
    queueMicrotask(() => void loadAvailable().catch(() => { /* картка лишиться без числа; копіювання спробує ще раз */ }));
  }, [active, queue, availableKey, availableState, loadAvailable]);
  const availableToday = availableState?.key === availableKey ? availableState.items : undefined;
  const cachedData = cacheState[requestKey] || null;
  const data = loadedData?.requestKey === requestKey ? loadedData : cachedData;
  const switchingList = data === null && loadedData !== null && loadedData.requestKey !== requestKey;
  const tabCounts = data?.counts ?? countsByScope[`${platform}:${requestAccountId || ''}`];
  useEffect(() => { countsRef.current = countsByScope; });
  const filterKey = `${platform}:${queue}:${search}:${profileFilter}`;
  const selectedPlatform = PLATFORMS.find((item) => item.key === platform) ?? PLATFORMS[0];
  const activeAccount = accounts.find((item) => item.id === accountId);
  const breakSeconds = activeAccount?.breakUntil ? Math.max(0, activeAccount.breakUntil - Math.floor(clock / 1000)) : 0;

  // Серія приєднань дійшла до порогу акаунта (налаштування «Після N чатів») — перерва «На M хв» стартує сама.
  // Лише коли поріг досягнуто в цьому сеансі, щоб старий лічильник не запускав перерву при відкритті сторінки.
  const streakSeen = useRef<{ id: string; value: number } | null>(null);
  useEffect(() => {
    const account = activeAccount;
    if (!account || platform !== 'telegram') { streakSeen.current = null; return; }
    const previous = streakSeen.current;
    streakSeen.current = { id: account.id, value: account.joinStreak };
    if (!previous || previous.id !== account.id || account.breakUntil) return;
    if (previous.value < account.joinBatchSize && account.joinStreak >= account.joinBatchSize) {
      void telegramAccountAction('start_break', account.id, { minutes: account.breakMinutes }).then((ok) => {
        if (ok) toast.push({ message: `Перерва ${account.breakMinutes} хв запущена: приєднано ${account.joinStreak} чатів.`, duration: 8000, action: { label: 'Скасувати', onClick: () => { void telegramAccountAction('cancel_break', account.id).then((done) => { if (done) toast.push({ message: 'Перерву скасовано, серія починається заново.' }); }); } } });
      });
    }
  }, [activeAccount, platform, toast]);

  // Платформа за замовчуванням і перехід, якщо поточну вимкнули в налаштуваннях.
  useEffect(() => {
    if (availablePlatforms.some((item) => item.key === platform) || !availablePlatforms[0]) return;
    const next = availablePlatforms[0].key;
    const timer = setTimeout(() => { setPlatform(next); setQueue('to_join'); setSearch(''); setProfileFilter('all'); setOffset(0); setQuickPublishMode(false); setQuickAdvertisementId(null); previousFilter.current = `${next}:to_join::all`; writeLastPlatform(next); }, 0);
    return () => clearTimeout(timer);
  }, [availablePlatforms, platform]);

  useEffect(() => {
    if (platform === 'viber' && queue === 'profile_review') { queueMicrotask(() => { setQueue('ready'); setProfileFilter('all'); setOffset(0); }); return; }
    if (previousFilter.current === filterKey) return;
    previousFilter.current = filterKey;
    queueMicrotask(() => { setOffset(0); setPoolLimit(50); });
  }, [filterKey, platform, queue]);

  // Відновлення останньої платформи й черги в межах сеансу.
  useEffect(() => {
    if (restoredView.current || !availablePlatforms.length) return;
    restoredView.current = true;
    const savedPlatform = readLastPlatform();
    const target = availablePlatforms.some((item) => item.key === savedPlatform) ? savedPlatform as Platform : platform;
    const saved = readPlatformView(target);
    queueMicrotask(() => {
      if (target !== platform) setPlatform(target);
      if (saved) { setQueue(saved.queue); setSearch(saved.search); setProfileFilter('all'); setOffset(saved.offset); previousFilter.current = `${target}:${saved.queue}:${saved.search}:all`; restoreScroll.current = saved.scrollY; setLastOpenedByPlatform((current) => ({ ...current, [target]: saved.lastChatId })); }
    });
  }, [availablePlatforms, platform]);

  // Повернення до розділу після довгої відсутності починається з чистого вигляду: перша платформа, «Для приєднання», без пошуку.
  const leftAt = useRef<number | null>(null);
  const firstPlatform = availablePlatforms[0]?.key ?? 'telegram';
  useEffect(() => {
    if (!active) { leftAt.current = Date.now(); return; }
    const away = leftAt.current === null ? 0 : Date.now() - leftAt.current;
    leftAt.current = null;
    if (away <= RESTORE_TTL_MS) return;
    clearPlatformViews();
    previousFilter.current = `${firstPlatform}:to_join::all`;
    queueMicrotask(() => {
      setPlatform(firstPlatform); setQueue('to_join'); setSearch(''); setProfileFilter('all'); setOffset(0);
      setQuickPublishMode(false); setQuickAdvertisementId(null); setLastOpenedByPlatform({});
    });
  }, [active, firstPlatform]);

  useEffect(() => {
    if (loading || !data || restoreScroll.current === null) return;
    restoreScroll.current = null;
  }, [loading, data]);

  // Локальний годинник для відкладень, доступності й перерви; не звертається до мережі.
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  useEffect(() => {
    void refreshExpiredBreak.current(clock, document.visibilityState === 'visible' && navigator.onLine && activeBreakExpired(accounts, accountId, clock), () => loadTelegramAccounts(true)).catch(() => {});
  }, [accounts, accountId, clock]);

  // Viber-автопост: лічильники партії й чати, що чекають рішення, читаються при вході на платформу й після подій каналу;
  // стан самого Viber на ПК приходить від runner подіями progress (таймера опитування немає).
  const applyViberAutopost = useCallback((body: { viberAutopostProgress?: WhatsAppAutopostProgress; autopostAttention?: AutopostAttentionItem[] }) => { setViberProgress(body.viberAutopostProgress || null); setAutopostAttention(body.autopostAttention || []); }, []);
  const readViberAutopost = useCallback(async () => {
    const response = await fetch('/api/messenger-automation?viber=1', { cache: 'no-store' });
    const body = await response.json() as { viberAutopostProgress?: WhatsAppAutopostProgress; autopostAttention?: AutopostAttentionItem[] };
    return response.ok ? body : null;
  }, []);
  useEffect(() => {
    if (!active || platform !== 'viber') return;
    let cancelled = false;
    const load = () => { void readViberAutopost().then((body) => { if (body && !cancelled) applyViberAutopost(body); }).catch(() => { /* наступна подія оновить */ }); };
    load();
    const unsubscribe = subscribeLiveMessages((message) => {
      if (message.type === 'process_state' && message.process === 'autopost') load();
      if (message.type === 'progress' && message.process === 'viber_status') {
        const state = message.state === 'ready' ? 'ready' : 'blocked';
        setViberStatus({ state, reason: typeof message.reason === 'string' ? message.reason : null, text: typeof message.text === 'string' ? message.text : '' });
      }
    });
    return () => { cancelled = true; unsubscribe(); };
  }, [active, platform, readViberAutopost, applyViberAutopost]);

  // Налаштування WhatsApp-автопоста завантажуються один раз при вході на платформу.
  useEffect(() => {
    if (!active || (platform !== 'whatsapp' && platform !== 'viber')) return;
    let cancelled = false;
    void fetch('/api/messenger-automation', { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json() as { whatsappAutopostImage?: WhatsAppAutopostImage | null; whatsappAutopostCaption?: string; whatsappAutopostProgress?: WhatsAppAutopostProgress; autopostAttention?: AutopostAttentionItem[] };
        if (!cancelled && response.ok) {
          setWhatsappImage(body.whatsappAutopostImage || null);
          // Фото спільне для обох платформ; решту (підпис, прогрес, чати «Потребують рішення») тут читає лише WhatsApp.
          if (platform === 'whatsapp') { setAutopostAttention(body.autopostAttention || []); setWhatsappCaption(typeof body.whatsappAutopostCaption === 'string' ? body.whatsappAutopostCaption : ''); setWhatsappProgress(body.whatsappAutopostProgress || null); }
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) { setWhatsappImageLoaded(true); setWhatsappCaptionLoaded(true); } });
    return () => { cancelled = true; };
  }, [active, platform]);

  const invalidateQueueCache = useCallback((target?: Platform) => {
    if (!target) { viewCache.current.clear(); setCacheState({}); return; }
    const prefix = `${target}:`;
    for (const key of viewCache.current.keys()) if (key.startsWith(prefix)) viewCache.current.delete(key);
    setCacheState((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(prefix))));
  }, []);

  const cancelLoad = useCallback(() => { activeLoad.current?.abort(); loadNumber.current += 1; }, []);

  const load = useCallback(async (silent = false) => {
    activeLoad.current?.abort();
    const controller = new AbortController(); activeLoad.current = controller;
    if (queue === 'selected') {
      // «Відібрані» — довідковий список без запиту чатів, але лічильники черг мають бути видні завжди. Один разовий запит
      // (сторінка з одного чату + `chat_queue_counts`): лише коли лічильників цього акаунта ще немає або прийшла live-подія.
      setLoading(false);
      const scope = `${platform}:${requestAccountId || ''}`;
      if (!silent && countsRef.current[scope]) return;
      try {
        const params = new URLSearchParams({ platform, status: 'to_join', limit: '1' });
        if (requestAccountId) params.set('account', requestAccountId);
        const response = await fetch(`/api/chats?${params}`, { cache: 'no-store', signal: controller.signal });
        const body = await response.json() as { counts?: ResponseData['counts'] };
        if (response.ok && body.counts && !controller.signal.aborted) setCountsByScope((current) => ({ ...current, [scope]: body.counts as ResponseData['counts'] }));
      } catch { /* лічильники лишаться як були; наступна подія чи перемикання черги оновить */ }
      return;
    }
    const requestNumber = ++loadNumber.current;
    const cached = viewCache.current.get(requestKey) || null;
    if (!silent && !cached) setLoading(true); else if (!silent) setLoading(false);
    setError('');
    try {
      const params = new URLSearchParams({ platform, status: queue, search, offset: String(offset), profile: profileFilter });
      if (requestAccountId) params.set('account', requestAccountId);
      if (platform === 'telegram' && queue === 'to_join') params.set('limit', String(poolLimit));
      const response = await fetch(`/api/chats?${params}`, { cache: 'no-store', signal: controller.signal });
      const body = await response.json() as ResponseData & { error?: string };
      if (controller.signal.aborted || requestNumber !== loadNumber.current) return;
      if (!response.ok) throw new Error(body.error || 'Не вдалося завантажити чати.');
      const next = { ...body, requestKey };
      viewCache.current.set(requestKey, next); setCacheState((current) => ({ ...current, [requestKey]: next })); setData(next); hasLoadedData.current = true;
      if (typeof body.revision === 'number') loadedRevision.current = Math.max(loadedRevision.current, body.revision);
      setCountsByScope((current) => ({ ...current, [`${platform}:${requestAccountId || ''}`]: body.counts }));
    } catch (reason) { if (!controller.signal.aborted && requestNumber === loadNumber.current) setError(humanError(reason, 'Не вдалося завантажити чати.')); }
    finally { if (!silent && !controller.signal.aborted && requestNumber === loadNumber.current) setLoading(false); }
  }, [platform, queue, search, profileFilter, offset, requestAccountId, requestKey, poolLimit]);

  useEffect(() => {
    reloadChats.current = load;
    const timer = setTimeout(() => void load(false), search ? 250 : 0);
    return () => { clearTimeout(timer); cancelLoad(); };
  }, [load, search, cancelLoad]);

  // Нова ревізія / нова ділова дата: кеш черг скидається, список перечитується один раз.
  useEffect(() => {
    const next = `${syncRevision}:${businessDate}`;
    const previous = lastSyncKey.current;
    lastSyncKey.current = next;
    if (previous === next || !hasLoadedData.current || !active) return;
    invalidateQueueCache();
    // Ревізія, яку вже бачить список (наприклад, після власної дії, яка щойно перечитала його), вдруге не перечитується.
    const seenAlready = previous.endsWith(`:${businessDate}`) && syncRevision <= loadedRevision.current;
    if (!seenAlready) queueMicrotask(() => void reloadChats.current(true));
    if (platform === 'telegram') void loadTelegramAccounts(true);
  }, [syncRevision, businessDate, platform, invalidateQueueCache, active]);

  const applyWaitingCheckView = useCallback((next: WaitingCheckView) => {
    setWaitingCheck((current) => {
      const progressed = next.counts.joined + next.counts.pending + next.counts.requested !== current.counts.joined + current.counts.pending + current.counts.requested;
      if ((current.active && !next.active) || (next.active && progressed)) { invalidateQueueCache('whatsapp'); queueMicrotask(() => void reloadChats.current(true)); }
      return next;
    });
  }, [invalidateQueueCache]);

  const refreshWaitingCheck = useCallback(async () => {
    try {
      const response = await fetch('/api/chat-discovery/waiting-check', { cache: 'no-store' });
      const body = await readWaitingCheckResponse(response);
      if (!response.ok) return;
      applyWaitingCheckView(parseWaitingCheckView(body));
    } catch { /* наступна подія або дія оновить стан */ }
  }, [applyWaitingCheckView]);

  useEffect(() => {
    if (!active || platform !== 'whatsapp' || queue !== 'waiting') return;
    void refreshWaitingCheck();
  }, [active, platform, queue, refreshWaitingCheck]);

  // Owner Durable Object штовхає результати перевірки заявок, старт/стоп з будь-якого пристрою й стан runner.
  useEffect(() => {
    if (!active || platform !== 'whatsapp' || queue !== 'waiting') return;
    const offMessages = subscribeLiveMessages((message) => {
      if (message.type === 'process_state' && message.process === 'waiting_check') applyWaitingCheckView(parseWaitingCheckView(message));
      else if (message.type === 'runner_status') void refreshWaitingCheck();
    });
    const offStatus = subscribeLiveStatus(setLiveStatus);
    return () => { offMessages(); offStatus(); };
  }, [active, platform, queue, applyWaitingCheckView, refreshWaitingCheck]);

  // Прогрес автопоста оновлюється подіями каналу, а не таймером.
  useEffect(() => {
    if (!active || platform !== 'whatsapp') return;
    const refresh = async () => {
      try {
        const response = await fetch('/api/messenger-automation?progress=1', { cache: 'no-store' });
        const body = await response.json() as { whatsappAutopostProgress?: WhatsAppAutopostProgress; autopostAttention?: AutopostAttentionItem[] };
        if (response.ok) { setWhatsappProgress(body.whatsappAutopostProgress || null); setAutopostAttention(body.autopostAttention || []); }
      } catch { /* наступна подія оновить */ }
    };
    return subscribeLiveMessages((message) => { if (message.type === 'process_state' && message.process === 'autopost') void refresh(); });
  }, [active, platform]);

  // Фолбек: поки канал недоступний, стан runner оновлюється старим способом.
  useEffect(() => {
    if (!active || platform !== 'whatsapp' || queue !== 'waiting' || liveStatus.connected) return;
    const timer = window.setInterval(() => void refreshWaitingCheck(), waitingCheck.active ? 15_000 : 60_000);
    return () => window.clearInterval(timer);
  }, [active, platform, queue, liveStatus.connected, waitingCheck.active, refreshWaitingCheck]);

  // Автопост-завдання, що завершились, скасувались або створились на іншому пристрої, змінюють бейджі «в черзі».
  useEffect(() => {
    if (!active || platform !== 'whatsapp') return;
    return subscribeLiveMessages((message) => {
      if (message.type !== 'process_state' || message.process !== 'autopost') return;
      if (message.status === 'running' || message.status === 'released') return;
      invalidateQueueCache('whatsapp');
      void reloadChats.current(true);
    });
  }, [active, platform, invalidateQueueCache]);

  const waitingCheckView = liveStatus.connected && liveStatus.runnerConnected === true ? { ...waitingCheck, runnerSeenAt: Math.floor(clock / 1000) } : waitingCheck;

  async function resolveWaitingProblem(problem: WaitingCheckView['problems'][number], action: WaitingCheckProblemAction) {
    if (!problem.chat) return;
    if (action === 'open') { openNativeChat('whatsapp', problem.chat.link); return; }
    if (busy !== null) return;
    setBusy('waiting-check'); setError('');
    try {
      const response = await fetch('/api/chats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: problem.chatId, action, stateToken: problem.chat.stateToken, ...(action === 'archive' ? { reason: waitingCheckArchiveReason(problem.reason) } : {}) }) });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || 'Не вдалося виконати дію.');
      toast.push({ message: action === 'approved' ? `«${problem.name}» перенесено в «Для публікації».` : action === 'snooze' ? `«${problem.name}» відкладено на 3 дні.` : `«${problem.name}» перенесено в архів.` });
      invalidateQueueCache('whatsapp'); announceDataChange('platforms');
      await Promise.all([refreshWaitingCheck(), reloadChats.current(true)]);
    } catch (reason) { setError(humanError(reason, 'Не вдалося виконати дію.')); await refreshWaitingCheck(); }
    finally { setBusy(null); }
  }

  async function connectWaitingCheckRunner() {
    if (busy !== null) return;
    setBusy('waiting-check'); setError('');
    try { await pairThisBrowserExecutor(); toast.push({ message: 'Цей браузер підключено. Runner підхопить його протягом хвилини — статус оновиться сам.' }); }
    catch (reason) { setError(humanError(reason, 'Не вдалося підключити цей браузер.')); }
    finally { setBusy(null); }
  }

  async function changeWaitingCheck(action: WaitingCheckAction) {
    if (busy !== null) return;
    setBusy('waiting-check'); setError('');
    try {
      const response = await fetch('/api/chat-discovery/waiting-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
      const body = await readWaitingCheckResponse(response);
      if (!response.ok) throw new Error(body.error || `Не вдалося змінити перевірку (HTTP ${response.status}).`);
      const next = parseWaitingCheckView(body);
      setWaitingCheck(next);
      if (action === 'start') toast.push({ message: next.active ? `Запущено перевірку ${next.total} WhatsApp-чатів.` : 'Немає заявок, які вже можна перевіряти (відкладені на +3 дні чекають свого часу).' });
      else if (action === 'retry_problems') toast.push({ message: next.active ? `Повторно перевіряємо ${next.total} проблемних чатів.` : 'Проблемних чатів, які ще в «Очікуванні», не лишилося.' });
      else toast.push({ message: 'Перевірку зупинено. Решту чатів не змінено.' });
      invalidateQueueCache('whatsapp');
      await reloadChats.current(true);
    } catch (reason) { setError(humanError(reason, 'Не вдалося змінити перевірку.')); }
    finally { setBusy(null); }
  }

  function addedChats(result: BulkResult) {
    invalidateQueueCache();
    const target = availablePlatforms.find((item) => (result.counts[item.key] || 0) > 0)?.key || platform;
    setQuickPublishMode(false); setQuickAdvertisementId(null);
    toast.push({ message: `Додано ${result.added} чатів: ${Object.entries(result.counts).map(([key, count]) => `${CHAT_PLATFORM_NAMES[key as ChatPlatform]} — ${count}`).join(', ')}.` });
    const changesFilter = target !== platform || queue !== 'to_join' || search !== '' || offset !== 0;
    setPlatform(target); setQueue('to_join'); setSearch(''); setProfileFilter('all'); setOffset(0);
    if (!changesFilter) void reloadChats.current(true);
  }

  function savedProfile() { invalidateQueueCache(platform); announceDataChange('platforms'); void reloadChats.current(true); }

  function importedDiscoveryChat(nextPlatform: 'whatsapp' | 'viber') {
    invalidateQueueCache(nextPlatform);
    const changesFilter = nextPlatform !== platform || queue !== 'to_join' || search !== '' || offset !== 0;
    setQuickPublishMode(false); setQuickAdvertisementId(null);
    toast.push({ message: 'Новий чат із пошуку додано в чергу «Для приєднання».' });
    setPlatform(nextPlatform); setQueue('to_join'); setSearch(''); setProfileFilter('all'); setOffset(0);
    if (!changesFilter) void reloadChats.current(true);
  }

  function selectPlatform(next: Platform) {
    if (next === platform) return;
    writePlatformView(platform, { queue, search, offset, scrollY: 0, lastChatId: lastOpenedByPlatform[platform] || null });
    const saved = readPlatformView(next);
    setQuickPublishMode(false); setQuickAdvertisementId(null);
    setPlatform(next); setQueue(saved?.queue || 'to_join'); setSearch(saved?.search || ''); setProfileFilter('all'); setOffset(saved?.offset || 0);
    previousFilter.current = `${next}:${saved?.queue || 'to_join'}:${saved?.search || ''}:all`;
    setLastOpenedByPlatform((current) => ({ ...current, [next]: saved?.lastChatId || null }));
    writeLastPlatform(next);
  }

  function selectQueue(next: Queue) {
    if (next !== 'ready') { setQuickPublishMode(false); setQuickAdvertisementId(null); }
    setQueue(next); setProfileFilter('all'); setOffset(0);
  }

  function openChat(chat: Chat) {
    setLastOpenedByPlatform((current) => ({ ...current, [chat.platform]: chat.id }));
    writePlatformView(chat.platform, { queue, search, offset, scrollY: 0, lastChatId: chat.id });
    writeLastPlatform(chat.platform);
    openNativeChat(chat.platform, chat.link);
  }

  async function act(chat: Chat, action: string, extra: Record<string, unknown> = {}, undoSpec?: UndoSpec): Promise<ChatActionResult> {
    let result: ChatActionResult = { ok: false, error: 'Інша дія вже виконується. Спробуй ще раз після її завершення.', refresh: false };
    const accepted = await runAction.current(async () => {
      setBusy(chat.id); setError('');
      try {
        const response = await fetch('/api/chats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: chat.id, action, stateToken: chat.stateToken, accountId: chat.platform === 'telegram' ? (chat.telegramAccountId || accountId) : null, ...extra }) });
        const body = await response.json() as { error?: string; refresh?: boolean; availableAt?: number; stateToken?: string; snoozedUntil?: number | null; leftAt?: number | null; undoExpiresAt?: number; publicationState?: PublicationState };
        if (!response.ok) {
          const failure = body.error || 'Не вдалося виконати дію.';
          if (response.status === 409) await reloadChats.current(true);
          result = { ok: false, error: failure, refresh: body.refresh === true };
          if (action !== 'published') setError(failure);
          return;
        }
        const expiresAt = typeof body.undoExpiresAt === 'number' ? body.undoExpiresAt * 1000 : Date.now() + 8000;
        const undoable = Boolean(undoSpec && typeof body.stateToken === 'string' && expiresAt > Date.now());
        if ((action === 'published' || action === 'undo_published') && body.publicationState) {
          const state = body.publicationState;
          setData((current) => {
            if (!current || current.requestKey !== requestKey) return current;
            const chats = current.chats.map((item) => (item.id === state.chatId ? { ...item, publishedToday: state.chatPublishedToday, stateToken: body.stateToken || item.stateToken } : item));
            if (queue === 'ready') chats.sort((left, right) => Number(left.publishedToday) - Number(right.publishedToday));
            return { ...current, chats, publishedToday: state.publishedToday, publicationPace: state.publicationPace };
          });
          if (action === 'published') setAvailableState((current) => (current ? { ...current, items: current.items.filter((item) => item.id !== state.chatId) } : current));
        }
        invalidateQueueCache(chat.platform); announceDataChange('platforms');
        if (action !== 'published') setAvailableState(null);
        if (action === 'published' || action === 'undo_published') void reloadChats.current(true); else await reloadChats.current(true);
        if (undoable && undoSpec) {
          const undoChat = { ...chat, stateToken: body.stateToken as string, snoozedUntil: body.snoozedUntil ?? chat.snoozedUntil };
          toast.push({ message: action === 'published' ? 'Публікацію відмічено. Якщо це помилка, скасуй її зараз.' : undoSpec.label, duration: Math.max(2000, expiresAt - Date.now()), action: { label: 'Скасувати', onClick: () => { void actRef.current(undoChat, undoSpec.action, undoSpec.extra).then((undone) => { if (undone.ok) toast.push({ message: 'Дію скасовано.' }); }); } } });
        } else if (action === 'published') {
          toast.push({ message: 'Публікацію відмічено. Чат переміщено нижче завершених на сьогодні.' });
        } else if (action === 'joined' || action === 'waiting') {
          toast.push({ message: action === 'joined' ? 'Чат приєднано.' : 'Чат перенесено в очікування.' });
        } else if (action === 'return_to_join' && chat.platform === 'telegram') {
          toast.push({ message: 'Чат повернуто в чергу приєднання.' });
        } else if (action === 'restore') {
          toast.push({ message: chat.platform === 'telegram' && !extra.toPool ? 'Чат повернуто в чергу приєднання.' : 'Чат відновлено.' });
        }
        result = { ok: true };
      } catch (reason) {
        const failure = humanError(reason, 'Не вдалося виконати дію.');
        const publicationAction = action === 'published' || action === 'undo_published';
        // Сервер міг зафіксувати дію, навіть якщо відповідь загубилась: перечитуємо стан до повторної спроби.
        if (publicationAction) { await reloadChats.current(true); announceDataChange('platforms'); }
        result = { ok: false, error: failure, refresh: publicationAction };
        if (action !== 'published') setError(failure);
      } finally { setBusy(null); }
    });
    return accepted ? result : { ok: false, error: 'Інша дія вже виконується. Спробуй ще раз після її завершення.', refresh: false };
  }
  useEffect(() => { actRef.current = act; });

  async function toggleWhatsAppAutopost(chat: Chat) {
    if (chat.platform !== 'whatsapp' || busy !== null) return;
    await runAction.current(async () => {
      setBusy(chat.id); setError('');
      try {
        const cancelling = Boolean(chat.autopostJobId);
        const response = await fetch('/api/messenger-automation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cancelling ? { action: 'cancel-whatsapp-autopost', jobId: chat.autopostJobId } : { action: 'whatsapp-autopost', requestKey: crypto.randomUUID(), chatId: chat.id, caption: whatsappCaption }) });
        const body = await response.json() as { error?: string; job?: { id: string } };
        if (!response.ok) throw new Error(body.error || 'Не вдалося оновити WhatsApp автопублікацію.');
        setData((current) => (!current || current.requestKey !== requestKey ? current : { ...current, chats: current.chats.map((item) => (item.id === chat.id ? { ...item, autopostJobId: cancelling ? null : (body.job?.id || item.autopostJobId) } : item)) }));
        invalidateQueueCache('whatsapp'); announceDataChange('platforms');
        toast.push({ message: cancelling ? 'WhatsApp автопублікацію скасовано до підтвердженої відправки.' : 'Чат поставлено в чергу автопублікації. Публікація зафіксується лише після підтвердженої відправки.' });
      } catch (reason) { setError(humanError(reason, 'Не вдалося оновити WhatsApp автопублікацію.')); await reloadChats.current(true); }
      finally { setBusy(null); }
    });
  }

  // Відбір у чергу приєднання вибраного акаунта (кнопка «+» у «Нових чатах») і зворотний крок; обидва скасовуються 8 с.
  const shortlistChat = (chat: Chat) => act(chat, 'shortlist', {}, { action: 'unshortlist', label: 'Додано в чергу. Можна скасувати протягом 8 секунд.' });
  const unshortlistChat = (chat: Chat) => act(chat, 'unshortlist', {}, { action: 'shortlist', label: 'Прибрано з черги. Можна скасувати протягом 8 секунд.' });
  // Повернення чату в чергу приєднання: для Telegram без підтвердження, якщо чат не стоїть у слоті розкладу.
  function returnToQueue(chat: Chat) {
    if (chat.platform === 'telegram' && !chat.inSchedule) { void act(chat, 'return_to_join'); return; }
    setConfirmation({ kind: 'return', chat });
  }
  const showMoreNewChats = () => setPoolLimit((value) => Math.min(500, value + 50));

  function assignAccount(chat: Chat, nextId: string) {
    if (busy !== null || nextId === chat.telegramAccountId) return;
    const currentName = accounts.find((item) => item.id === chat.telegramAccountId)?.name || 'поточного акаунта';
    const nextName = accounts.find((item) => item.id === nextId)?.name || 'іншого акаунта';
    setConfirmation({ kind: 'assign', chat, nextId, currentName, nextName });
  }

  function confirmPlatformAction() {
    const item = confirmation; if (!item) return;
    setConfirmation(null);
    if (item.kind === 'assign') void act(item.chat, 'assign_account', { accountId: item.nextId }); else void act(item.chat, 'return_to_join');
  }

  async function wa<T>(label: string, run: () => Promise<T>) {
    if (busy !== null) return;
    await runAction.current(async () => { setBusy(label); setError(''); try { await run(); } catch (reason) { setError(humanError(reason, 'Не вдалося виконати дію.')); } finally { setBusy(null); } });
  }

  const uploadWhatsAppAutopostImage = (file: File) => wa('whatsapp-autopost-image', async () => {
    const normalized = await normalizeWhatsAppAutopostImage(file);
    const form = new FormData(); form.append('file', normalized, normalized.name);
    const response = await fetch('/api/messenger-automation/media', { method: 'POST', body: form });
    const body = await response.json() as { image?: WhatsAppAutopostImage; error?: string };
    if (!response.ok || !body.image) throw new Error(body.error || 'Не вдалося зберегти фото автопоста.');
    setWhatsappImage(body.image); setWhatsappImageLoaded(true);
    toast.push({ message: 'Фото автопоста збережено. Наступний автопост відправлятиме фото з текстом як підписом.' });
  });
  const removeWhatsAppAutopostImage = () => wa('whatsapp-autopost-image-remove', async () => {
    const response = await fetch('/api/messenger-automation/media', { method: 'DELETE' });
    const body = await response.json() as { error?: string };
    if (!response.ok) throw new Error(body.error || 'Не вдалося видалити фото автопоста.');
    setWhatsappImage(null); setWhatsappImageLoaded(true); toast.push({ message: 'Фото автопоста прибрано.' });
  });
  const saveWhatsAppAutopostCaption = () => { if (!whatsappCaptionLoaded) return Promise.resolve(); return wa('whatsapp-autopost-caption', async () => {
    const response = await fetch('/api/messenger-automation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save-whatsapp-autopost-caption', text: whatsappCaption }) });
    const body = await response.json() as { caption?: string; error?: string };
    if (!response.ok) throw new Error(body.error || 'Не вдалося зберегти текст автопоста.');
    setWhatsappCaption(body.caption || ''); toast.push({ message: body.caption ? 'Текст автопоста збережено.' : 'Власний текст очищено — Work OS братиме текст із Бібліотеки.' });
  }); };
  const clearWhatsAppAutopostCaption = () => wa('whatsapp-autopost-caption-clear', async () => {
    const response = await fetch('/api/messenger-automation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'clear-whatsapp-autopost-caption' }) });
    const body = await response.json() as { error?: string };
    if (!response.ok) throw new Error(body.error || 'Не вдалося очистити текст автопоста.');
    setWhatsappCaption(''); toast.push({ message: 'Власний текст очищено — Work OS братиме текст із Бібліотеки.' });
  });
  const resetWhatsAppAutopostQueue = () => { if (platform !== 'whatsapp') return Promise.resolve(); return wa('whatsapp-autopost-reset', async () => {
    const response = await fetch('/api/messenger-automation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reset-whatsapp-autopost' }) });
    const body = await response.json() as { removed?: number; progress?: WhatsAppAutopostProgress; error?: string };
    if (!response.ok) throw new Error(body.error || 'Не вдалося скинути чергу автопоста.');
    setWhatsappProgress(body.progress || null); invalidateQueueCache('whatsapp'); announceDataChange('platforms'); await reloadChats.current(true);
    toast.push({ message: `Чергу автопоста скинуто (прибрано ${Number(body.removed || 0)}). Наступний запуск почнеться з початку.` });
  }); };
  const stopWhatsAppAutopostBatch = () => { if (platform !== 'whatsapp') return Promise.resolve(); return wa('whatsapp-autopost-stop', async () => {
    const response = await fetch('/api/messenger-automation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel-whatsapp-autopost-batch' }) });
    const body = await response.json() as { cancelled?: number; progress?: WhatsAppAutopostProgress; error?: string };
    if (!response.ok) throw new Error(body.error || 'Не вдалося зупинити автопост.');
    setWhatsappProgress(body.progress || null); invalidateQueueCache('whatsapp'); announceDataChange('platforms'); await reloadChats.current(true);
    const cancelled = Number(body.cancelled || 0);
    toast.push({ message: cancelled ? `Автопост зупинено, скасовано ${cancelled} чатів у черзі.` : 'Активних задач автопоста вже не було.' });
  }); };
  const startWhatsAppAutopostBatch = () => { if (platform !== 'whatsapp' || !whatsappImage || !whatsappCaptionLoaded) return Promise.resolve(); return wa('whatsapp-autopost-batch', async () => {
    setQuickPublishMode(false); setQuickAdvertisementId(null);
    const response = await fetch('/api/messenger-automation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'whatsapp-autopost-batch', caption: whatsappCaption }) });
    const body = await response.json() as { created?: number; skipped?: number; reasons?: Array<{ code: string; count: number }>; more?: boolean; error?: string };
    if (!response.ok) throw new Error(body.error || 'Не вдалося запустити автопост черги.');
    invalidateQueueCache('whatsapp'); announceDataChange('platforms'); await reloadChats.current(true);
    const created = Number(body.created || 0); const skipped = Number(body.skipped || 0);
    try {
      const progressResponse = await fetch('/api/messenger-automation?progress=1', { cache: 'no-store' });
      const progressBody = await progressResponse.json() as { whatsappAutopostProgress?: WhatsAppAutopostProgress; autopostAttention?: AutopostAttentionItem[] };
      if (progressResponse.ok) { setWhatsappProgress(progressBody.whatsappAutopostProgress || null); setAutopostAttention(progressBody.autopostAttention || []); }
    } catch { /* події каналу оновлять прогрес */ }
    const why = (body.reasons || []).map((item) => `${batchSkipText(item.code)}: ${item.count}`).join(', ');
    const note = created
      ? `Остання партія: поставлено ${created} чатів${skipped ? `, пропущено ${skipped} (${why})` : ''}${body.more ? '. Придатних чатів лишилось ще: запусти автопост повторно, коли партія завершиться' : ''}.`
      : `Остання партія: нових чатів для автопосту немає${skipped ? `, пропущено ${skipped} (${why})` : ''}.`;
    setWhatsappBatchNote(note);
    toast.push({ message: created ? `Поставлено в автопост: ${created} чатів. Відправка йде по одному, з підтвердженням.` : 'Нових чатів для автопосту зараз немає.' });
  }); };

  const viberAction = async (action: string, extra: Record<string, unknown> = {}) => {
    const response = await fetch('/api/messenger-automation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...extra }) });
    const body = await response.json() as { created?: number; skipped?: number; reasons?: Array<{ code: string; count: number }>; more?: boolean; cancelled?: number; removed?: number; progress?: WhatsAppAutopostProgress; error?: string };
    if (!response.ok) throw new Error(body.error || 'Не вдалося виконати дію автопосту Viber.');
    return body;
  };
  const startViberAutopostBatch = (limit: number | null) => { if (platform !== 'viber') return Promise.resolve(); return wa('viber-autopost-batch', async () => {
    setQuickPublishMode(false); setQuickAdvertisementId(null);
    const body = await viberAction('viber-autopost-batch', limit ? { limit } : {});
    invalidateQueueCache('viber'); announceDataChange('platforms'); await reloadChats.current(true);
    const fresh = await readViberAutopost(); if (fresh) applyViberAutopost(fresh);
    const created = Number(body.created || 0); const skipped = Number(body.skipped || 0);
    const why = (body.reasons || []).map((item) => `${batchSkipText(item.code)}: ${item.count}`).join(', ');
    setViberBatchNote(created
      ? `Остання партія: поставлено ${created} чатів${skipped ? `, пропущено ${skipped} (${why})` : ''}${body.more ? '. Придатних чатів лишилось ще: запусти автопост повторно, коли партія завершиться' : ''}.`
      : `Остання партія: нових чатів для автопосту немає${skipped ? `, пропущено ${skipped} (${why})` : ''}.`);
    toast.push({ message: created ? `Поставлено в автопост Viber: ${created} чатів. Відправка йде по одному, з підтвердженням.` : 'Нових чатів для автопосту Viber зараз немає.' });
  }); };
  const stopViberAutopostBatch = () => { if (platform !== 'viber') return Promise.resolve(); return wa('viber-autopost-stop', async () => {
    const body = await viberAction('cancel-viber-autopost-batch');
    setViberProgress(body.progress || null); invalidateQueueCache('viber'); announceDataChange('platforms'); await reloadChats.current(true);
    const cancelled = Number(body.cancelled || 0);
    toast.push({ message: cancelled ? `Автопост Viber зупинено, скасовано ${cancelled} чатів у черзі.` : 'Активних задач автопосту Viber вже не було.' });
  }); };
  const resetViberAutopostQueue = () => { if (platform !== 'viber') return Promise.resolve(); return wa('viber-autopost-reset', async () => {
    const body = await viberAction('reset-viber-autopost');
    setViberProgress(body.progress || null); setViberBatchNote(null); invalidateQueueCache('viber'); announceDataChange('platforms'); await reloadChats.current(true);
    toast.push({ message: `Чергу автопосту Viber скинуто (прибрано ${Number(body.removed || 0)}). Наступний запуск почнеться з початку.` });
  }); };

  const applyDecisionResult = (body: { progress?: WhatsAppAutopostProgress; autopostAttention?: AutopostAttentionItem[] }) => {
    if (platform === 'viber') setViberProgress(body.progress || null); else setWhatsappProgress(body.progress || null);
    setAutopostAttention(body.autopostAttention || []);
    invalidateQueueCache(platform); announceDataChange('platforms');
  };
  const decideAutopost = (item: AutopostAttentionItem, decision: AutopostDecision) => wa('autopost-decision', async () => {
    const response = await fetch('/api/messenger-automation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'resolve-autopost-decision', jobId: item.jobId, decision, platform }) });
    const body = await response.json() as { progress?: WhatsAppAutopostProgress; autopostAttention?: AutopostAttentionItem[]; error?: string };
    if (!response.ok) throw new Error(body.error || 'Не вдалося застосувати рішення.');
    applyDecisionResult(body);
    await reloadChats.current(true);
    toast.push({ message: decision === 'archive' ? 'Чат переміщено в архів.' : decision === 'snooze' ? 'Чат відкладено до завтра.' : decision === 'check' ? 'Перевіряю чат: runner відкриє його й подивиться, чи є повідомлення.' : 'Чат знову поставлено в чергу автопосту.' });
  });
  const decideAutopostMany = (items: AutopostAttentionItem[], decision: Exclude<AutopostDecision, 'retry'>) => wa('autopost-decision', async () => {
    const response = await fetch('/api/messenger-automation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'resolve-autopost-decisions', jobIds: items.map((item) => item.jobId), decision, platform }) });
    const body = await response.json() as { resolved?: number; progress?: WhatsAppAutopostProgress; autopostAttention?: AutopostAttentionItem[]; error?: string };
    if (!response.ok) throw new Error(body.error || 'Не вдалося застосувати рішення.');
    applyDecisionResult(body);
    await reloadChats.current(true);
    const count = body.resolved ?? items.length;
    toast.push({ message: decision === 'archive' ? `В архів переміщено чатів: ${count}.` : decision === 'snooze' ? `Відкладено до завтра чатів: ${count}.` : `Перевіряю чати: ${count}.` });
  });

  async function accountAction(action: string, id?: string, extra: Record<string, unknown> = {}) {
    await runAction.current(async () => {
      setBusy(id || 'accounts'); setError('');
      try {
        const ok = await telegramAccountAction(action, id, extra);
        if (ok && action !== 'select') await reloadChats.current(true);
      } finally { setBusy(null); }
    });
  }

  return {
    // навігація й дані
    platform, queue, search, setSearch, profileFilter, setProfileFilter, offset, setOffset, availablePlatforms, selectedPlatform,
    data, availableToday, loadAvailable, loading, switchingList, error, setError, busy, tabCounts, selectPlatform, selectQueue, reload: () => reloadChats.current(),
    // чат
    openChat, act, shortlistChat, unshortlistChat, returnToQueue, showMoreNewChats, poolLimit, clock, lastOpenedByPlatform, toggleWhatsAppAutopost, assignAccount, confirmation, setConfirmation, confirmPlatformAction, deleteChat, setDeleteChat, archiveChat, setArchiveChat,
    // callbacks панелей
    addedChats, savedProfile, importedDiscoveryChat, invalidateQueueCache,
    // Telegram
    accounts, accountId, activeAccount, breakSeconds, accountAction,
    selected, setCountsByScope, requestAccountId,
    // WhatsApp / Viber
    waitingCheckView, changeWaitingCheck, connectWaitingCheckRunner, resolveWaitingProblem, liveStatus,
    quickPublishMode, setQuickPublishMode, quickAdvertisementId, setQuickAdvertisementId,
    whatsappImage, whatsappImageLoaded, whatsappCaption, setWhatsappCaption, whatsappCaptionLoaded, whatsappProgress, autopostAttention, whatsappBatchNote, decideAutopost, decideAutopostMany,
    viberProgress, viberStatus, viberBatchNote, startViberAutopostBatch, stopViberAutopostBatch, resetViberAutopostQueue,
    uploadWhatsAppAutopostImage, removeWhatsAppAutopostImage, saveWhatsAppAutopostCaption, clearWhatsAppAutopostCaption, resetWhatsAppAutopostQueue, stopWhatsAppAutopostBatch, startWhatsAppAutopostBatch,
  };
}
