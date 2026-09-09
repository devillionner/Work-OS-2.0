'use client';

import { useState } from 'react';
import {
  Archive, BarChart3, BookOpenText, ChevronLeft, ChevronRight,
  CircleUserRound, FileText, LayoutDashboard, Menu, MessageSquareText,
  Settings, Target, UsersRound, X,
} from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress, ProgressLabel, ProgressValue } from '@/components/ui/progress';
import { LegacyImportDialog } from '@/components/legacy-import-dialog';
import { CloudBackupButton } from '@/components/cloud-backup-button';
import { PlatformWorkspace } from '@/components/platform-workspace';
import { LeadsWorkspace } from '@/components/leads/workspace';
import { AnalyticsWorkspace } from '@/components/analytics-workspace';
import { ReportsWorkspace } from '@/components/reports-workspace';
import { LibraryWorkspace } from '@/components/library-workspace';
import { TodaySettingsDialog } from '@/components/today-settings-dialog';
import { GlobalTimers } from '@/components/global-timers';
import { useRouter } from 'next/navigation';
import type { DashboardSnapshot } from '@/lib/dashboard';

type WorkOsShellProps = {
  user: { displayName: string; email: string };
  signOutPath: string;
  snapshot: DashboardSnapshot;
};

const navigation = [
  { key: 'today', label: 'Сьогодні', icon: LayoutDashboard },
  { key: 'platforms', label: 'Платформи', icon: MessageSquareText },
  { key: 'leads', label: 'Ліди', icon: UsersRound },
  { key: 'analytics', label: 'Аналітика', icon: BarChart3 },
  { key: 'reports', label: 'Звіти', icon: FileText },
  { key: 'library', label: 'Бібліотека', icon: BookOpenText },
] as const;

export function WorkOsShell({ user, signOutPath, snapshot }: WorkOsShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [todaySettingsOpen, setTodaySettingsOpen] = useState(false);
  const router = useRouter();
  const [activeView, setActiveView] = useState<(typeof navigation)[number]['key']>('today');
  const activeLabel = navigation.find((item) => item.key === activeView)?.label || 'Сьогодні';

  return (
    <div className={`work-layout ${collapsed ? 'is-collapsed' : ''}`}>
      <aside className={`work-sidebar ${mobileOpen ? 'is-open' : ''}`} aria-label="Основна навігація">
        <div className="sidebar-head">
          <div className="brand-lockup">
            <span className="brand-mark" aria-hidden="true">W</span>
            {!collapsed && <strong>Work OS</strong>}
          </div>
          <button className="sidebar-close-mobile" type="button" aria-label="Закрити меню" onClick={() => setMobileOpen(false)}><X /></button>
        </div>

        <nav className="sidebar-nav">
          {navigation.map(({ key, label, icon: Icon }) => (
            <button type="button" className="nav-item" aria-current={activeView === key ? 'page' : undefined} title={collapsed ? label : undefined} key={key} onClick={() => { setActiveView(key); setMobileOpen(false); }}>
              <Icon />
              {!collapsed && <span>{label}</span>}
              {label === 'Ліди' && !collapsed && <span className="nav-count">{snapshot.leads}</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <button className="nav-item" type="button" title={collapsed ? 'Налаштування' : undefined}>
            <Settings />{!collapsed && <span>Налаштування</span>}
          </button>
          <button className="collapse-button" type="button" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? 'Розгорнути меню' : 'Згорнути меню'}>
            {collapsed ? <ChevronRight /> : <ChevronLeft />}{!collapsed && <span>Згорнути меню</span>}
          </button>
        </div>
      </aside>

      {mobileOpen && <button className="sidebar-scrim" aria-label="Закрити меню" onClick={() => setMobileOpen(false)} />}

      <main className="work-main">
        <header className="topbar">
          <button className="mobile-menu" type="button" aria-label="Відкрити меню" onClick={() => setMobileOpen(true)}><Menu /></button>
          <div><p className="eyebrow">{todayLabel()}</p><h1>{activeLabel}</h1></div>
          <div className="account-block">
            <GlobalTimers />
            <div className="account-copy"><strong>{user.displayName}</strong><span>{user.email}</span></div>
            <Avatar><AvatarFallback>{initials(user.displayName)}</AvatarFallback></Avatar>
            <form method="post" action={signOutPath}>
              <button className="account-link" type="submit">Вийти</button>
            </form>
          </div>
        </header>

        {activeView === 'today' ? <div className="dashboard-grid">
          <section className="focus-card" aria-labelledby="focus-title">
            <div className="focus-heading">
              <div><p className="eyebrow">Фокус дня</p><h2 id="focus-title">Дані на місці. Будуємо швидкий робочий процес</h2><p>{snapshot.chats} активних чатів і {snapshot.leads} лідів уже доступні у хмарній базі.</p>{snapshot.focusDirections.length ? <div className="focus-direction-list">{snapshot.focusDirections.map((direction) => <Badge variant="secondary" key={direction}>{direction}</Badge>)}</div> : <p className="focus-empty-note">Фокус напрямків ще не налаштований.</p>}</div>
              <Badge variant="outline">{snapshot.lastPrototypeSync ? `Оновлено ${formatSyncTime(snapshot.lastPrototypeSync.completedAt)}` : 'Безпечний старт'}</Badge>
            </div>
            <div className="focus-actions">
              <Button size="lg" onClick={() => setImportOpen(true)}><Archive data-icon="inline-start" />Оновити з Prototype Checker</Button>
              <Button size="lg" variant="outline" onClick={() => setTodaySettingsOpen(true)}><Target data-icon="inline-start" />Налаштувати ціль</Button>
            </div>
          </section>

          <section className="goal-card" aria-labelledby="goal-title">
            <div className="card-heading"><div><p className="eyebrow">Ціль на день</p><h2 id="goal-title">Записи</h2><p className="goal-month-note">Місячна ціль: {snapshot.monthlyBookingGoal}</p></div>{snapshot.reportSubmittedAt ? <Badge variant="secondary">Звіт зафіксовано</Badge> : <button className="text-action" type="button" onClick={() => setTodaySettingsOpen(true)}>Змінити</button>}</div>
            <Progress value={Math.min(100, snapshot.bookingGoal.completed / Math.max(1, snapshot.bookingGoal.target) * 100)} className="goal-progress"><ProgressLabel>Виконано</ProgressLabel><ProgressValue>{() => `${snapshot.bookingGoal.completed} із ${snapshot.bookingGoal.target}`}</ProgressValue></Progress>
            <p className="muted-note">{snapshot.pendingAfterReport ? `Після звіту з’явилося ${snapshot.pendingAfterReport} нових подій — звіт потребує оновлення.` : snapshot.reportSubmittedAt ? 'Показники відповідають останньому зданому звіту.' : 'Показники рахуються з робочих подій у реальному часі.'}</p>
          </section>

          <section className="queue-card" aria-labelledby="queue-title">
            <div className="card-heading"><div><p className="eyebrow">Наступні дії</p><h2 id="queue-title">Робоча черга</h2></div><Badge variant="secondary">3 кроки</Badge></div>
            <ol className="action-list">
              <li><span className="action-index">1</span><div><strong>Створити контрольну копію</strong><p>Зберегти незалежну копію вже перенесеної хмарної бази.</p></div><Badge variant="outline">Рекомендовано</Badge></li>
              <li><span className="action-index">2</span><div><strong>Відкрити робочі платформи</strong><p>Повернути швидкий постинг у новому уніфікованому інтерфейсі.</p></div><Badge variant="outline">Наступне</Badge></li>
              <li><span className="action-index">3</span><div><strong>Перевірити аналітику</strong><p>Звірити конверсії з перенесеної історії подій.</p></div><Badge variant="outline">Після платформ</Badge></li>
            </ol>
          </section>

          <section className="platform-card" aria-labelledby="platform-title">
            <div className="card-heading"><div><p className="eyebrow">Платформи</p><h2 id="platform-title">Результат сьогодні</h2></div><Button variant="ghost" size="sm">Відкрити всі</Button></div>
            <div className="platform-table">
              <div className="platform-table-head"><span>Платформа</span><span>Публікації</span><span>Нові чати</span><span>Відгуки</span><span>Записи</span></div>
              {snapshot.platforms.map((platform) => <div className="platform-row" key={platform.key}><span className="platform-name"><i style={{ background: platform.color }} />{platform.name}</span><strong>{platform.publications}</strong><strong>{platform.joined}</strong><strong>{platform.responses}</strong><strong>{platform.bookings}</strong></div>)}
            </div>
          </section>

          <section className="status-card" aria-labelledby="status-title">
            <div className="status-icon"><CircleUserRound /></div>
            <div><p className="eyebrow">Доступ</p><h2 id="status-title">Хмарний профіль активний</h2><p>Цей екран доступний із будь-якого пристрою після входу.</p></div>
            <CloudBackupButton />
          </section>
        </div> : activeView === 'platforms' ? <PlatformWorkspace /> : activeView === 'leads' ? <LeadsWorkspace key={user.email} account={user.email} /> : activeView === 'analytics' ? <AnalyticsWorkspace /> : activeView === 'reports' ? <ReportsWorkspace /> : activeView === 'library' ? <LibraryWorkspace /> : <div className="coming-soon"><p className="eyebrow">Наступний модуль</p><h2>{activeLabel}</h2><p>Дані вже в хмарі. Цей екран буде підключено після завершення основного процесу платформ.</p></div>}

        <nav className="mobile-bottom-nav" aria-label="Мобільна навігація">
          {navigation.slice(0, 4).map(({ key, label, icon: Icon }) => <button type="button" aria-current={activeView === key ? 'page' : undefined} key={key} onClick={() => setActiveView(key)}><Icon /><span>{label}</span></button>)}
        </nav>
        <LegacyImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
        <TodaySettingsDialog open={todaySettingsOpen} onClose={() => setTodaySettingsOpen(false)} initialDirections={snapshot.focusDirections} initialDailyGoal={snapshot.bookingGoal.target} initialMonthlyGoal={snapshot.monthlyBookingGoal} onSaved={() => router.refresh()} />
      </main>
    </div>
  );
}

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : value.slice(0, 2)).toUpperCase();
}

function todayLabel() {
  const value = new Intl.DateTimeFormat('uk-UA', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Europe/Kyiv',
  }).format(new Date());

  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatSyncTime(value:number) {
  return new Intl.DateTimeFormat('uk-UA',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Kyiv'}).format(new Date(value*1000));
}

