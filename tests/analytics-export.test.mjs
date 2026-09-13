import assert from 'node:assert/strict';
import test from 'node:test';
import { analyticsCsv } from '../lib/analytics-export.ts';

void test('analytics CSV exports activity and cohort rows with spreadsheet-safe quoting', () => {
  const csv = analyticsCsv({
    range: { from: '2026-09-01', to: '2026-09-13', period: 'month' },
    totals: { joined: 5, publications: 4, responses: 2, bookings: 2, completed: 1, publicationRate: 80, responseRate: 50, bookingRate: 100, completionRate: 50 },
    platforms: [{ key: 'telegram', name: 'Telegram', joined: 5, publications: 4, responses: 2, bookings: 2, completed: 1, publicationRate: 80, responseRate: 50, bookingRate: 100, completionRate: 50 }],
    chats: [{ id: 'chat', name: 'Чат, "Київ"', platformName: 'Telegram', joined: 5, publications: 4, responses: 2, bookings: 2, publicationRate: 80, responseRate: 50, bookingRate: 100 }],
    cohort: {
      totals: { leads: 2, bookedLeads: 1, bookings: 2, completed: 1, bookingLeadRate: 50, completionRate: 50 },
      platforms: [{ key: 'telegram', name: 'Telegram', leads: 2, bookedLeads: 1, bookings: 2, completed: 1, bookingLeadRate: 50, completionRate: 50 }],
      chats: [{ id: 'chat', name: 'Чат, "Київ"', platformName: 'Telegram', leads: 2, bookedLeads: 1, bookings: 2, completed: 1, bookingLeadRate: 50, completionRate: 50 }],
    },
  });
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.match(csv, /activity,total/);
  assert.match(csv, /cohort,total/);
  assert.match(csv, /"Чат, ""Київ"""/);
  assert.ok(csv.endsWith('\r\n'));
});
