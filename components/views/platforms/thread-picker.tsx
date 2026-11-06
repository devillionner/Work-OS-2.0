'use client';

import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Panel } from '@/components/shell/panel';
import { PHONE, useMediaQuery } from '@/components/shell/use-media';
import { Input } from '@/components/ui/input';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import type { TelegramThreadChoice } from '@/components/views/platforms/autopost-panel';

/** Від такої кількості гілок угорі списку з'являється пошук. */
const SEARCH_FROM = 8;
const TRIGGER = 'inline-flex min-h-9 items-center gap-2 rounded-full border border-line px-4 text-sm hover:bg-raised disabled:opacity-45 [@media(pointer:coarse)]:min-h-11';

/**
 * Вибір гілки форуму. Короткий список на ПК — випадне меню (воно прокручується, якщо не вміщується); на телефоні й при понад
 * SEARCH_FROM гілках — панель (Sheet знизу) з пошуком і власною прокруткою: меню з десятками пунктів виходило за екран iPhone.
 * Закриті гілки сірі й невибірні.
 */
export function ThreadPicker({ choice, busy, onChoose }: { choice: TelegramThreadChoice; busy: boolean; onChoose: (chatId: string, threadId: string | null) => void }) {
  const phone = useMediaQuery(PHONE);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const hasOpen = choice.topics.some((topic) => !topic.closed);
  const label = hasOpen ? 'Вибрати гілку' : 'Усі гілки закриті';
  const searchable = choice.topics.length > SEARCH_FROM;
  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('uk');
    return needle ? choice.topics.filter((topic) => topic.title.toLocaleLowerCase('uk').includes(needle)) : choice.topics;
  }, [choice.topics, query]);

  if (!phone && !searchable) {
    return (
      <Menu>
        <MenuTrigger render={<button type="button" disabled={busy} aria-label={`Вибрати гілку для чату ${choice.name}`} className={TRIGGER} />}>
          {label}<ChevronDown aria-hidden="true" strokeWidth={1.5} className="size-4" />
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
    );
  }

  const close = () => { setOpen(false); setQuery(''); };
  return (
    <>
      <button type="button" disabled={busy} aria-label={`Вибрати гілку для чату ${choice.name}`} className={TRIGGER} onClick={() => setOpen(true)}>
        {label}<ChevronDown aria-hidden="true" strokeWidth={1.5} className="size-4" />
      </button>
      <Panel open={open} onOpenChange={(next) => { if (!next) close(); }} title="Вибрати гілку" subtitle={choice.name}>
        <div className="flex flex-col gap-3">
          {searchable ? <Input type="search" inputMode="search" autoComplete="off" aria-label="Пошук гілки" placeholder="Назва гілки" value={query} onChange={(event) => setQuery(event.target.value)} /> : null}
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {shown.map((topic) => (
              <li key={topic.id}>
                <button
                  type="button"
                  disabled={topic.closed || busy}
                  onClick={() => { close(); onChoose(choice.chatId, topic.id); }}
                  className="flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-field px-3 text-left text-sm text-ink hover:bg-raised disabled:cursor-default disabled:opacity-45 disabled:hover:bg-transparent"
                >
                  <span className={topic.closed ? 'min-w-0 flex-1 truncate text-ink-3' : 'min-w-0 flex-1 truncate'}>{topic.title}</span>
                  {topic.closed ? <span className="shrink-0 text-xs text-ink-3">закрита</span> : null}
                </button>
              </li>
            ))}
          </ul>
          {shown.length === 0 ? <p className="m-0 text-sm text-ink-2">Гілок із такою назвою немає.</p> : null}
        </div>
      </Panel>
    </>
  );
}
