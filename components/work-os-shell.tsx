'use client';

import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  BarChart3, BookOpenText, ChevronLeft, ChevronRight,
  FileText, LayoutDashboard, Menu, MessageSquareText,
  Settings, Target, UsersRound, X,
} from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress, ProgressLabel, ProgressValue } from '@/components/ui/progress';


import { PlatformWorkspace } from '@/components/platform-workspace';
import { LeadsWorkspace } from '@/components/leads/workspace';
import { AnalyticsWorkspace } from '@/components/analytics-workspace';
import { ReportsWorkspace } from '@/components/reports-workspace';
import { LibraryWorkspace } from '@/components/library-workspace';
import { TodaySettingsDialog } from '@/components/today-settings-dialog';
import { SettingsWorkspace } from '@/components/settings-workspace';
import { GlobalTimers } from '@/components/global-timers';
import { AppReleaseDialog } from '@/components/app-release-dialog';
import { WorkdayCard } from '@/components/workday-card';
import { createBrowserCommandClient } from '@/components/leads/client';
import { APP_VERSION } from '@/lib/app-meta';
import { useRouter } from 'next/navigation';
import type { DashboardSnapshot } from '@/lib/dashboard';

type WorkOsShellProps = {
  user: { displayName: string; email: string };
  signOutPath: string;
  snapshot: DashboardSnapshot;
  syncRevision: number;
};

const navigation = [
  { key: 'today', label: 'Сьогодні', icon: LayoutDashboard },
  { key: 'platforms', label: 'Платформи', icon: MessageSquareText },
  { key: 'leads', label: 'Ліди', icon: UsersRound },
  { key: 'analytics', label: 'Аналітика', icon: BarChart3 },
  { key: 'reports', label: 'Звіти', icon: FileText },
  { key: 'library', label: 'Бібліотека', icon: BookOpenText },
] as const;

type ViewKey = (typeof navigation)[number]['key'] | 'settings';

export function WorkOsShell({ user, signOutPath, snapshot, syncRevision }: WorkOsShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileCloseRef = useRef<HTMLButtonElement>(null);
  const mobileDrawerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const pageHeadingRef = useRef<HTMLHeadingElement>(null);

  const [todaySettingsOpen, setTodaySettingsOpen] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [leadToOpen, setLeadToOpen] = useState<string | null>(null);
  const router = useRouter();
  const [todayCommand] = useState(() => createBrowserCommandClient(`${user.email}:today-reminders`));
  const [taskBusy, setTaskBusy] = useState<string | null>(null);
  const [taskNotice, setTaskNotice] = useState('');
  const [activeView, setActiveView] = useState<ViewKey>('today');
  const [visitedViews, setVisitedViews] = useState<Set<ViewKey>>(() => new Set<ViewKey>(['today']));
  useEffect(() => {
    if (!mobileOpen) return;
    const frame = requestAnimationFrame(() => mobileCloseRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMobileOpen(false);
      const trigger = mobileDrawerTriggerRef.current;
      requestAnimationFrame(() => trigger?.focus());
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [mobileOpen]);
  const openMobileMenu = (trigger: HTMLButtonElement) => {
    mobileDrawerTriggerRef.current = trigger;
    setMobileOpen(true);
  };
  const closeMobileMenu = () => {
    setMobileOpen(false);
    const trigger = mobileDrawerTriggerRef.current;
    requestAnimationFrame(() => trigger?.focus());
  };
  const activeLabel = activeView === 'settings' ? 'Налаштування' : navigation.find((item) => item.key === activeView)?.label || 'Сьогодні';
  const navigateTo = (next: ViewKey) => {
    const fromDrawer = mobileOpen;
    setVisitedViews((current) => current.has(next) ? current : new Set(current).add(next));
    setActiveView(next);
    setMobileOpen(false);
    if (fromDrawer) requestAnimationFrame(() => pageHeadingRef.current?.focus());
    if (next === 'today' && activeView !== 'today') router.refresh();
  };

  const orderedLeadTasks = [...snapshot.leadTasks].sort((a, b) => {
    const sectionOrder = taskSectionRank(a, snapshot.today) - taskSectionRank(b, snapshot.today);
    return sectionOrder || a.dueAt - b.dueAt || a.leadId.localeCompare(b.leadId);
  });

  const copyReminder = async (item: DashboardSnapshot['leadTasks'][number]) => {
    if (!item.reminderText) return;
    try { await navigator.clipboard.writeText(item.reminderText); setTaskNotice('Текст нагадування скопійовано.'); }
    catch { setTaskNotice('Не вдалося скопіювати текст.'); }
  };
  const markReminderSent = async (item: DashboardSnapshot['leadTasks'][number]) => {
    if (!item.reminderId || item.leadVersion === null) return;
    setTaskBusy(item.reminderId); setTaskNotice('');
    try {
      await todayCommand('reminder_mark', { state: 'sent' }, { id: item.leadId, version: item.leadVersion }, item.reminderId);
      setTaskNotice('Нагадування позначено як надіслане.'); router.refresh();
    } catch (error) { setTaskNotice(error instanceof Error ? error.message : 'Не вдалося оновити нагадування.'); }
    finally { setTaskBusy(null); }
  };

  return (
    <div className={`work-layout ${collapsed ? 'is-collapsed' : ''}`}>
      <aside className={`work-sidebar ${mobileOpen ? 'is-open' : ''}`} aria-label="Основна навігація">
        <div className="sidebar-head">
          <div className="brand-lockup">
            <span className="brand-mark" aria-hidden="true">W</span>
            {!collapsed && <strong>Work OS</strong>}
          </div>
          <button ref={mobileCloseRef} className="sidebar-close-mobile" type="button" aria-label="Закрити меню" onClick={closeMobileMenu}><X /></button>
        </div>

        <nav className="sidebar-nav">
          {navigation.map(({ key, label, icon: Icon }) => (
            <button type="button" className="nav-item" aria-current={activeView === key ? 'page' : undefined} title={collapsed ? label : undefined} key={key} onClick={() => navigateTo(key)}>
              <Icon />
              {!collapsed && <span>{label}</span>}
              {label === 'Ліди' && !collapsed && <span className="nav-count">{snapshot.leads}</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <button className="nav-item" type="button" title={collapsed ? 'Налаштування' : undefined} aria-current={activeView === 'settings' ? 'page' : undefined} onClick={() => navigateTo('settings')}>
            <Settings />{!collapsed && <span>Налаштування</span>}
          </button>
          {!collapsed && <button className="sidebar-release" type="button" onClick={() => setReleaseOpen(true)}><span>Work OS</span><strong>v{APP_VERSION}</strong><small>Що змінилося</small></button>}
          <button className="collapse-button" type="button" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? 'Розгорнути меню' : 'Згорнути меню'}>
            {collapsed ? <ChevronRight /> : <ChevronLeft />}{!collapsed && <span>Згорнути меню</span>}
          </button>
        </div>
      </aside>

      {mobileOpen && <button type="button" className="sidebar-scrim" aria-label="Закрити меню" onClick={closeMobileMenu} />}

      <main className="work-main" inert={mobileOpen ? true : undefined}>
        <header className="topbar">
          <button className="mobile-menu" type="button" aria-label="Відкрити меню" onClick={(event) => openMobileMenu(event.currentTarget)}><Menu /></button>
          <div><p className="eyebrow">{todayLabel()}</p><h1 ref={pageHeadingRef} tabIndex={-1}>{activeLabel}</h1></div>
          <div className="account-block">
            <GlobalTimers key={`timers:${syncRevision}`} enabledPlatforms={snapshot.enabledPlatforms} viewKey={activeView} />
            <div className="account-copy"><strong>{user.displayName}</strong><span>{user.email}</span></div>
            <Avatar><AvatarFallback>{initials(user.displayName)}</AvatarFallback></Avatar>
            <form method="post" action={signOutPath}>
              <button className="account-link" type="submit">Вийти</button>
            </form>
          </div>
        </header>

        <WorkspacePane active={activeView === 'today'}><div className="dashboard-grid">
          <section className="focus-card" aria-labelledby="focus-title">
            <div className="focus-heading">
              <div><p className="eyebrow">Фокус дня</p><h2 id="focus-title">Почни з поточних чатів і лідів</h2><p>{snapshot.chats} активних чатів і {snapshot.leads} лідів уже доступні у хмарній базі.</p>{snapshot.focusDirections.length ? <div className="focus-direction-list">{snapshot.focusDirections.map((direction) => <Badge variant="secondary" key={direction}>{direction}</Badge>)}</div> : <p className="focus-empty-note">Фокус напрямків ще не налаштований.</p>}</div>
              <Badge variant="outline">Ручна робота</Badge>
            </div>
            <div className="focus-actions">
              <Button size="lg" onClick={() => navigateTo('platforms')}><MessageSquareText data-icon="inline-start" />Почати постинг</Button>
              <Button size="lg" variant="outline" onClick={() => setTodaySettingsOpen(true)}><Target data-icon="inline-start" />Налаштувати ціль</Button>
            </div>
          </section>

          <WorkdayCard initial={snapshot.workday} today={snapshot.today} unfinishedCount={snapshot.leadTaskCount} dailyGoal={snapshot.bookingGoal.target} monthlyGoal={snapshot.monthlyBookingGoal} focusDirections={snapshot.focusDirections} />

          <section className="goal-card" aria-labelledby="goal-title">
            <div className="card-heading"><div><p className="eyebrow">Ціль на день</p><h2 id="goal-title">Записи</h2><p className="goal-month-note">Місячна ціль: {snapshot.monthlyBookingGoal}</p></div>{snapshot.reportSubmittedAt ? <Badge variant="secondary">Звіт зафіксовано</Badge> : <button className="text-action" type="button" onClick={() => setTodaySettingsOpen(true)}>Змінити</button>}</div>
            <Progress value={Math.min(100, snapshot.bookingGoal.completed / Math.max(1, snapshot.bookingGoal.target) * 100)} className="goal-progress"><ProgressLabel>Виконано</ProgressLabel><ProgressValue>{() => `${snapshot.bookingGoal.completed} із ${snapshot.bookingGoal.target}`}</ProgressValue></Progress>
            <p className="muted-note">{snapshot.pendingAfterReport ? `Після звіту з’явилося ${snapshot.pendingAfterReport} змін у подіях — звіт потребує оновлення.` : snapshot.reportSubmittedAt ? 'Показники відповідають останньому зданому звіту.' : 'Показники рахуються з робочих подій у реальному часі.'}</p>
          </section>

          <section className="queue-card" aria-labelledby="queue-title">
            <div className="card-heading"><div><p className="eyebrow">Наступні дії</p><h2 id="queue-title">Прострочені ліди й нагадування</h2></div><Badge variant="secondary">{snapshot.leadTasks.length}</Badge></div>
            {taskNotice && <output className="muted-note">{taskNotice}</output>}
            {orderedLeadTasks.length ? <ol className="action-list">
              {orderedLeadTasks.map((item, index) => { const section = taskSection(item, snapshot.today); const previous = index > 0 ? taskSection(orderedLeadTasks[index - 1], snapshot.today) : null; return <Fragment key={`${item.kind}:${item.leadId}:${item.lessonId || item.dueAt}`}>{section !== previous && <li className="action-section" aria-label={taskSectionLabel(section)}><span>{taskSectionLabel(section)}</span></li>}<li>
                <span className="action-index">{index + 1}</span>
                <div><strong>{item.leadName}</strong><p>{item.title} · {formatTaskTime(item.dueAt)}</p></div>
                <div className="lead-actions">{item.kind === 'reminder' && item.reminderText ? <><Button variant="ghost" size="sm" disabled={taskBusy === item.reminderId} onClick={() => void copyReminder(item)}>Копіювати</Button><Button variant="outline" size="sm" disabled={taskBusy === item.reminderId} onClick={() => void markReminderSent(item)}>{taskBusy === item.reminderId ? 'Зберігаємо…' : 'Надіслано'}</Button></> : null}<Button variant="outline" size="sm" onClick={() => { setLeadToOpen(item.leadId); navigateTo('leads'); }}>Відкрити</Button></div>
              </li></Fragment>})}
            </ol> : <div className="queue-empty"><p>Прострочених повторних контактів і активних нагадувань немає.</p><Button variant="outline" size="sm" onClick={() => navigateTo('leads')}>Відкрити лідів</Button></div>}
          </section>

          <section className="platform-card" aria-labelledby="platform-title">
            <div className="card-heading"><div><p className="eyebrow">Платформи</p><h2 id="platform-title">Результат сьогодні</h2></div><Button variant="ghost" size="sm" onClick={() => navigateTo('platforms')}>Відкрити платформи</Button></div>
            <div className="platform-table">
              <div className="platform-table-head"><span>Платформа</span><span>Публікації</span><span>Нові чати</span><span>Відгуки</span><span>Записи</span></div>
              {snapshot.platforms.filter((platform) => snapshot.enabledPlatforms.includes(platform.key) || platform.key === 'threads' || platform.key === 'unknown').map((platform) => <div className="platform-row" key={platform.key}><span className="platform-name"><i style={{ background: platform.color }} />{platform.name}</span><strong>{platform.publications}</strong><strong>{platform.joined}</strong><strong>{platform.responses}</strong><strong>{platform.bookings}</strong></div>)}
            </div>
          </section>
        </div></WorkspacePane>
        {visitedViews.has('platforms') && <WorkspacePane active={activeView === 'platforms'}><PlatformWorkspace enabledPlatforms={snapshot.enabledPlatforms} syncRevision={syncRevision} businessDate={snapshot.today} /></WorkspacePane>}
        {visitedViews.has('leads') && <WorkspacePane active={activeView === 'leads'}><LeadsWorkspace account={user.email} initialLeadId={leadToOpen} /></WorkspacePane>}
        {visitedViews.has('analytics') && <WorkspacePane active={activeView === 'analytics'}><AnalyticsWorkspace /></WorkspacePane>}
        {visitedViews.has('reports') && <WorkspacePane active={activeView === 'reports'}><ReportsWorkspace onOpenLead={(leadId) => { setLeadToOpen(leadId); navigateTo('leads'); }} /></WorkspacePane>}
        {visitedViews.has('library') && <WorkspacePane active={activeView === 'library'}><LibraryWorkspace /></WorkspacePane>}
        {visitedViews.has('settings') && <WorkspacePane active={activeView === 'settings'}><SettingsWorkspace user={user} snapshot={snapshot} onRefresh={() => router.refresh()} /></WorkspacePane>}

        <nav className="mobile-bottom-nav" aria-label="Мобільна навігація">
          {navigation.slice(0, 4).map(({ key, label, icon: Icon }) => <button type="button" aria-current={activeView === key ? 'page' : undefined} key={key} onClick={() => navigateTo(key)}><Icon /><span>{label}</span></button>)}
          <button type="button" aria-current={['reports','library','settings'].includes(activeView) ? 'page' : undefined} onClick={(event) => openMobileMenu(event.currentTarget)}><Menu /><span>Ще</span></button>
        </nav>

        <TodaySettingsDialog open={todaySettingsOpen} onClose={() => setTodaySettingsOpen(false)} initialDirections={snapshot.focusDirections} initialDailyGoal={snapshot.bookingGoal.target} initialMonthlyGoal={snapshot.monthlyBookingGoal} initialFunnelTargets={snapshot.funnelTargets} onSaved={() => router.refresh()} />
        <AppReleaseDialog open={releaseOpen} onClose={() => setReleaseOpen(false)} />
      </main>
    </div>
  );
}

function WorkspacePane({ active, children }: { active: boolean; children: ReactNode }) {
  return <div className="workspace-pane" hidden={!active} aria-hidden={active ? undefined : true}>{children}</div>;
}

function taskSection(item: DashboardSnapshot['leadTasks'][number], today: string) {
  if (item.kind !== 'reminder' || !item.lessonDate) return 'followup' as const;
  return item.lessonDate === today ? 'today' as const : item.lessonDate > today ? 'tomorrow' as const : 'today' as const;
}
function taskSectionRank(item: DashboardSnapshot['leadTasks'][number], today: string) {
  const section = taskSection(item, today);
  return section === 'today' ? 0 : section === 'tomorrow' ? 1 : 2;
}
function taskSectionLabel(section: 'followup' | 'today' | 'tomorrow') {
  if (section === 'tomorrow') return 'Завтра';
  if (section === 'today') return 'Сьогодні';
  return 'Повторні контакти';
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
function formatTaskTime(epoch: number) {
  return new Intl.DateTimeFormat('uk-UA', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Kyiv',
  }).format(new Date(epoch * 1000));
}