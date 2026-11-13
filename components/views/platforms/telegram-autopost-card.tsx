'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { PaceEstimate, PaceLine, PaceSegment, secondsPerChat, usePerHour } from '@/components/views/platforms/pace-control';
import { DuplicateRows } from '@/components/views/platforms/duplicate-frame';
import { ThreadPicker } from '@/components/views/platforms/thread-picker';
import { PoolPanel } from '@/components/views/platforms/pool-panel';
import { usePoolPreview } from '@/components/views/platforms/use-pool-preview';
import { endingText } from '@/components/views/platforms/pool-types';
import { AutopostPanel, chatWord, type AutopostMaterialProps, type AutopostPlan, type AutopostReadiness, type TelegramThreadChoice } from '@/components/views/platforms/autopost-panel';
import type { AutopostAttentionItem, AutopostDecision, DecideOptions } from '@/components/views/platforms/autopost-attention';
import type { WhatsAppAutopostProgress } from '@/components/views/platforms/autopost-card';
import type { AutopostPlatformStatus, TelegramPace } from '@/lib/live-channel';

/** Прив'язка Telegram-акаунта Work OS до акаунта, залогіненого в браузері runner: автопост публікує лише з нього. */
function AccountBinding({ binding, status, busy, onBind }: { binding: { bound: boolean; webUserId: string | null } | null; status: AutopostPlatformStatus | null; busy: boolean; onBind: (webUserId: string | null) => void }) {
  const identity = status?.identity ?? null;
  if (!binding) return null;
  if (!binding.bound) {
    return (
      <div className="flex flex-col gap-2 rounded-inner border border-line p-4">
        <p className="m-0 text-sm font-medium">Акаунт Telegram у браузері ще не прив’язано</p>
        <p className="m-0 text-sm text-ink-2">Автопост перевіряє, що в Telegram Web відкрито саме цей акаунт Work OS. Увійди в нього у вкладці браузера runner і прив’яжи.</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" disabled={busy || !identity} onClick={() => onBind(identity)}>Прив’язати цей акаунт</Button>
          {identity ? <span className="font-mono text-xs tabular-nums text-ink-2">id {identity}</span> : <span className="text-xs text-ink-2">Telegram Web у браузері runner не відповів: відкрий web.telegram.org і зачекай хвилину.</span>}
        </div>
      </div>
    );
  }
  const other = identity !== null && identity !== binding.webUserId;
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span className={other ? 'text-hot' : 'text-ink-2'}>{other ? 'У браузері відкрито інший акаунт Telegram, не той, що прив’язано.' : 'Акаунт прив’язано до браузера runner.'}</span>
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => onBind(null)}>Прибрати прив’язку</Button>
    </div>
  );
}

/** Рядок пулу текстових оголошень: скільки їх, скільки вільних сьогодні, які напрями закінчуються; «Вставити список» відкриває розбір списку. */
function PoolRow({ plan, onOpen }: { plan: AutopostPlan | null; onOpen: () => void }) {
  const pool = plan?.pool;
  const waiting = plan?.textWaiting ?? 0;
  const ending = pool ? endingText(pool) : '';
  return (
    <div className="flex flex-col gap-1.5 rounded-inner border border-line px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="m-0 min-w-0 flex-1 basis-52 text-sm">
          <span className="text-ink-2">Оголошення: </span>
          {pool ? (
            <>пул <b className="font-mono font-medium tabular-nums">{pool.total}</b> · вільних сьогодні <b className="font-mono font-medium tabular-nums">{pool.free}</b>{ending ? <span className="text-ink-2"> · {ending}</span> : null}</>
          ) : plan ? <span className="text-ink-2">пулу немає, працює власний текст або Бібліотека</span> : <span className="text-ink-2">рахую…</span>}
        </p>
        <Button variant="outline" size="sm" onClick={onOpen}>{pool ? 'Оновити список' : 'Вставити список'}</Button>
      </div>
      {pool && pool.free === 0 ? <p className="m-0 text-sm text-warn">Тексти на сьогодні закінчились{waiting ? ` · ${waiting} ${chatWord(waiting)} ${waiting % 10 === 1 && waiting % 100 !== 11 ? 'чекає' : 'чекають'}` : ''}</p> : waiting > 0 ? <p className="m-0 text-xs text-ink-2">Вільних текстів на сьогодні менше, ніж чатів: {waiting} {chatWord(waiting)} {waiting % 10 === 1 && waiting % 100 !== 11 ? 'чекає' : 'чекають'} на завтра.</p> : null}
    </div>
  );
}

/** Чати, чий текст із Бібліотеки не влізе в підпис до фото (понад 1024 символи): вони не входять у партію, нічого не надсилається обрізаним. */
function TooLongChats({ chats, total }: { chats: Array<{ id: string; name: string; length: number }>; total: number }) {
  if (!total) return null;
  return (
    <details className="group rounded-inner border border-line">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm [&::-webkit-details-marker]:hidden">
        <span>{total} {total % 10 === 1 && total % 100 !== 11 ? 'чат' : total % 10 >= 2 && total % 10 <= 4 && (total % 100 < 12 || total % 100 > 14) ? 'чати' : 'чатів'}: текст задовгий для підпису до фото</span>
        <span className="text-xs text-ink-3 group-open:hidden">розгорнути</span>
      </summary>
      <div className="flex flex-col gap-2 px-4 pb-3">
        <p className="m-0 text-xs text-ink-2">Текст із Бібліотеки для цих чатів довший за 1024 символи. З фото вони не підуть, а без фото підуть; можна скоротити оголошення або прибрати фото.</p>
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {chats.map((chat) => <li key={chat.id} className="flex items-center gap-2 text-sm"><span className="min-w-0 flex-1 truncate" title={chat.name}>{chat.name}</span><span className="font-mono text-xs tabular-nums text-ink-2">{chat.length}</span></li>)}
        </ul>
      </div>
    </details>
  );
}

/**
 * «Обери гілку · N»: усі чати, для яких гілку вибирає власник, в одному місці над ходом партії (видно й під час партії, і без неї): форуми без вибраної
 * гілки й чати, що сьогодні закінчились збоєм гілки (поки прохід гілок збирає список, рядок пише «Збираю гілки…»). Гілку обирає людина, автоматично нічого
 * не вибирається; вибір зберігається назавжди й одразу ставить чат у партію (чи лишає серед «Готових»). «Пропустити сьогодні» відкладає чат до завтра.
 */
function ThreadChoices({ choices, busy, onChoose, onScan, onSkip, onOpen }: {
  choices: TelegramThreadChoice[];
  busy: boolean;
  onChoose: (chatId: string, threadId: string | null) => void;
  onScan: (target?: string | string[]) => void;
  onSkip: (chatId: string) => void;
  onOpen: (link: string) => void;
}) {
  if (!choices.length) return null;
  return (
    <section id="thread-choices" className="flex flex-col gap-2 scroll-mt-20" aria-label="Чати, для яких треба вибрати гілку">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 text-sm font-medium">Обери гілку <span className="font-mono font-normal tabular-nums text-ink-2">· {choices.length}</span></h3>
        <Button variant="outline" size="sm" disabled={busy} title="Швидко відкриє ці чати й доповнить списки гілок; місць «на годину» не займає" onClick={() => onScan()}>Знайти гілки</Button>
      </div>
      <p className="m-0 text-xs text-ink-2">У цих чатах є гілки (чи вони могли бути). Обери гілку один раз: чат одразу піде в партію, а наступного разу питати не буду. Поки гілку не вибрано, чат у партію не входить.</p>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        <DuplicateRows items={choices.map((choice) => ({ value: choice, id: choice.chatId, dup: choice.dup ?? null }))} renderItem={(choice, dupNote) => {
          const open = choice.topics.filter((topic) => !topic.closed);
          const collecting = Boolean(choice.collecting || choice.needsScan);
          return (
            <li key={choice.chatId} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-inner border border-line px-3 py-2.5">
              <span className="min-w-0 flex-1 basis-40 truncate text-sm font-medium" title={choice.name}>{choice.name}</span>
              {dupNote ? <span className="basis-full text-xs text-ink-2">{dupNote}</span> : null}
              <div className="flex flex-wrap items-center gap-2">
                {choice.topics.length ? <ThreadPicker choice={choice} busy={busy} onChoose={onChoose} />
                  : collecting ? <output className="text-xs text-ink-2">Збираю гілки…</output>
                    : <button type="button" disabled={busy} title="Відкриє чат і прочитає список гілок; місць «на годину» не займає" onClick={() => onScan(choice.chatId)} className="inline-flex min-h-9 items-center rounded-full border border-line px-3 text-xs hover:bg-raised disabled:opacity-45 [@media(pointer:coarse)]:min-h-11">Знайти гілки</button>}
                {choice.link ? <Button variant="ghost" size="sm" onClick={() => onOpen(choice.link as string)}>Відкрити</Button> : null}
                <Button variant="ghost" size="sm" disabled={busy} title="Чат повернеться в чергу завтра" onClick={() => onSkip(choice.chatId)}>Пропустити сьогодні</Button>
              </div>
              {choice.restrictedAt ? <span className="basis-full text-xs text-ink-2">Зараз писати не можна (обмеження чату). Гілки відкриті, чат відкладається автоматично.</span> : null}
              {choice.topics.length && !open.length ? <span className="basis-full text-xs text-ink-2">Усі гілки позначені закритими (значок замка в Telegram). Якщо це не так, перевір гілки ще раз.</span> : null}
            </li>
          );
        }} />
      </ul>
    </section>
  );
}

/**
 * Автопублікація у Telegram через браузер: спільна картка автопосту, текст оголошення з Бібліотеки для кожного чату (як при ручній
 * публікації), темп «5 · 10 · 20 на годину», прив'язка акаунта до браузера й вибір гілок форумів.
 */
export function TelegramAutopostCard({ accountId, runnerSeen, onScanThreads, onSkipThread, onOpenChat, material, plan, onLoadPlan, runnerConnected, status, pace, progress, attention, batchNote, binding, busy, onDecide, onDecideMany, onStart, onStop, onReset, onChooseThread, onBind }: {
  /** Вибраний акаунт Telegram: для нього рахується підбір текстів пулу. */
  accountId: string | null;
  /** Від runner приходять події (кроки, стан): він на зв'язку, навіть коли прапорець каналу ще не оновився. */
  runnerSeen: boolean;
  onScanThreads: (target?: string | string[]) => void;
  /** «Пропустити сьогодні» в блоці «Обери гілку». */
  onSkipThread: (chatId: string) => void;
  /** Відкрити чат у Telegram. */
  onOpenChat: (link: string) => void;
  /** Власні фото й текст Telegram (не спільні з WhatsApp і Viber). */
  material: AutopostMaterialProps;
  plan: AutopostPlan | null;
  onLoadPlan: () => void;
  runnerConnected: boolean | null;
  status: AutopostPlatformStatus | null;
  pace: TelegramPace | null;
  progress: WhatsAppAutopostProgress | null;
  attention: AutopostAttentionItem[];
  batchNote: string | null;
  binding: { bound: boolean; webUserId: string | null } | null;
  busy: boolean;
  onDecide: (item: AutopostAttentionItem, decision: AutopostDecision, options?: DecideOptions) => void;
  onDecideMany: (items: AutopostAttentionItem[], decision: AutopostDecision, options?: DecideOptions) => void;
  onStart: (limit: number | null, exclude: string[], perHour: number, texts: Record<string, string>) => void;
  onStop: () => void;
  onReset: () => void;
  onChooseThread: (chatId: string, threadId: string | null) => void;
  onBind: (webUserId: string | null) => void;
}) {
  const [perHour, setPerHour] = usePerHour('telegram');
  const toast = useToast();
  const [poolOpen, setPoolOpen] = useState(false);
  const [sourceBusy, setSourceBusy] = useState(false);
  const preview = usePoolPreview(accountId);
  const running = progress?.running === true;
  const unbound = binding !== null && !binding.bound;
  const online = runnerConnected === true || runnerSeen;
  const readiness: AutopostReadiness = runnerConnected === false && !runnerSeen
    ? { tone: 'hot', text: 'Runner вимкнений. Автопост не працює, поки його не запущено.' }
    : online && status?.state === 'blocked'
      ? { tone: 'warn', text: status.text || 'Автопост Telegram на паузі.' }
      : unbound
        ? { tone: 'warn', text: 'Прив’яжи акаунт Telegram до браузера runner, щоб запустити автопост.' }
        : online
          ? { tone: 'ok', text: 'Runner підключений. Вкладка Telegram Web у його браузері має бути відкрита й залогінена в акаунт Work OS.' }
          : { tone: 'idle', text: 'Чекаю на зв’язок із runner на ПК…' };
  const minutes = Math.round(60 / perHour);
  const source = plan?.source;
  // Режим публікації зберігається на сервері (один для всіх акаунтів): план і партія беруть його звідти, тож після зміни план перечитується.
  const changeSource = (mode: 'pool' | 'own') => {
    setSourceBusy(true);
    void fetch('/api/messenger-automation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'telegram-source', mode }) })
      .then(async (response) => { if (!response.ok) { const body = await response.json().catch(() => ({})) as { error?: string }; throw new Error(body.error || 'Не вдалося змінити режим.'); } onLoadPlan(); toast.push({ message: mode === 'pool' ? 'Публікуємо оголошення з пулу: кожен чат отримає свій текст.' : 'Публікуємо власне фото й текст: усі чати отримають однаковий матеріал.' }); })
      .catch((error: unknown) => toast.push({ message: error instanceof Error ? error.message : 'Не вдалося змінити режим.' }))
      .finally(() => setSourceBusy(false));
  };

  return (
    <>
    <AutopostPanel
      platform="telegram"
      title="Автопублікація у Telegram"
      description="Чати з черги «Для публікації» вибраного акаунта по одному: Work OS відкриває чат у Telegram Web (у чаті з гілками — вибрану гілку), вставляє текст оголошення з Бібліотеки, надсилає й перевіряє, що повідомлення з’явилось."
      plan={plan}
      onLoadPlan={onLoadPlan}
      secondsPerChat={secondsPerChat('telegram', perHour)}
      startNote={`${perHour} на годину: один чат кожні ${minutes} хв, з підтвердженням`}
      readiness={readiness}
      settingsTitle="Як підготувати автопост Telegram"
      settingsHelp={(
        <ol className="m-0 flex flex-col gap-1.5 pl-5">
          <li>У браузері runner відкрий web.telegram.org/a і залогінься в акаунт, який вибрано вгорі в Work OS.</li>
          <li>Прив’яжи акаунт кнопкою вище: перед кожним чатом автопост перевіряє, що відкрито саме його.</li>
          <li>Фото й текст у Telegram власні, окремі від WhatsApp і Viber (кнопка «Взяти з WhatsApp/Viber» копіює їх). У блоці «Що піде в чати» обери, що публікувати: «Пул оголошень» (кожен чат отримує окремий текст за напрямом, мовою й аудиторією, за добу жоден текст не йде вдруге) або «Власне фото й текст» (усі чати отримують однаковий матеріал; без власного тексту береться оголошення з Бібліотеки). Вибір зберігається для всіх акаунтів Telegram і діє на нові партії. Фото необов’язкове: підпис до фото — до 1024 символів, текст без фото — до 4096.</li>
          <li>Чат у розкладі на сьогодні автопост не бере. Якщо Telegram просить зачекати, вся черга Telegram стає на паузу на вказаний час.</li>
        </ol>
      )}
      material={{ ...material, poolActive: Boolean(plan?.pool), source: source ? { mode: source.mode, poolAvailable: source.poolAvailable, ownAvailable: source.ownAvailable, busy: sourceBusy, onChange: changeSource, onOpenPool: () => setPoolOpen(true) } : undefined }}
      progress={progress}
      attention={attention}
      batchNote={batchNote}
      busy={busy}
      runnerBlocked={(runnerConnected === false && !runnerSeen) || unbound || status?.state === 'blocked' && status.reason === 'telegram_account_mismatch'}
      topSlot={(
        <div className="flex flex-col gap-3">
          {source?.mode === 'pool' ? <PoolRow plan={plan} onOpen={() => setPoolOpen(true)} /> : null}
          <AccountBinding binding={binding} status={status} busy={busy} onBind={onBind} />
          <ThreadChoices choices={plan?.threadChoices ?? []} busy={busy} onChoose={onChooseThread} onScan={onScanThreads} onSkip={onSkipThread} onOpen={onOpenChat} />
          <PaceEstimate platform="telegram" count={plan?.ready ?? 0} perHour={perHour} running={running} />
          {(plan?.unscanned ?? 0) > 0 && !running ? <p className="m-0 text-xs text-ink-2">{plan?.unscanned} {chatWord(plan?.unscanned ?? 0)} ще не перевірено на гілки: перед публікацією їх швидко відкриє прохід, він не займає місць «на годину». Можна зробити це наперед кнопкою «Знайти гілки» нижче.</p> : null}
          <PaceLine pace={pace} progress={progress} running={running} status={status} noun="публікація" />
        </div>
      )}
      startSlot={<PaceSegment platform="telegram" value={perHour} onChange={setPerHour} />}
      midSlot={(
        <>
          <TooLongChats chats={plan?.tooLongChats ?? []} total={plan?.tooLong ?? 0} />
        </>
      )}
      onDecide={onDecide}
      onDecideMany={onDecideMany}
      poolPreview={plan?.pool ? preview : undefined}
      onStart={(limit, exclude) => { onStart(limit, exclude, perHour, preview.overrides); preview.clear(); }}
      onStop={onStop}
      onReset={onReset}
    />
    <PoolPanel open={poolOpen} onOpenChange={setPoolOpen} total={source?.poolTotal ?? 0} onSaved={onLoadPlan} />
    </>
  );
}

