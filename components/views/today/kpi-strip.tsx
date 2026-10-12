'use client';

import { CalendarCheck, MessagesSquare, Reply, Send } from 'lucide-react';
import { useShell } from '@/components/shell/shell-context';
import { Tile } from '@/components/ui/tile';
import { goalRatio, toneFor } from '@/components/views/shared/pace';

/** KPI-стрічка: публікації, нові чати, відгуки й записи за сьогодні; прогрес лише там, де є ціль. */
export function KpiStrip() {
  const { snapshot, navigate } = useShell();
  const totals = snapshot.platforms.reduce(
    (sum, platform) => ({ publications: sum.publications + platform.publications, joined: sum.joined + platform.joined, responses: sum.responses + platform.responses, bookings: sum.bookings + platform.bookings }),
    { publications: 0, joined: 0, responses: 0, bookings: 0 },
  );
  const publication = snapshot.publicationGoal;
  const booking = snapshot.bookingGoal;
  const chatGoal = snapshot.chatGoal;
  const responseGoal = snapshot.responseGoal;
  return (
    <section aria-label="Результат сьогодні" className="grid grid-cols-2 gap-3 @4xl:grid-cols-4">
      <Tile
        label="Публікації"
        value={totals.publications}
        icon={Send}
        hint={publication.target > 0 ? `ціль ${publication.target}` : undefined}
        progress={publication.target > 0 ? { value: goalRatio(totals.publications, publication.target), tone: toneFor(totals.publications, publication.target) } : undefined}
        onClick={() => navigate('platforms')}
      />
      <Tile
        label="Нові чати"
        value={totals.joined}
        icon={MessagesSquare}
        hint={chatGoal.target > 0 ? `ціль ${chatGoal.target}` : undefined}
        progress={chatGoal.target > 0 ? { value: goalRatio(totals.joined, chatGoal.target), tone: toneFor(totals.joined, chatGoal.target) } : undefined}
        onClick={() => navigate('platforms')}
      />
      <Tile
        label="Відгуки"
        value={totals.responses}
        icon={Reply}
        hint={responseGoal.target > 0 ? `ціль ${responseGoal.target}` : undefined}
        progress={responseGoal.target > 0 ? { value: goalRatio(totals.responses, responseGoal.target), tone: toneFor(totals.responses, responseGoal.target) } : undefined}
        onClick={() => navigate('leads')}
      />
      <Tile
        label="Записи"
        value={totals.bookings}
        icon={CalendarCheck}
        hint={booking.target > 0 ? `ціль ${booking.target} · місяць ${snapshot.monthlyBookingGoal}` : undefined}
        progress={booking.target > 0 ? { value: goalRatio(totals.bookings, booking.target), tone: toneFor(totals.bookings, booking.target) } : undefined}
        onClick={() => navigate('analytics')}
      />
    </section>
  );
}
