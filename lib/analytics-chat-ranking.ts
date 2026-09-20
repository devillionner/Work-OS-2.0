export const CHAT_RANKING_MIN_PUBLICATIONS = 3;

export type AnalyticsRankedChat = {
  id: string;
  name: string;
  platform: string;
  platformName: string;
  joined: number;
  publications: number;
  responses: number;
  bookings: number;
  publicationRate: number;
  responseRate: number;
  bookingRate: number;
  language: 'uk' | 'ru' | null;
  directions: string[];
};

export type ChatRankingFilters = {
  platform: string;
  direction: string;
  language: string;
};

export function rankAnalyticsChats(
  chats: AnalyticsRankedChat[],
  filters: ChatRankingFilters,
): AnalyticsRankedChat[] {
  return chats
    .filter((chat) => filters.platform === 'all' || chat.platform === filters.platform)
    .filter((chat) => filters.direction === 'all' || chat.directions.includes(filters.direction))
    .filter((chat) => {
      if (filters.language === 'all') return true;
      if (filters.language === 'unknown') return chat.language === null;
      return chat.language === filters.language;
    })
    .toSorted((a, b) => {
      const aSample = hasEnoughChatRankingData(a) ? 0 : 1;
      const bSample = hasEnoughChatRankingData(b) ? 0 : 1;
      return (
        aSample - bSample ||
        b.responseRate - a.responseRate ||
        b.responses - a.responses ||
        b.publications - a.publications ||
        a.name.localeCompare(b.name, 'uk')
      );
    });
}

export function hasEnoughChatRankingData(
  chat: Pick<AnalyticsRankedChat, 'publications'>,
) {
  return chat.publications >= CHAT_RANKING_MIN_PUBLICATIONS;
}

export function responseConversionLabel(
  chat: Pick<AnalyticsRankedChat, 'publications' | 'responseRate'>,
) {
  return chat.publications > 0 ? `${chat.responseRate}%` : '—';
}

export function chatLanguageLabel(language: AnalyticsRankedChat['language']) {
  if (language === 'uk') return 'Українська';
  if (language === 'ru') return 'Російська';
  return 'Не визначено';
}
