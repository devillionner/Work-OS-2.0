'use client';

import { RunnerLaunchLink, WaydroidWindowLink, useRunnerNotice } from '@/components/shell/runner-offline';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ImagePlus, MoreHorizontal, Send, Square, Trash2, UploadCloud, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { Segmented } from '@/components/ui/segmented';
import { Surface } from '@/components/ui/surface';
import { AutopostAttentionList, type AutopostAttentionItem, type AutopostDecision, type DecideOptions } from '@/components/views/platforms/autopost-attention';
import { AutopostBatchPanel } from '@/components/views/platforms/autopost-batch';
import type { WhatsAppAutopostImage, WhatsAppAutopostProgress } from '@/components/views/platforms/autopost-card';
import { dayLabel, snoozeSummary } from '@/components/views/platforms/autopost-reasons';
import type { ChatDupInfo } from '@/lib/chats/duplicates';
import type { PoolPreview, PoolSummary } from '@/components/views/platforms/pool-types';
import { PoolTextLine } from '@/components/views/platforms/pool-text-line';

/** План запуску з сервера: скільки чатів справді піде в партію й чому решта черги «Для публікації» не йде. */
export type AutopostPlan = {
  total: number; ready: number; publishedToday: number; queued: number; decision: number; tried: number; snoozed: number;
  rules: number; rulesNextDate: string | null; other: number;
  /** Лише Telegram: чати, що чекають вибору гілки, і чати в розкладі на сьогодні. */
  thread?: number; schedule?: number; threadChoices?: TelegramThreadChoice[];
  /** Telegram з фото: чати, чий текст із Бібліотеки довший за 1024 символи; у партію не входять. */
  tooLong?: number; tooLongChats?: Array<{ id: string; name: string; length: number }>;
  /** Telegram: готові чати, про які ще невідомо, чи є в них гілки. */
  unscanned?: number;
  /** Telegram: пул текстових оголошень і скільки готових чатів чекають на завтра, бо вільних текстів на сьогодні не лишилось. */
  pool?: PoolSummary; textWaiting?: number;
  /** Telegram: що публікується (пул чи власний матеріал) і чи є матеріал для кожного режиму. */
  source?: { mode: 'pool' | 'own'; saved: 'pool' | 'own' | null; poolAvailable: boolean; poolTotal: number; ownAvailable: boolean };
  chats: Array<{ id: string; name: string }>;
  /** Кожен чат черги «Для публікації» рівно в одній групі (за цим розкладом лічаться чіпи, список зліва, «Огляд» і картка). */
  buckets: Record<string, AutopostBucket>;
  reasons: Record<string, { code: string | null; observed: string | null; next: string | null; /** Для відкладених: чому й до коли. */ snooze?: SnoozeReason }>;
};
/** Чому чат відкладено (бере сервер за останньою відкладеною задачею чату). */
export type SnoozeReason = { kind: 'restricted_until' | 'restricted' | 'quiet' | 'slow' | 'rate' | 'fresh' | 'manual'; until: number | null };
export type AutopostBucket = 'ready' | 'decision' | 'tried' | 'published' | 'rules' | 'snoozed' | 'queued' | 'other' | 'thread' | 'schedule' | 'toolong' | 'text';
export type TelegramThreadChoice = { chatId: string; name: string; /** Посилання на чат для «Відкрити». */ link?: string; /** Прохід гілок цього чату вже йде: рядок показує «Збираю гілки…». */ collecting?: boolean; /** Чат зі збоєм гілки: прохід ще не поставлено, сторінка ставить його сама. */ needsScan?: boolean; /** Пара дублікатів, якщо цей чат має копію. */ dup?: ChatDupInfo | null; topics: Array<{ id: string; title: string; closed: boolean }>; /** Коли runner востаннє бачив, що в чаті зараз не можна писати (нічний режим, права чату); null — можна. */ restrictedAt?: number | null };
/** Підбір текстів пулу для «Переглянути чати партії» (Telegram): дані, завантаження й ручна заміна тексту лише для цього запуску. */
export type PoolPreviewControls = { data: PoolPreview | null; loading: boolean; overrides: Record<string, string>; manual: Record<string, string>; load: (args: { limit: number; exclude: string[] }) => void; choose: (chatId: string, adId: string | null) => void };
export type AutopostReadiness = { tone: 'ok' | 'warn' | 'hot' | 'idle'; text: string };
export type AutopostMaterialProps = {
  image: WhatsAppAutopostImage | null; imageLoaded: boolean; caption: string; captionLoaded: boolean;
  onCaptionChange: (value: string) => void; onUploadImage: (file: File) => void; onRemoveImage: () => void; onSaveCaption: () => void; onClearCaption: () => void;
  /** `telegram` — власні фото й текст Telegram: фото необов'язкове, ліміти підпису, «Взяти з WhatsApp/Viber». */
  scope?: 'shared' | 'telegram';
  onCopyFromShared?: () => void;
  /** Telegram: у пулі оголошень є тексти, тож власний текст — лише запасний, а чати отримують текст із пулу. */
  poolActive?: boolean;
  /** Telegram: вибір «Пул оголошень · Власне фото й текст» у блоці «Що піде в чати». */
  source?: { mode: 'pool' | 'own'; poolAvailable: boolean; ownAvailable: boolean; busy: boolean; onChange: (mode: 'pool' | 'own') => void; onOpenPool: () => void };
};

/** Ліміти Telegram: підпис до фото 1024 символи, текст без фото 4096. */
const TELEGRAM_PHOTO_CAPTION_LIMIT = 1024;
const TELEGRAM_TEXT_LIMIT = 4096;

/** Стеля партії на сервері (`AUTOPOST_BATCH_MAX`): «Усі» ставить рівно стільки чатів, скільки готових, але не більше цього. */
const BATCH_CAP = 200;

/** «чат», «чати», «чатів» за числом: «в 21 чат», «в 2 чати», «в 5 чатів». */
export function chatWord(count: number): string {
  const tail = count % 100;
  if (tail >= 11 && tail <= 14) return 'чатів';
  const last = count % 10;
  return last === 1 ? 'чат' : last >= 2 && last <= 4 ? 'чати' : 'чатів';
}

function etaText(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return 'менше хвилини';
  if (minutes < 60) return `≈ ${minutes} хв`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `≈ ${hours} год${rest ? ` ${rest} хв` : ''}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

/** Чому немає що публікувати: правдиве пояснення за станом черги, а не завжди «все опубліковано». Той самий текст у картці автопосту й у списку чатів. */
export function noReadyText(plan: AutopostPlan): string {
  if (plan.total === 0) return 'У черзі немає чатів цієї платформи.';
  if ((plan.textWaiting ?? 0) > 0) return `Готових немає: тексти на сьогодні закінчились, ${plan.textWaiting} ${chatWord(plan.textWaiting ?? 0)} ${(plan.textWaiting ?? 0) % 10 === 1 && (plan.textWaiting ?? 0) % 100 !== 11 ? 'чекає' : 'чекають'} на завтра. Додай нові оголошення в пул, щоб вони пішли сьогодні.`;
  if (plan.decision > 0) return `Готових немає. ${plan.decision} ${chatWord(plan.decision)} ${plan.decision % 10 === 1 && plan.decision % 100 !== 11 ? 'чекає' : 'чекають'} твого рішення нижче.`;
  if ((plan.tooLong ?? 0) > 0) return `Готових немає: ${plan.tooLong} ${chatWord(plan.tooLong ?? 0)} — текст із Бібліотеки задовгий для підпису до фото (понад 1024 символи). Скороти оголошення або прибери фото.`;
  if (plan.queued > 0) return `Готових немає: ${plan.queued} ${chatWord(plan.queued)} уже в черзі автопосту.`;
  if (plan.tried > 0) return `Готових немає. ${plan.tried} ${chatWord(plan.tried)} автопост сьогодні вже пробував без відправки, повтор завтра.`;
  if (plan.rules > 0 && plan.publishedToday + plan.snoozed === 0) return plan.rulesNextDate ? `Готових немає: чати чекають за правилами частоти. Найближчий стане доступним ${dayLabel(plan.rulesNextDate)}.` : 'Готових немає: чати чекають за правилами частоти.';
  if (plan.snoozed > 0 && plan.publishedToday === 0 && plan.rules === 0) return 'Готових немає: решта чатів відкладена.';
  return plan.rules > 0 || plan.snoozed > 0
    ? `Сьогодні все, що можна, опубліковано. Решта чекає${plan.rules > 0 ? ' за правилами частоти' : ' (відкладено)'}${plan.rulesNextDate ? `, найближчий чат стане доступним ${dayLabel(plan.rulesNextDate)}` : ''}.`
    : 'Сьогодні все опубліковано. Наступні чати стануть доступні завтра.';
}

/** Що саме піде: мініатюра фото, перші рядки підпису й редактор (той самий для Viber і WhatsApp: фото й текст спільні). */
function MaterialRow({ material, editing, onToggle, busy }: { material: AutopostMaterialProps; editing: boolean; onToggle: () => void; busy: boolean }) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  // Редактор відкрито з пояснення «немає власного тексту»: у режимі пулу текст зазвичай прихований (там «Змінити» керує лише фото).
  const [withText, setWithText] = useState(false);
  const { image, caption, source } = material;
  const telegram = material.scope === 'telegram';
  const lines = caption.trim().split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 2);
  const length = Array.from(caption).length;
  const limit = telegram ? (image ? TELEGRAM_PHOTO_CAPTION_LIMIT : TELEGRAM_TEXT_LIMIT) : 4000;
  const over = telegram && length > limit;
  const thumb = `/api/messenger-automation/media?${telegram ? 'scope=telegram&' : ''}v=${image?.sha256.slice(0, 16) ?? ''}`;
  const summary = telegram && material.poolActive
    ? (image ? 'Фото + окремий текст із пулу оголошень для кожного чату' : 'Без фото · окремий текст із пулу оголошень для кожного чату')
    : telegram
    ? (image ? (lines.length ? `Фото + власний текст: ${lines.join(' · ')}` : 'Фото + текст із Бібліотеки для кожного чату') : (lines.length ? `Без фото · власний текст: ${lines.join(' · ')}` : 'Без фото · текст із Бібліотеки для кожного чату'))
    : (lines.length ? lines.join(' · ') : 'Підпис із Бібліотеки для кожного чату');
  const showText = !(telegram && material.poolActive) || withText;
  return (
    <div className="flex flex-col gap-3">
      {source ? (
        <div className="flex flex-col gap-2">
          <Segmented<'pool' | 'own'> label="Що публікувати в чати" size="sm" value={source.mode} onValueChange={(next) => { if (!source.busy && next !== source.mode) source.onChange(next); }}
            items={[{ value: 'pool', label: 'Пул оголошень', disabled: !source.poolAvailable }, { value: 'own', label: 'Власне фото й текст', disabled: !source.ownAvailable }]} />
          {!source.poolAvailable ? <p className="m-0 flex flex-wrap items-center gap-x-2 text-xs text-ink-2">Пул оголошень порожній, тож цей режим недоступний. <Button variant="ghost" size="sm" onClick={source.onOpenPool}>Вставити список</Button></p> : null}
          {!source.ownAvailable ? <p className="m-0 flex flex-wrap items-center gap-x-2 text-xs text-ink-2">Власного тексту немає, а в Бібліотеці немає оголошень для Telegram, тож цей режим недоступний. <Button variant="ghost" size="sm" onClick={() => { setWithText(true); if (!editing) onToggle(); }}>Змінити</Button></p> : null}
        </div>
      ) : null}
      <div className="flex items-center gap-3 rounded-inner border border-line p-3">
        {image ? (
          <span aria-hidden="true" style={{ backgroundImage: `url(${thumb})` }} className="size-14 shrink-0 rounded-field border border-line bg-cover bg-center" />
        ) : (
          <span aria-hidden="true" className="flex size-14 shrink-0 items-center justify-center rounded-field border border-dashed border-line-strong text-ink-3"><ImagePlus strokeWidth={1.5} className="size-5" /></span>
        )}
        <div className="min-w-0 flex-1">
          <p className="m-0 text-xs text-ink-2">Що піде в чати</p>
          {image || telegram ? (
            <p className="m-0 mt-0.5 line-clamp-2 text-sm">{summary}</p>
          ) : (
            <p className="m-0 mt-0.5 text-sm text-hot">Немає фото: додай його, щоб запустити партію</p>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={() => { if (editing) setWithText(false); onToggle(); }}>{editing ? 'Сховати' : 'Змінити'}</Button>
      </div>
      {editing ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <section className="flex flex-col gap-3" aria-label="Зображення для публікації">
            <h3 className="m-0 text-sm font-medium">Зображення{telegram ? ' (необов’язково)' : ''}</h3>
            <input ref={fileInput} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) material.onUploadImage(file); }} />
            {image ? (
              <div className="flex flex-col gap-3 rounded-inner border border-line bg-sunken p-4">
                <div className="min-w-0"><p className="m-0 truncate text-sm font-medium" title={image.fileName}>{image.fileName}</p><p className="m-0 text-xs text-ink-2">{formatBytes(image.sizeBytes)}</p></div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => fileInput.current?.click()}><ImagePlus aria-hidden="true" strokeWidth={1.5} />Замінити фото</Button>
                  <Button variant="ghost" size="sm" tone="danger" disabled={busy} onClick={material.onRemoveImage}><Trash2 aria-hidden="true" strokeWidth={1.5} />Прибрати</Button>
                </div>
              </div>
            ) : (
              <button type="button" disabled={busy} onClick={() => fileInput.current?.click()} className="flex flex-col items-center gap-2 rounded-inner border border-dashed border-line-strong px-4 py-8 text-center transition-colors hover:bg-raised disabled:opacity-45">
                <UploadCloud aria-hidden="true" strokeWidth={1.5} className="size-6 text-ink-2" />
                <span className="text-sm font-medium">Додати фото</span>
                <span className="text-xs text-ink-2">JPG, PNG або WebP</span>
              </button>
            )}
            {telegram && material.onCopyFromShared ? <Button variant="outline" size="sm" className="self-start" disabled={busy} onClick={material.onCopyFromShared}>Взяти з WhatsApp/Viber</Button> : null}
          </section>
          {showText ? (
          <section className="flex flex-col gap-3" aria-label="Текст автопоста">
            <div className="flex items-center justify-between"><label htmlFor="autopost-caption" className="text-sm font-medium">Текст автопоста</label><span className={`font-mono text-[11px] tabular-nums ${over ? 'text-hot' : 'text-ink-2'}`}>{telegram ? `${length} / ${limit}${image ? ' з фото' : ''}` : `${length} / 4000`}</span></div>
            <Textarea id="autopost-caption" rows={6} maxLength={telegram ? TELEGRAM_TEXT_LIMIT : 4000} disabled={busy || !material.captionLoaded} value={caption} onChange={(event) => material.onCaptionChange(event.target.value)} placeholder={telegram ? 'Свій текст для Telegram. Залиш порожнім, щоб Work OS підставила текст із Бібліотеки для кожного чату (за мовою й напрямками профілю).' : 'Встав текст, який піде під фото. Залиш порожнім, щоб Work OS підставила текст із Бібліотеки для кожного чату.'} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <small className={`text-xs ${over ? 'text-hot' : 'text-ink-2'}`}>{over
                ? (image ? `Підпис до фото в Telegram — до ${limit} символів, тут ${length}. Такий текст не збережеться: скороти його або прибери фото.` : `Текст у Telegram — до ${limit} символів, тут ${length}. Такий текст не збережеться.`)
                : caption.trim() ? (telegram && image ? 'Власний текст піде підписом до фото' : telegram ? 'Власний текст піде повідомленням' : 'Власний текст іде як підпис до фото') : (telegram && image ? 'Підпис до фото візьму з Бібліотеки для кожного чату; задовгий (понад 1024) чат до партії не потрапить' : 'Текст із Бібліотеки підставляється окремо для кожного напрямку чату')}</small>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={busy || !material.captionLoaded || over} onClick={material.onSaveCaption}>Зберегти текст</Button>
                {caption ? <Button variant="ghost" size="sm" disabled={busy} onClick={material.onClearCaption}>Очистити</Button> : null}
              </div>
            </div>
          </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Спільна картка автопосту для Viber і WhatsApp. Угорі головне число («Готово до публікації: 21 чат») і з чого складається черга,
 * далі розмір партії й кнопка, що говорять числами, оцінка часу, список чатів партії (кожен можна прибрати лише на цей запуск),
 * що саме піде (фото й підпис), стан готовності одним рядком і хід партії. Рідкісне («Скинути чергу») сховане в меню «⋯».
 */
export function AutopostPanel({ platform, title, description, plan, onLoadPlan, secondsPerChat, readiness, settingsHelp, settingsTitle, material, progress, attention, batchNote, busy, runnerBlocked, topSlot, startSlot, midSlot, startNote, poolPreview, onDecide, onDecideMany, onStart, onStop, onReset }: {
  platform: 'whatsapp' | 'viber' | 'telegram';
  title: string;
  description: string;
  plan: AutopostPlan | null;
  onLoadPlan: () => void;
  /** Орієнтовний час одного чату, для оцінки «≈ 7 хв». */
  secondsPerChat: number;
  readiness: AutopostReadiness;
  settingsHelp: ReactNode;
  settingsTitle: string;
  /** Фото й текст, що йдуть у чати (WhatsApp, Viber); null — матеріал береться з Бібліотеки для кожного чату (Telegram). */
  material: AutopostMaterialProps | null;
  progress: WhatsAppAutopostProgress | null;
  attention: AutopostAttentionItem[];
  batchNote: string | null;
  busy: boolean;
  /** Runner недоступний: запуск неможливий. */
  runnerBlocked: boolean;
  /** Над ходом партії (темп і час наступної публікації Telegram). */
  topSlot?: ReactNode;
  /** У блоці запуску перед кнопкою (вибір «на годину»). */
  startSlot?: ReactNode;
  /** Між запуском і «Потребують рішення» (група «Вибрати гілку»). */
  midSlot?: ReactNode;
  /** Підпис під кнопкою замість оцінки часу. */
  startNote?: string;
  /** Telegram з пулом: який текст піде в кожен чат партії. */
  poolPreview?: PoolPreviewControls;
  onDecide: (item: AutopostAttentionItem, decision: AutopostDecision, options?: DecideOptions) => void;
  onDecideMany: (items: AutopostAttentionItem[], decision: AutopostDecision, options?: DecideOptions) => void;
  /** Скільки чатів поставити в партію (null — усі) і які чати прибрано з цього запуску. */
  onStart: (limit: number | null, exclude: string[]) => void;
  onStop: () => void;
  onReset: () => void;
}) {
  const browserNotice = useRunnerNotice('browser_throttling');
  const [size, setSize] = useState<'1' | '5' | '20' | 'all'>('all');
  const [removed, setRemoved] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const running = progress?.running === true;
  const wasRunning = useRef(running);

  // План читається при відкритті вкладки й коли партія завершилась; між цим сервер не опитується.
  useEffect(() => { onLoadPlan(); }, [onLoadPlan]);
  useEffect(() => {
    if (wasRunning.current && !running) onLoadPlan();
    wasRunning.current = running;
  }, [running, onLoadPlan]);

  const planIds = new Set((plan?.chats ?? []).map((chat) => chat.id));
  const removedNow = removed.filter((id) => planIds.has(id));
  const readyCount = Math.max(0, (plan?.ready ?? 0) - removedNow.length);
  const cap = Math.min(readyCount, BATCH_CAP);
  const chosen = size === 'all' ? cap : Math.min(Number(size), readyCount);
  const going = (plan?.chats ?? []).filter((chat) => !removedNow.includes(chat.id)).slice(0, chosen);
  const poolActive = Boolean(plan?.pool);
  const previewLoad = poolPreview?.load;
  const removedKey = removedNow.join(',');
  // Підбір текстів рахується, лише поки список партії відкрито, і заново, коли змінилась партія.
  useEffect(() => {
    if (poolActive && listOpen && previewLoad && chosen > 0) previewLoad({ limit: chosen, exclude: removedKey ? removedKey.split(',') : [] });
  }, [poolActive, listOpen, previewLoad, chosen, removedKey, plan?.ready]);
  const hasQueue = Boolean(progress && progress.total + progress.cancelled > 0);
  const ready = material === null || (material.scope === 'telegram' ? material.captionLoaded : material.imageLoaded && Boolean(material.image) && material.captionLoaded);

  const breakdown: Array<[string, number, string?]> = plan ? [
    ['тексти на сьогодні закінчились, чекають на завтра', plan.textWaiting ?? 0],
    ['текст задовгий для підпису до фото', plan.tooLong ?? 0],
    ['потребують вибору гілки', plan.thread ?? 0],
    ['у розкладі Telegram', plan.schedule ?? 0],
    ['потребують рішення', plan.decision],
    ['уже пробували сьогодні без відправки', plan.tried],
    ['опубліковано сьогодні', plan.publishedToday],
    ['чекають за правилами частоти', plan.rules, plan.rulesNextDate ? `найближча — ${dayLabel(plan.rulesNextDate)}` : undefined],
    ['відкладено', plan.snoozed, snoozeSummary(plan)],
    ['уже в черзі автопосту', plan.queued],
    ['інше', plan.other],
  ] : [];
  const reasons = breakdown.filter(([, count]) => count > 0);

  return (
    <Surface variant="glass" radius="card" className="flex flex-col gap-6 p-5 sm:p-6" aria-labelledby={`autopost-${platform}-title`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`autopost-${platform}-title`} className="m-0 text-[17px] font-medium">{title}</h2>
          <p className="m-0 mt-1 max-w-[62ch] text-sm text-ink-2">{description}</p>
        </div>
        <Menu>
          <MenuTrigger render={<button type="button" aria-label="Дії черги автопосту" className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-line text-ink-2 hover:bg-raised" />}>
            <MoreHorizontal aria-hidden="true" strokeWidth={1.5} className="size-4" />
          </MenuTrigger>
          <MenuContent align="end">
            <MenuItem disabled={busy || running || !hasQueue} onClick={() => setConfirmReset(true)}>Почати сьогоднішню чергу заново</MenuItem>
          </MenuContent>
        </Menu>
      </div>

      <div className="flex flex-col gap-2">
        <output className="m-0 flex items-start gap-2 text-sm">
          <i aria-hidden="true" className={`mt-1.5 size-2 shrink-0 rounded-full ${readiness.tone === 'ok' ? 'bg-ok' : readiness.tone === 'hot' ? 'bg-hot' : readiness.tone === 'warn' ? 'bg-warn' : 'bg-ink-3'}`} />
          <span className={readiness.tone === 'hot' ? 'text-hot' : 'text-ink-2'}>{readiness.text}</span>
        </output>
        {runnerBlocked && readiness.tone === 'hot' && readiness.text.startsWith('Runner вимкнений') ? <RunnerLaunchLink className="self-start" /> : null}
        {platform === 'viber' && /Allow/.test(readiness.text) ? <div className="flex flex-col items-start gap-1.5"><span className="text-[13px] text-ink-2">Потрібно натиснути Allow в Android.</span><WaydroidWindowLink /></div> : null}
        {browserNotice && platform !== 'viber' ? <p className="m-0 flex items-start gap-2 text-[13px] text-warn" role="note"><i aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full bg-warn" />{browserNotice}</p> : null}
        <details className="group" open={readiness.tone === 'warn'}>
          <summary className="cursor-pointer list-none text-xs text-ink-2 [&::-webkit-details-marker]:hidden"><span className="underline decoration-line-strong underline-offset-4">{settingsTitle}</span></summary>
          <div className="mt-2 text-sm text-ink-2">{settingsHelp}</div>
        </details>
      </div>

      <section className="flex flex-col gap-1" aria-label="Скільки чатів готові до публікації">
        {plan ? (
          <>
            <p className="m-0 text-[28px] font-medium leading-tight tracking-[-0.02em]">Готово до публікації: <span className="tabular-nums">{plan.ready}</span> {chatWord(plan.ready)}</p>
            {plan.total > 0 ? (
              <p className="m-0 text-sm text-ink-2">
                З {plan.total} у черзі «Для публікації»{reasons.length ? ': ' : '.'}
                {reasons.map(([label, count, note], index) => <span key={label}>{index ? ' · ' : ''}{label} <b className="font-mono font-normal tabular-nums text-ink">{count}</b>{note ? ` (${note})` : ''}</span>)}
              </p>
            ) : <p className="m-0 text-sm text-ink-2">У черзі «Для публікації» немає чатів цієї платформи.</p>}
          </>
        ) : <p className="m-0 text-sm text-ink-2">Рахую, скільки чатів готові до публікації…</p>}
      </section>

      {topSlot}
      <AutopostBatchPanel batch={progress?.batch} running={running} platform={platform} />
      {batchNote ? <p className="m-0 text-xs text-ink-2">{batchNote}</p> : null}

      {!running && plan ? (
        <section className="flex flex-col gap-4" aria-label="Запуск партії">
          {material ? <MaterialRow material={material} editing={editing} onToggle={() => setEditing((value) => !value)} busy={busy} /> : null}
          {plan.ready === 0 ? (
            <p className="m-0 rounded-inner border border-line px-4 py-3 text-sm text-ink-2">{noReadyText(plan)}</p>
          ) : (
            <>
              {going.length ? (
                <details className="group rounded-inner border border-line" onToggle={(event) => setListOpen(event.currentTarget.open)}>
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm [&::-webkit-details-marker]:hidden">
                    <span>Переглянути чати партії</span><span className="font-mono tabular-nums text-ink-2">{chosen}</span>
                  </summary>
                  <ol className="m-0 flex max-h-72 list-none flex-col gap-2 overflow-y-auto p-0 px-3 pb-3 sm:max-h-96">
                    {going.map((chat, index) => (
                      <li key={chat.id} className="flex flex-col gap-0.5 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="w-6 shrink-0 text-right font-mono text-xs tabular-nums text-ink-3">{index + 1}</span>
                          <span className="min-w-0 flex-1 truncate" title={chat.name}>{chat.name}</span>
                          <button type="button" aria-label={`Прибрати з цього запуску: ${chat.name}`} title="Прибрати лише з цього запуску" onClick={() => setRemoved((current) => [...current, chat.id])} className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-ink-3 hover:bg-raised hover:text-ink [@media(pointer:coarse)]:size-11"><X aria-hidden="true" strokeWidth={1.5} className="size-4" /></button>
                        </div>
                        {poolPreview ? <PoolTextLine chatId={chat.id} preview={poolPreview} /> : null}
                      </li>
                    ))}
                  </ol>
                </details>
              ) : null}
              {startSlot}
              <div className="flex flex-wrap items-center justify-end gap-3">
                <Segmented<'1' | '5' | '20' | 'all'> label="Скільки чатів у партії" size="sm" value={size} onValueChange={setSize} items={[{ value: '1', label: '1' }, { value: '5', label: '5' }, { value: '20', label: '20' }, { value: 'all', label: `Усі (${cap})` }]} />
                <div className="flex flex-col items-end gap-1">
                  <Button variant="action" busy={busy} disabled={runnerBlocked || !ready || chosen === 0} title={ready ? undefined : 'Спершу додай фото'} onClick={() => onStart(chosen, removedNow)}>
                    <Send aria-hidden="true" strokeWidth={1.5} />{busy ? 'Ставимо в чергу…' : `Опублікувати в ${chosen} ${chatWord(chosen)}`}
                  </Button>
                  <span className="text-xs text-ink-2">{chosen ? (startNote ?? `${etaText(chosen * secondsPerChat)}, по одному чату з підтвердженням`) : ''}</span>
                </div>
              </div>
            </>
          )}
        </section>
      ) : null}

      {running ? (
        <div className="flex justify-end">
          <Button variant="outline" tone="danger" disabled={busy} onClick={onStop}><Square aria-hidden="true" strokeWidth={1.5} />Зупинити автопост</Button>
        </div>
      ) : null}

      {midSlot}

      <AutopostAttentionList items={attention} busy={busy} canVerify messenger={platform} onDecide={onDecide} onDecideMany={onDecideMany} />

      <ConfirmDialog
        open={confirmReset}
        title="Почати сьогоднішню чергу заново"
        description="Усі ще не відправлені задачі сьогодні й чати з «Потребують рішення» зникнуть із черги автопосту, а самі чати знову стануть доступні для нового запуску. Уже відправлені повідомлення лишаються як є."
        confirmLabel="Почати заново"
        busy={busy}
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => { setConfirmReset(false); onReset(); }}
      />
    </Surface>
  );
}
