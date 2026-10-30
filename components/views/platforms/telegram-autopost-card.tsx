'use client';

import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { PaceEstimate, PaceLine, PaceSegment, secondsPerChat, usePerHour } from '@/components/views/platforms/pace-control';
import { AutopostPanel, chatWord, type AutopostMaterialProps, type AutopostPlan, type AutopostReadiness, type TelegramThreadChoice } from '@/components/views/platforms/autopost-panel';
import type { AutopostAttentionItem, AutopostDecision } from '@/components/views/platforms/autopost-attention';
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

/** Чати з гілками, для яких гілку ще не вибрано: зі списком гілок (закриті сірі, вибрати їх не можна). Вибір зберігається. */
function ThreadChoices({ choices, busy, onChoose, onScan }: { choices: TelegramThreadChoice[]; busy: boolean; onChoose: (chatId: string, threadId: string | null) => void; onScan: (chatId?: string) => void }) {
  if (!choices.length) return null;
  return (
    <section className="flex flex-col gap-2" aria-label="Чати, для яких треба вибрати гілку">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 text-sm font-medium">Вибрати гілку <span className="font-mono font-normal tabular-nums text-ink-2">{choices.length}</span></h3>
        <Button variant="outline" size="sm" disabled={busy} title="Швидко відкриє ці чати й доповнить списки гілок; місць «на годину» не займає" onClick={() => onScan()}>Знайти гілки</Button>
      </div>
      <p className="m-0 text-xs text-ink-2">У цих чатах є гілки. Такі чати в партію не входять і місць «на годину» не займають; чат піде в чергу, щойно ти вибереш гілку, і наступного разу питати не буду. Список гілок може бути неповним: «Знайти гілки» доповнює його.</p>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {choices.map((choice) => {
          const open = choice.topics.filter((topic) => !topic.closed);
          return (
            <li key={choice.chatId} className="flex flex-wrap items-center gap-3 rounded-inner border border-line px-3 py-2.5">
              <span className="min-w-0 flex-1 truncate text-sm font-medium" title={choice.name}>{choice.name}</span>
              {choice.topics.length ? (
                <Menu>
                  <MenuTrigger render={<button type="button" disabled={busy} aria-label={`Вибрати гілку для чату ${choice.name}`} className="inline-flex min-h-9 items-center gap-2 rounded-full border border-line px-4 text-sm hover:bg-raised disabled:opacity-45" />}>
                    {open.length ? 'Вибрати гілку' : 'Усі гілки закриті'}<ChevronDown aria-hidden="true" strokeWidth={1.5} className="size-4" />
                  </MenuTrigger>
                  <MenuContent align="end">
                    {choice.topics.map((topic) => (
                      <MenuItem key={topic.id} disabled={topic.closed} onClick={() => onChoose(choice.chatId, topic.id)}>
                        <span className={topic.closed ? 'text-ink-3' : undefined}>{topic.title}</span>
                        {topic.closed ? <span className="ml-auto text-xs text-ink-3">закрита</span> : null}
                      </MenuItem>
                    ))}
                  </MenuContent>
                </Menu>
              ) : <span className="text-xs text-ink-2">Список гілок ще не зібрано</span>}
              <button type="button" disabled={busy} title="Відкриє чат і заново прочитає повний список гілок; місць «на годину» не займає" onClick={() => onScan(choice.chatId)} className="inline-flex min-h-9 items-center rounded-full px-3 text-xs text-ink-2 hover:bg-raised disabled:opacity-45">Перевірити гілки ще раз</button>
              {choice.restrictedAt ? <span className="basis-full text-xs text-ink-2">Зараз писати не можна (обмеження чату). Гілки відкриті, чат відкладається автоматично.</span> : null}
              {choice.topics.length && !open.length ? <span className="basis-full text-xs text-ink-2">Усі гілки позначені закритими (значок замка в Telegram). Якщо це не так, перевір гілки ще раз.</span> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Автопублікація у Telegram через браузер: спільна картка автопосту, текст оголошення з Бібліотеки для кожного чату (як при ручній
 * публікації), темп «5 · 10 · 20 на годину», прив'язка акаунта до браузера й вибір гілок форумів.
 */
export function TelegramAutopostCard({ runnerSeen, onScanThreads, material, plan, onLoadPlan, runnerConnected, status, pace, progress, attention, batchNote, binding, busy, onDecide, onDecideMany, onStart, onStop, onReset, onChooseThread, onBind }: {
  /** Від runner приходять події (кроки, стан): він на зв'язку, навіть коли прапорець каналу ще не оновився. */
  runnerSeen: boolean;
  onScanThreads: (chatId?: string) => void;
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
  onDecide: (item: AutopostAttentionItem, decision: AutopostDecision) => void;
  onDecideMany: (items: AutopostAttentionItem[], decision: AutopostDecision) => void;
  onStart: (limit: number | null, exclude: string[], perHour: number) => void;
  onStop: () => void;
  onReset: () => void;
  onChooseThread: (chatId: string, threadId: string | null) => void;
  onBind: (webUserId: string | null) => void;
}) {
  const [perHour, setPerHour] = usePerHour('telegram');
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

  return (
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
          <li>Фото й текст у Telegram власні, окремі від WhatsApp і Viber (кнопка «Взяти з WhatsApp/Viber» копіює їх). Без свого тексту береться оголошення з Бібліотеки за мовою й напрямками профілю чату. Фото необов’язкове: підпис до фото — до 1024 символів, текст без фото — до 4096.</li>
          <li>Чат у розкладі на сьогодні автопост не бере. Якщо Telegram просить зачекати, вся черга Telegram стає на паузу на вказаний час.</li>
        </ol>
      )}
      material={material}
      progress={progress}
      attention={attention}
      batchNote={batchNote}
      busy={busy}
      runnerBlocked={(runnerConnected === false && !runnerSeen) || unbound || status?.state === 'blocked' && status.reason === 'telegram_account_mismatch'}
      topSlot={(
        <div className="flex flex-col gap-3">
          <AccountBinding binding={binding} status={status} busy={busy} onBind={onBind} />
          <PaceEstimate platform="telegram" count={plan?.ready ?? 0} perHour={perHour} running={running} />
          {(plan?.unscanned ?? 0) > 0 && !running ? <p className="m-0 text-xs text-ink-2">{plan?.unscanned} {chatWord(plan?.unscanned ?? 0)} ще не перевірено на гілки: перед публікацією їх швидко відкриє прохід, він не займає місць «на годину». Можна зробити це наперед кнопкою «Знайти гілки» нижче.</p> : null}
          <PaceLine pace={pace} progress={progress} running={running} status={status} noun="публікація" />
        </div>
      )}
      startSlot={<PaceSegment platform="telegram" value={perHour} onChange={setPerHour} />}
      midSlot={(
        <>
          <TooLongChats chats={plan?.tooLongChats ?? []} total={plan?.tooLong ?? 0} />
          <ThreadChoices choices={plan?.threadChoices ?? []} busy={busy} onChoose={onChooseThread} onScan={onScanThreads} />
        </>
      )}
      onDecide={onDecide}
      onDecideMany={onDecideMany}
      onStart={(limit, exclude) => onStart(limit, exclude, perHour)}
      onStop={onStop}
      onReset={onReset}
    />
  );
}

