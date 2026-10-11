'use client';

import { useState } from 'react';
import { signOut } from '@/components/shell/topbar';
import { useShell } from '@/components/shell/shell-context';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/toggle';
import { useToast } from '@/components/ui/toast';
import { CsvPanel } from '@/components/views/platforms/csv-panel';
import { DuplicatesPanel } from '@/components/views/platforms/duplicates-panel';
import { NamesPanel } from '@/components/views/platforms/names-panel';
import { GoalsPanel } from '@/components/views/shared/goals-panel';
import { Panel } from '@/components/shell/panel';
import { APP_VERSION } from '@/lib/app-meta';
import { BackupButton } from './backup-button';
import { ExecutorCard } from './executor-card';
import { GoalHistoryPanel } from './goal-history-panel';
import { RestorePanel } from './restore-panel';
import { UpdatePreview } from './update-preview';
import { Group, Row } from './ui';

const PLATFORMS: ReadonlyArray<[string, string]> = [['telegram', 'Telegram'], ['whatsapp', 'WhatsApp'], ['viber', 'Viber'], ['facebook', 'Facebook']];

export function ProfileGroup() {
  const { user, signOutPath } = useShell();
  return (
    <Group id="profile" title="Профіль">
      <Row label={<span className="flex items-center gap-3"><Avatar name={user.displayName} size={40} /><span className="min-w-0"><span className="block truncate">{user.displayName}</span><span className="block truncate text-[13px] font-normal text-ink-2">{user.email}</span></span></span>} description="Приватний акаунт: один власник, один оператор.">
        <Button variant="outline" size="sm" onClick={() => signOut(signOutPath)}>Вийти</Button>
      </Row>
    </Group>
  );
}

export function GoalsGroup() {
  const { snapshot } = useShell();
  const [goalsOpen, setGoalsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  return (
    <Group id="goals" title="Цілі дня" aside={<Button variant="outline" size="sm" onClick={() => setGoalsOpen(true)}>Змінити</Button>}>
      <Row label="Ціль записів на день"><span className="font-mono text-[17px]">{snapshot.bookingGoal.target}</span></Row>
      <Row label="Ціль записів на місяць"><span className="font-mono text-[17px]">{snapshot.monthlyBookingGoal}</span></Row>
      <Row label="Напрямки фокусу" description={snapshot.focusDirections.length ? snapshot.focusDirections.join(' · ') : 'Напрямки ще не обрані.'} />
      <Row label="Історія цілей" description="Нова ціль діє від своєї дати й не переписує план минулих днів.">
        <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>Відкрити</Button>
      </Row>
      <GoalsPanel open={goalsOpen} onOpenChange={setGoalsOpen} />
      <GoalHistoryPanel open={historyOpen} onOpenChange={setHistoryOpen} />
    </Group>
  );
}

export function PlatformsGroup() {
  const { snapshot, refreshSnapshot } = useShell();
  const toast = useToast();
  const key = snapshot.enabledPlatforms.join('|');
  const [pending, setPending] = useState<{ base: string; value: string[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const enabled = pending && pending.base === key ? pending.value : snapshot.enabledPlatforms;

  const toggle = async (platform: string, on: boolean) => {
    if (saving) return;
    const next = on ? [...enabled, platform] : enabled.filter((item) => item !== platform);
    setPending({ base: key, value: next });
    setSaving(true);
    try {
      const response = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: { enabled_platforms: next } }) });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || 'Не вдалося зберегти платформи.');
      refreshSnapshot();
    } catch (reason) {
      setPending(null);
      toast.push({ message: reason instanceof Error ? reason.message : 'Не вдалося зберегти платформи.', tone: 'hot' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Group id="platforms" title="Платформи" note="Вимкнення лише ховає платформу з робочих екранів. Дані та статистика не видаляються.">
      {PLATFORMS.map(([platform, label]) => (
        <Row key={platform} label={label}>
          <Switch aria-label={`Показувати ${label}`} checked={enabled.includes(platform)} disabled={saving} onCheckedChange={(checked) => void toggle(platform, checked)} />
        </Row>
      ))}
    </Group>
  );
}

type ServicePanel = 'names' | 'duplicates' | 'csv' | 'executor' | null;

export function ServiceGroup() {
  const { refreshSnapshot, openRelease } = useShell();
  const [panel, setPanel] = useState<ServicePanel>(null);
  const [previewing, setPreviewing] = useState(false);
  const close = () => setPanel(null);
  return (
    <Group id="service" title="Сервіс" note="Рідкісні дії: вони не повинні відволікати під час щоденної роботи.">
      <Row label="Резервна копія" description="Переносна копія всіх даних одним файлом: чати, ліди, звіти, матеріали й історія."><BackupButton /></Row>
      <Row label="Перевірка назв чатів" description="Підтягує доступні назви Telegram, WhatsApp, Viber і Facebook; ручні назви без підтвердження не перезаписує.">
        <Button variant="outline" size="sm" onClick={() => setPanel('names')}>Перевірити</Button>
      </Row>
      <Row label="Дублікати" description="Точні URL і потенційні повтори за назвою.">
        <Button variant="outline" size="sm" onClick={() => setPanel('duplicates')}>Відкрити</Button>
      </Row>
      <Row label="Перенесення чатів" description="CSV переносить поточний стан чатів; повна історія зберігається у резервній копії.">
        <Button variant="outline" size="sm" onClick={() => setPanel('csv')}>CSV</Button>
      </Row>
      <Row label="Executor пошуку чатів" description="Підключення runner до авторизованого WhatsApp Web.">
        <Button variant="outline" size="sm" onClick={() => setPanel('executor')}>Налаштувати</Button>
      </Row>
      <Row label="Версія" description={`Work OS ${APP_VERSION}`}>
        <Button variant="outline" size="sm" onClick={openRelease}>Що змінилося</Button>
      </Row>
      <Row label="Тест екрана оновлення" description="На кілька секунд показує екран, що з’являється під час автооновлення. Сайт насправді не перезавантажується.">
        <Button variant="outline" size="sm" onClick={() => setPreviewing(true)}>Запустити тест</Button>
      </Row>
      <NamesPanel open={panel === 'names'} onClose={close} onChanged={refreshSnapshot} />
      <DuplicatesPanel open={panel === 'duplicates'} onClose={close} />
      <CsvPanel open={panel === 'csv'} onClose={close} onImported={refreshSnapshot} />
      <Panel open={panel === 'executor'} onOpenChange={(open) => { if (!open) close(); }} title="Executor пошуку чатів" subtitle="Підключення runner до WhatsApp Web">
        <ExecutorCard />
      </Panel>
      {previewing ? <UpdatePreview onClose={() => setPreviewing(false)} /> : null}
    </Group>
  );
}

export function DangerGroup() {
  const [open, setOpen] = useState(false);
  return (
    <Group id="danger" title="Небезпечні дії" tone="danger" note="Змінюють робочі дані. Кожна вимагає окремого підтвердження.">
      <Row label="Відновлення з резервної копії" description="Повертає лише відсутні записи з перевіреного файлу; наявні дані не змінюються. Потрібна свіжа контрольна копія й підтвердження.">
        <Button variant="outline" tone="danger" size="sm" onClick={() => setOpen(true)}>Відкрити</Button>
      </Row>
      <RestorePanel open={open} onOpenChange={setOpen} />
    </Group>
  );
}
