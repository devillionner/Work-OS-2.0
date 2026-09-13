'use client';

import { useState } from 'react';
import { Cloud, DatabaseBackup, ShieldCheck, Target, CopyCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CloudBackupButton } from '@/components/cloud-backup-button';
import { CloudRestoreDialog } from '@/components/cloud-restore-dialog';
import { TodaySettingsDialog } from '@/components/today-settings-dialog';
import { ChatDuplicatesDialog } from '@/components/chat-duplicates-dialog';
import type { DashboardSnapshot } from '@/lib/dashboard';

export function SettingsWorkspace({ user, snapshot, onRefresh }: { user: { displayName: string; email: string }; snapshot: DashboardSnapshot; onRefresh: () => void }) {
  const [focusOpen, setFocusOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const [enabledPlatforms, setEnabledPlatforms] = useState(snapshot.enabledPlatforms);
  const [savingPlatforms, setSavingPlatforms] = useState(false);
  const [platformNotice, setPlatformNotice] = useState('');
  async function savePlatforms() { setSavingPlatforms(true); setPlatformNotice(''); try { const response = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: { enabled_platforms: enabledPlatforms } }) }); const body = await response.json() as { error?: string }; if (!response.ok) throw new Error(body.error || 'Не вдалося зберегти платформи.'); setPlatformNotice('Збережено'); onRefresh(); } catch (reason) { setPlatformNotice(reason instanceof Error ? reason.message : 'Не вдалося зберегти платформи.'); } finally { setSavingPlatforms(false); } }
  return <div className="settings-workspace">
    <section className="settings-hero"><div><p className="eyebrow">Приватний робочий простір</p><h2>Налаштування</h2><p>Керуй фокусом, цілями та копією даних з одного місця.</p></div><Badge variant="secondary"><ShieldCheck data-icon="inline-start" />Захищено Google-входом</Badge></section>
    <div className="settings-grid">
      <section className="settings-panel"><div className="settings-panel-icon"><Target /></div><div className="card-heading"><div><p className="eyebrow">Робочий фокус</p><h3>Напрямки та цілі</h3></div><Button variant="outline" size="sm" onClick={() => setFocusOpen(true)}>Змінити</Button></div><div className="settings-stat-row"><div><span>На день</span><strong>{snapshot.bookingGoal.target}</strong><small>записів</small></div><div><span>На місяць</span><strong>{snapshot.monthlyBookingGoal}</strong><small>записів</small></div></div><div className="settings-direction-list">{snapshot.focusDirections.length ? snapshot.focusDirections.map((direction) => <Badge variant="outline" key={direction}>{direction}</Badge>) : <span className="muted-note">Напрямки ще не обрані.</span>}</div></section>
      <section className="settings-panel"><div className="settings-panel-icon"><DatabaseBackup /></div><div className="card-heading"><div><p className="eyebrow">Надійність</p><h3>Резервні копії</h3></div><Cloud /></div><p className="settings-panel-copy">Створи повну переносну копію або перевір існуючу перед контрольованим відновленням.</p><div className="settings-backup-actions"><CloudBackupButton /><Button variant="outline" size="sm" type="button" onClick={() => setRestoreOpen(true)}>Перевірити копію</Button></div></section>
      <section className="settings-panel"><div className="settings-panel-icon"><Cloud /></div><div className="card-heading"><div><p className="eyebrow">Робочі модулі</p><h3>Активні платформи</h3></div><Button size="sm" onClick={() => void savePlatforms()} disabled={savingPlatforms}>{savingPlatforms ? 'Зберігаємо…' : 'Зберегти'}</Button></div><div className="platform-settings-list">{[['telegram','Telegram'],['whatsapp','WhatsApp'],['viber','Viber'],['facebook','Facebook']].map(([key,label]) => <label key={key}><input type="checkbox" checked={enabledPlatforms.includes(key)} onChange={(event) => setEnabledPlatforms((current) => event.target.checked ? [...current, key] : current.filter((item) => item !== key))} />{label}</label>)}</div>{platformNotice && <small className="settings-inline-notice" role="status">{platformNotice}</small>}<p className="settings-panel-copy">Вимкнення ховає платформу з головного екрана, постингу й нових таймерів, але не видаляє її чати чи статистику.</p></section>
      <section className="settings-panel"><div className="settings-panel-icon"><CopyCheck /></div><div className="card-heading"><div><p className="eyebrow">Якість бази чатів</p><h3>Дублікати</h3></div><Button variant="outline" size="sm" onClick={() => setDuplicatesOpen(true)}>Перевірити</Button></div><p className="settings-panel-copy">Знайди точні повтори посилань і однакові назви з різними URL. Рішення завжди лишається ручним: відкрий чат, виправ назву або перенеси активний запис в архів як дублікат.</p></section>
      <section className="settings-panel settings-account"><div className="settings-panel-icon"><ShieldCheck /></div><div><p className="eyebrow">Обліковий запис</p><h3>{user.displayName}</h3><p>{user.email}</p><small>Дані ізольовані за твоїм акаунтом і доступні після входу з будь-якого пристрою.</small></div></section>
    </div>
    <TodaySettingsDialog open={focusOpen} onClose={() => setFocusOpen(false)} initialDirections={snapshot.focusDirections} initialDailyGoal={snapshot.bookingGoal.target} initialMonthlyGoal={snapshot.monthlyBookingGoal} onSaved={onRefresh} />
    <CloudRestoreDialog open={restoreOpen} onClose={() => setRestoreOpen(false)} />
    <ChatDuplicatesDialog open={duplicatesOpen} onClose={() => setDuplicatesOpen(false)} />
  </div>;
}
