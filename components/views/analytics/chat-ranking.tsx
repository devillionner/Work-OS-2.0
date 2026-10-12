'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Select } from '@/components/ui/select';
import { CHAT_RANKING_MIN_PUBLICATIONS, chatLanguageLabel, hasEnoughChatRankingData, rankAnalyticsChats, responseConversionLabel, type AnalyticsRankedChat } from '@/lib/analytics-chat-ranking';
import { SectionCard, BarRow } from '@/components/views/shared/card';

const LIMIT = 12;

/** Рейтинг чатів за конверсією відгуків у публікації; чати з малою вибіркою йдуть в кінець зі смужкою без акценту. */
export function ChatRanking({ chats, platform: platformFilter, onPlatformChange, className }: { chats: AnalyticsRankedChat[]; platform: string; onPlatformChange: (platform: string) => void; className?: string }) {
  const [direction, setDirection] = useState('all');
  const [language, setLanguage] = useState('all');
  const [expanded, setExpanded] = useState(false);

  const platforms = useMemo(
    () => [...new Map(chats.map((chat) => [chat.platform, chat.platformName])).entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, 'uk')),
    [chats],
  );
  // Фільтр, якого немає серед платформ нового періоду, діє як «усі».
  const platform = platformFilter === 'all' || platforms.some((option) => option.value === platformFilter) ? platformFilter : 'all';
  const directions = useMemo(() => [...new Set(chats.flatMap((chat) => chat.directions))].sort((a, b) => a.localeCompare(b, 'uk')), [chats]);
  const ranked = useMemo(() => rankAnalyticsChats(chats, { platform, direction, language }), [chats, platform, direction, language]);
  const peak = Math.max(1, ...ranked.map((chat) => chat.responseRate));
  const shown = expanded ? ranked : ranked.slice(0, LIMIT);

  return (
    <SectionCard
      className={className}
      title="Ефективність чатів"
      hint={`Конверсія = відгуки / публікації за вибраний період. Чати з менш ніж ${CHAT_RANKING_MIN_PUBLICATIONS} публікаціями — мала вибірка.`}
    >
      <fieldset className="m-0 grid min-w-0 grid-cols-1 gap-2 border-0 p-0 @2xl:grid-cols-3">
        <legend className="sr-only">Фільтри рейтингу чатів</legend>
        <Select aria-label="Платформа" value={platform} onChange={(event) => onPlatformChange(event.target.value)}>
          <option value="all">Усі платформи</option>
          {platforms.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </Select>
        <Select aria-label="Напрямок" value={direction} onChange={(event) => setDirection(event.target.value)}>
          <option value="all">Усі напрямки</option>
          {directions.map((item) => <option key={item} value={item}>{item}</option>)}
        </Select>
        <Select aria-label="Мова" value={language} onChange={(event) => setLanguage(event.target.value)}>
          <option value="all">Усі мови</option>
          <option value="uk">Українська</option>
          <option value="ru">Російська</option>
          <option value="unknown">Не визначено</option>
        </Select>
      </fieldset>
      {ranked.length === 0 ? (
        <EmptyState text={chats.length ? 'За обраними фільтрами чатів немає.' : 'Чати з активністю з’являться тут після роботи.'} />
      ) : (
        <>
          <ul className="m-0 flex list-none flex-col p-0">
            {shown.map((chat) => {
              const enough = hasEnoughChatRankingData(chat);
              return (
                <BarRow
                  key={chat.id}
                  label={<span title={chat.name}>{chat.name}</span>}
                  sub={`${chat.platformName} · ${chatLanguageLabel(chat.language)}${chat.directions.length ? ` · ${chat.directions.join(', ')}` : ''}${enough ? '' : ' · недостатньо даних'}`}
                  value={responseConversionLabel(chat)}
                  meta={`${chat.publications} публ. · ${chat.responses} відг. · ${chat.bookings} зап.`}
                  ratio={chat.responseRate / peak}
                  faint={!enough}
                />
              );
            })}
          </ul>
          {ranked.length > LIMIT ? (
            <Button variant="ghost" size="sm" className="self-start" onClick={() => setExpanded((value) => !value)}>
              {expanded ? 'Згорнути' : `Показати всі (${ranked.length})`}
            </Button>
          ) : null}
        </>
      )}
    </SectionCard>
  );
}
