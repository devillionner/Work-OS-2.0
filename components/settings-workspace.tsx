'use client';

import { useState } from 'react';
import { Cloud, DatabaseBackup, ShieldCheck, Target } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CloudBackupButton } from '@/components/cloud-backup-button';
import { TodaySettingsDialog } from '@/components/today-settings-dialog';
import type { DashboardSnapshot } from '@/lib/dashboard';

export function SettingsWorkspace({ user, snapshot, onRefresh }: { user: { displayName: string; email: string }; snapshot: DashboardSnapshot; onRefresh: () => void }) {
  const [focusOpen, setFocusOpen] = useState(false);
  return <div className="settings-workspace">
    <section className="settings-hero"><div><p className="eyebrow">Приватний робочий простір</p><h2>Налаштування</h2><p>Керуй фокусом, цілями та копією даних з одного місця.</p></div><Badge variant="secondary"><ShieldCheck data-icon="inline-start" />Захищено Google-входом</Badge></section>
    <div className="settings-grid">
      <section className="settings-panel"><div className="settings-panel-icon"><Target /></div><div className="card-heading"><div><p className="eyebrow">Робочий фокус</p><h3>Напрямки та цілі</h3></div><Button variant="outline" size="sm" onClick={() => setFocusOpen(true)}>Змінити</Button></div><div className="settings-stat-row"><div><span>На день</span><strong>{snapshot.bookingGoal.target}</strong><small>записів</small></div><div><span>На місяць</span><strong>{snapshot.monthlyBookingGoal}</strong><small>записів</small></div></div><div className="settings-direction-list">{snapshot.focusDirections.length ? snapshot.focusDirections.map((direction) => <Badge variant="outline" key={direction}>{direction}</Badge>) : <span className="muted-note">Напрямки ще не обрані.</span>}</div></section>
      <section className="settings-panel"><div className="settings-panel-icon"><DatabaseBackup /></div><div className="card-heading"><div><p className="eyebrow">Надійність</p><h3>Резервна копія</h3></div><Cloud /></div><p className="settings-panel-copy">Копія формується з усіх даних твого профілю та перевіряється перед завантаженням.</p><CloudBackupButton /></section>
      <section className="settings-panel settings-account"><div className="settings-panel-icon"><ShieldCheck /></div><div><p className="eyebrow">Обліковий запис</p><h3>{user.displayName}</h3><p>{user.email}</p><small>Дані ізольовані за твоїм акаунтом і доступні після входу з будь-якого пристрою.</small></div></section>
    </div>
    <TodaySettingsDialog open={focusOpen} onClose={() => setFocusOpen(false)} initialDirections={snapshot.focusDirections} initialDailyGoal={snapshot.bookingGoal.target} initialMonthlyGoal={snapshot.monthlyBookingGoal} onSaved={onRefresh} />
  </div>;
}
