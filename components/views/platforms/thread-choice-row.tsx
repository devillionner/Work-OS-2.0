'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { TelegramThreadChoice } from '@/components/views/platforms/autopost-panel';
import { DirectionsField, type DirectionDictionary } from '@/components/views/platforms/directions-field';
import { ThreadPicker } from '@/components/views/platforms/thread-picker';

/**
 * Рядок блоку «Обери гілку». Напрями (необов'язкові) вибираються до гілки: вибір гілки зберігає чат, а разом із ним напрями («лише ці напрямки»), тож чат
 * одразу отримує текст свого напряму. Телефон: назва, під нею «Гілка» й «Напрямки» в один рівень, нижче тихі «Відкрити» і «Пропустити сьогодні»;
 * ПК: назва, «Гілка», «Напрямки» й тихі дії в один-два рядки.
 */
export function ThreadChoiceRow({ choice, dupNote, dictionary, busy, onChoose, onScan, onSkip, onOpen }: {
  choice: TelegramThreadChoice;
  dupNote: string | null | undefined;
  dictionary: DirectionDictionary;
  busy: boolean;
  onChoose: (chatId: string, threadId: string | null, directions?: string[]) => void;
  onScan: (target?: string | string[]) => void;
  onSkip: (chatId: string) => void;
  onOpen: (link: string) => void;
}) {
  const [directions, setDirections] = useState<string[]>(choice.profile?.directions ?? []);
  const open = choice.topics.filter((topic) => !topic.closed);
  const collecting = Boolean(choice.collecting || choice.needsScan);
  const canPick = choice.topics.length > 0;
  return (
    <li className="flex flex-col gap-2 rounded-inner border border-line px-3 py-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3">
      <span className="min-w-0 truncate text-sm font-medium sm:flex-1 sm:basis-40" title={choice.name}>{choice.name}</span>
      {dupNote ? <span className="text-xs text-ink-2 sm:basis-full">{dupNote}</span> : null}
      {canPick ? (
        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
          <div className="min-w-0 sm:w-40"><ThreadPicker choice={choice} busy={busy} onChoose={(chatId, threadId) => onChoose(chatId, threadId, directions)} className="h-10 w-full justify-between" /></div>
          <div className="min-w-0 sm:w-56"><DirectionsField id={`thread-directions-${choice.chatId}`} compact emptyLabel="Напрямки" dictionary={dictionary} values={directions} onChange={setDirections} disabled={busy} /></div>
        </div>
      ) : collecting ? <output className="text-xs text-ink-2">Збираю гілки…</output>
        : <button type="button" disabled={busy} title="Відкриє чат і прочитає список гілок; місць «на годину» не займає" onClick={() => onScan(choice.chatId)} className="inline-flex min-h-9 items-center rounded-full border border-line px-3 text-xs hover:bg-raised disabled:opacity-45 [@media(pointer:coarse)]:min-h-11">Знайти гілки</button>}
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
        {choice.link ? <Button variant="ghost" size="sm" onClick={() => onOpen(choice.link as string)}>Відкрити</Button> : null}
        <Button variant="ghost" size="sm" disabled={busy} title="Чат повернеться в чергу завтра" onClick={() => onSkip(choice.chatId)}>Пропустити сьогодні</Button>
      </div>
      {choice.restrictedAt ? <span className="text-xs text-ink-2 sm:basis-full">Зараз писати не можна (обмеження чату). Гілки відкриті, чат відкладається автоматично.</span> : null}
      {choice.topics.length && !open.length ? <span className="text-xs text-ink-2 sm:basis-full">Усі гілки позначені закритими (значок замка в Telegram). Якщо це не так, перевір гілки ще раз.</span> : null}
    </li>
  );
}
