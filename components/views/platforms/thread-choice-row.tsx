'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { TelegramThreadChoice } from '@/components/views/platforms/autopost-panel';
import { DirectionsField, type DirectionDictionary } from '@/components/views/platforms/directions-field';
import { ThreadPicker } from '@/components/views/platforms/thread-picker';

/** Назви гілок, куди зазвичай пишуть оголошення (uk/ru основи слів). */
const ADS_TOPIC = /оголош|реклам|послуг|объявл|услуг/i;

/**
 * Рядок блоку «Обери гілку». Гілка й напрями (необов'язкові) обираються в будь-якому порядку й нічого не зберігають: вибір гілки лише запам'ятовується в
 * рядку, і з'являється головна кнопка «Додати в партію» (партії немає: «Зберегти»). Кнопка зберігає все разом: спершу профіль (якщо є напрями, «лише ці
 * напрямки»), потім гілку, тож чат, доданий у партію, одразу отримує текст свого напряму. Рядок зникає лише після успіху; помилка пояснюється в рядку,
 * вибір не губиться. Телефон: назва, «Гілка» й «Напрямки» в один рівень, під ними кнопка на всю ширину, нижче тихі дії; ПК: усе в один-два рядки.
 */
export function ThreadChoiceRow({ choice, dupNote, dictionary, busy, batchRunning, onChoose, onScan, onSkip, onOpen }: {
  choice: TelegramThreadChoice;
  dupNote: string | null | undefined;
  dictionary: DirectionDictionary;
  busy: boolean;
  /** Партія йде: чат додається в її кінець, інакше лише зберігається. */
  batchRunning: boolean;
  /** Повертає null при успіху чи пояснення помилки (вибір лишається в рядку). */
  onChoose: (chatId: string, threadId: string | null, directions?: string[]) => Promise<string | null>;
  onScan: (target?: string | string[]) => void;
  onSkip: (chatId: string) => void;
  onOpen: (link: string) => void;
}) {
  const [directions, setDirections] = useState<string[]>(choice.profile?.directions ?? []);
  const [picked, setPicked] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState('');
  const open = choice.topics.filter((topic) => !topic.closed);
  const collecting = Boolean(choice.collecting || choice.needsScan);
  const canPick = choice.topics.length > 0;
  // Гілка могла закритись чи зникнути після повторної перевірки: тоді вибір недійсний.
  const valid = picked !== null && open.some((topic) => topic.id === picked);
  // Підказка: відкрита гілка, схожа за назвою на гілку для оголошень. Сама нічого не вибирає: тап лише ставить її у вибір, зберігає кнопка.
  const likely = canPick ? open.find((topic) => ADS_TOPIC.test(topic.title)) : undefined;
  const save = async () => {
    if (!valid || picked === null) return;
    setSaving(true); setFailure('');
    const problem = await onChoose(choice.chatId, picked, directions);
    setSaving(false);
    if (problem) setFailure(problem); else setPicked(null);
  };
  return (
    <li className="flex flex-col gap-2 rounded-inner border border-line px-3 py-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3">
      <span className="min-w-0 truncate text-sm font-medium sm:flex-1 sm:basis-40" title={choice.name}>{choice.name}</span>
      {dupNote ? <span className="text-xs text-ink-2 sm:basis-full">{dupNote}</span> : null}
      {canPick ? (
        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
          <div className="min-w-0 sm:w-40"><ThreadPicker choice={choice} busy={busy || saving} selectedId={picked} onChoose={(_chatId, threadId) => { setPicked(threadId); setFailure(''); }} className="h-10 w-full justify-between" /></div>
          <div className="min-w-0 sm:w-56"><DirectionsField id={`thread-directions-${choice.chatId}`} compact emptyLabel="Напрямки" dictionary={dictionary} values={directions} onChange={(next) => { setDirections(next); setFailure(''); }} disabled={busy || saving} /></div>
        </div>
      ) : collecting ? <output className="text-xs text-ink-2">Збираю гілки…</output>
        : <button type="button" disabled={busy} title="Відкриє чат і прочитає список гілок; місць «на годину» не займає" onClick={() => onScan(choice.chatId)} className="inline-flex min-h-9 items-center rounded-full border border-line px-3 text-xs hover:bg-raised disabled:opacity-45 [@media(pointer:coarse)]:min-h-11">Знайти гілки</button>}
      {likely && picked !== likely.id ? (
        <button type="button" disabled={busy || saving} title="Поставити цю гілку у вибір (збереже кнопка нижче)" onClick={() => { setPicked(likely.id); setFailure(''); }} className="self-start text-left text-xs text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink disabled:opacity-45 sm:basis-full">схоже: «{likely.title}»</button>
      ) : null}
      {valid ? <Button variant="action" size="md" disabled={busy || saving} className="w-full sm:w-auto" onClick={() => void save()}>{saving ? 'Зберігаю…' : batchRunning ? 'Додати в партію' : 'Зберегти'}</Button> : null}
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
        {valid ? <Button variant="ghost" size="sm" disabled={saving} onClick={() => { setPicked(null); setFailure(''); }}>Скасувати вибір</Button> : null}
        {choice.link ? <Button variant="ghost" size="sm" onClick={() => onOpen(choice.link as string)}>Відкрити</Button> : null}
        <Button variant="ghost" size="sm" disabled={busy || saving} title="Чат повернеться в чергу завтра" onClick={() => onSkip(choice.chatId)}>Пропустити сьогодні</Button>
      </div>
      {failure ? <p role="alert" className="m-0 text-xs text-hot sm:basis-full">{failure}</p> : null}
      {choice.restrictedAt ? <span className="text-xs text-ink-2 sm:basis-full">Зараз писати не можна (обмеження чату). Гілки відкриті, чат відкладається автоматично.</span> : null}
      {choice.topics.length && !open.length ? <span className="text-xs text-ink-2 sm:basis-full">Усі гілки позначені закритими (значок замка в Telegram). Якщо це не так, перевір гілки ще раз.</span> : null}
    </li>
  );
}
