type RateTotals = {
  joined: number;
  publications: number;
  responses: number;
  bookings: number;
  completed: number;
  publicationRate: number;
  responseRate: number;
  bookingRate: number;
  completionRate: number;
};

type ActivityPlatform = RateTotals & { key: string; name: string };
type ActivityChat = {
  id: string;
  name: string;
  platformName: string;
  joined: number;
  publications: number;
  responses: number;
  bookings: number;
  publicationRate: number;
  responseRate: number;
  bookingRate: number;
};

type CohortTotals = {
  leads: number;
  bookedLeads: number;
  bookings: number;
  completed: number;
  bookingLeadRate: number;
  completionRate: number;
};

type CohortPlatform = CohortTotals & { key: string; name: string };
type CohortChat = CohortTotals & { id: string; name: string; platformName: string };

export type AnalyticsExportData = {
  range: { from: string; to: string; period: string };
  totals: RateTotals;
  platforms: ActivityPlatform[];
  chats: ActivityChat[];
  cohort: {
    totals: CohortTotals;
    platforms: CohortPlatform[];
    chats: CohortChat[];
  };
};

export function analyticsCsv(data: AnalyticsExportData): string {
  const rows: Array<Array<string | number>> = [
    ['view', 'level', 'name', 'platform', 'from', 'to', 'joined', 'publications', 'responses', 'leads', 'booked_leads', 'bookings', 'completed', 'publication_rate', 'response_rate', 'booking_rate', 'completion_rate'],
    ['activity', 'total', 'Усього', '', data.range.from, data.range.to, data.totals.joined, data.totals.publications, data.totals.responses, '', '', data.totals.bookings, data.totals.completed, data.totals.publicationRate, data.totals.responseRate, data.totals.bookingRate, data.totals.completionRate],
    ...data.platforms.map((row) => ['activity', 'platform', row.name, row.name, data.range.from, data.range.to, row.joined, row.publications, row.responses, '', '', row.bookings, row.completed, row.publicationRate, row.responseRate, row.bookingRate, row.completionRate]),
    ...data.chats.map((row) => ['activity', 'chat', row.name, row.platformName, data.range.from, data.range.to, row.joined, row.publications, row.responses, '', '', row.bookings, '', row.publicationRate, row.responseRate, row.bookingRate, '']),
    ['cohort', 'total', 'Усього', '', data.range.from, data.range.to, '', '', '', data.cohort.totals.leads, data.cohort.totals.bookedLeads, data.cohort.totals.bookings, data.cohort.totals.completed, '', '', data.cohort.totals.bookingLeadRate, data.cohort.totals.completionRate],
    ...data.cohort.platforms.map((row) => ['cohort', 'platform', row.name, row.name, data.range.from, data.range.to, '', '', '', row.leads, row.bookedLeads, row.bookings, row.completed, '', '', row.bookingLeadRate, row.completionRate]),
    ...data.cohort.chats.map((row) => ['cohort', 'chat', row.name, row.platformName, data.range.from, data.range.to, '', '', '', row.leads, row.bookedLeads, row.bookings, row.completed, '', '', row.bookingLeadRate, row.completionRate]),
  ];
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
