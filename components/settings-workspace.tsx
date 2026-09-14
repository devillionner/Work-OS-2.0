'use client';

import { useState } from 'react';
import { Cloud, CopyCheck, DatabaseBackup, FileSpreadsheet, ShieldCheck, Target } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CloudBackupButton } from '@/components/cloud-backup-button';
import { CloudRestoreDialog } from '@/components/cloud-restore-dialog';
import { TodaySettingsDialog } from '@/components/today-settings-dialog';
import { ChatDuplicatesDialog } from '@/components/chat-duplicates-dialog';
import { ChatCsvDialog } from '@/components/chat-csv-dialog';
import type { DashboardSnapshot } from '@/lib/dashboard';

type Props = {
  user: { displayName: string; email: string };
  snapshot: DashboardSnapshot;
  onRefresh: () => void;
};

export function SettingsWorkspace({ user, snapshot, onRefresh }: Props) {
  const [focusOpen, setFocusOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [enabledPlatforms, setEnabledPlatforms] = useState(snapshot.enabledPlatforms);
  const [savingPlatforms, setSavingPlatforms] = useState(false);
  const [platformNotice, setPlatformNotice] = useState('');

  async function savePlatforms() {
    setSavingPlatforms(true); setPlatformNotice('');
    try {
      const response = await fetch('/api/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { enabled_platforms: enabledPlatforms } }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || 'Не вдалося зберегти платформи.');
      setPlatformNotice('Збережено'); onRefresh();
    } catch (reason) {
      setPlatformNotice(reason instanceof Error ? reason.message : 'Не вдалося зберегти платформи.');
    } finally { setSavingPlatforms(false); }
  }

  return <div className="settings-workspace">
    <section className="settings-hero">
      <div><p className="eyebrow">Робочий простір</p><h2>Налаштування</h2><p>Тут лише те, що змінює щоденну роботу або захищає дані.</p></div>
      <Badge variant="secondary"><ShieldCheck data-icon="inline-start" />Приватний акаунт</Badge>
    </section>

    <div className="settings-primary-grid">
      <section className="settings-panel settings-panel-primary">
        <div className="settings-panel-icon"><Target /></div>
        <div className="card-heading"><div><p className="eyebrow">Цілі та фокус</p><h3>Що важливо зараз</h3></div><Button variant="outline" size="sm" onClick={() => setFocusOpen(true)}>Змінити</Button></div>
        <div className="settings-stat-row"><div><span>На день</span><strong>{snapshot.bookingGoal.target}</strong><small>записів</small></div><div><span>На місяць</span><strong>{snapshot.monthlyBookingGoal}</strong><small>записів</small></div></div>
        <div className="settings-direction-list">{snapshot.focusDirections.length ? snapshot.focusDirections.map((direction) => <Badge variant="outline" key={direction}>{direction}</Badge>) : <span className="muted-note">Напрямки ще не обрані.</span>}</div>
      </section>

      <section className="settings-panel settings-panel-primary">
        <div className="settings-panel-icon"><Cloud /></div>
        <div className="card-heading"><div><p className="eyebrow">Активні платформи</p><h3>Що показувати в роботі</h3></div><Button size="sm" onClick={() => void savePlatforms()} disabled={savingPlatforms}>{savingPlatforms ? 'Зберігаємо…' : 'Зберегти'}</Button></div>
        <div className="platform-settings-list">{[['telegram','Telegram'],['whatsapp','WhatsApp'],['viber','Viber'],['facebook','Facebook']].map(([key,label]) => <label key={key}><input type="checkbox" checked={enabledPlatforms.includes(key)} onChange={(event) => setEnabledPlatforms((current) => event.target.checked ? [...current, key] : current.filter((item) => item !== key))} />{label}</label>)}</div>
        {platformNotice && <small className="settings-inline-notice" role="status">{platformNotice}</small>}
        <p className="settings-panel-copy">Вимкнення лише ховає платформу з робочих екранів. Дані та статистика не видаляються.</p>
      </section>
    </div>

    <section className="settings-tools" aria-labelledby="settings-tools-title">
      <div className="settings-section-head"><div><p className="eyebrow">Дані та обслуговування</p><h3 id="settings-tools-title">Рідкісні дії</h3></div><p>Вони не повинні відволікати під час щоденної роботи.</p></div>
      <div className="settings-tool-list">
        <div className="settings-tool-row"><span className="settings-tool-icon"><DatabaseBackup /></span><div><strong>Резервна копія</strong><p>Створи переносну копію або перевір файл перед відновленням.</p></div><div className="settings-tool-actions"><CloudBackupButton /><Button variant="outline" size="sm" type="button" onClick={() => setRestoreOpen(true)}>Перевірити</Button></div></div>
        <div className="settings-tool-row"><span className="settings-tool-icon"><CopyCheck /></span><div><strong>Перевірити дублікати</strong><p>Точні URL і потенційні повтори за назвою відкриваються в окремому вікні.</p></div><Button variant="outline" size="sm" onClick={() => setDuplicatesOpen(true)}>Відкрити</Button></div>
        <div className="settings-tool-row"><span className="settings-tool-icon"><FileSpreadsheet /></span><div><strong>Перенесення чатів</strong><p>CSV переносить поточний стан чатів; повна історія зберігається у резервній копії.</p></div><Button variant="outline" size="sm" onClick={() => setCsvOpen(true)}>CSV</Button></div>
      </div>
    </section>

    <section className="settings-account-row"><ShieldCheck /><div><span>Обліковий запис</span><strong>{user.displayName}</strong><small>{user.email}</small></div></section>

    <TodaySettingsDialog open={focusOpen} onClose={() => setFocusOpen(false)} initialDirections={snapshot.focusDirections} initialDailyGoal={snapshot.bookingGoal.target} initialMonthlyGoal={snapshot.monthlyBookingGoal} onSaved={onRefresh} />
    <CloudRestoreDialog open={restoreOpen} onClose={() => setRestoreOpen(false)} />
    <ChatDuplicatesDialog open={duplicatesOpen} onClose={() => setDuplicatesOpen(false)} />
    <ChatCsvDialog open={csvOpen} onClose={() => setCsvOpen(false)} onImported={onRefresh} />
  </div>;
}
