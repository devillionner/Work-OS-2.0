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

type WorkOsShellProps = {
  user: { displayName: string; email: string };
  signOutPath: string;
};

const navigation = [
  { label: 'Сьогодні', icon: LayoutDashboard, active: true },
  { label: 'Платформи', icon: MessageSquareText, active: false },
  { label: 'Ліди', icon: UsersRound, active: false },
  { label: 'Аналітика', icon: BarChart3, active: false },
  { label: 'Звіти', icon: FileText, active: false },
  { label: 'Бібліотека', icon: BookOpenText, active: false },
] as const;

const platformRows = [
  { name: 'Telegram', color: '#2563eb' },
  { name: 'WhatsApp', color: '#16a34a' },
  { name: 'Viber', color: '#7c3aed' },
] as const;

export function WorkOsShell({ user, signOutPath }: WorkOsShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

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
          {navigation.map(({ label, icon: Icon, active }) => (
            <button type="button" className="nav-item" aria-current={active ? 'page' : undefined} title={collapsed ? label : undefined} key={label}>
              <Icon />
              {!collapsed && <span>{label}</span>}
              {label === 'Ліди' && !collapsed && <span className="nav-count">0</span>}
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
          <div><p className="eyebrow">Середа, 2 вересня</p><h1>Сьогодні</h1></div>
          <div className="account-block">
            <div className="account-copy"><strong>{user.displayName}</strong><span>{user.email}</span></div>
            <Avatar><AvatarFallback>{initials(user.displayName)}</AvatarFallback></Avatar>
            <a className="account-link" href={signOutPath}>Вийти</a>
          </div>
        </header>

        <div className="dashboard-grid">
          <section className="focus-card" aria-labelledby="focus-title">
            <div className="focus-heading">
              <div><p className="eyebrow">Фокус дня</p><h2 id="focus-title">Почнімо з надійної основи</h2><p>Нова база ще порожня. Дані зі старої версії не переносилися.</p></div>
              <Badge variant="outline">Безпечний старт</Badge>
            </div>
            <div className="focus-actions">
              <Button size="lg"><Archive data-icon="inline-start" />Підготувати імпорт</Button>
              <Button size="lg" variant="outline"><Target data-icon="inline-start" />Налаштувати ціль</Button>
            </div>
          </section>

          <section className="goal-card" aria-labelledby="goal-title">
            <div className="card-heading"><div><p className="eyebrow">Ціль на день</p><h2 id="goal-title">Записи</h2></div><button className="text-action" type="button">Змінити</button></div>
            <Progress value={0} className="goal-progress"><ProgressLabel>Виконано</ProgressLabel><ProgressValue>{() => '0 із 10'}</ProgressValue></Progress>
            <p className="muted-note">Ціль зберігатиметься у хмарі й буде однакова на всіх пристроях.</p>
          </section>

          <section className="queue-card" aria-labelledby="queue-title">
            <div className="card-heading"><div><p className="eyebrow">Наступні дії</p><h2 id="queue-title">Робоча черга</h2></div><Badge variant="secondary">3 кроки</Badge></div>
            <ol className="action-list">
              <li><span className="action-index">1</span><div><strong>Захистити стару базу</strong><p>Створити перевірений експорт перед міграцією.</p></div><Badge variant="outline">Спочатку</Badge></li>
              <li><span className="action-index">2</span><div><strong>Підключити платформи</strong><p>Перенести списки чатів без зміни їхніх статусів.</p></div><Badge variant="outline">Після імпорту</Badge></li>
              <li><span className="action-index">3</span><div><strong>Увімкнути статистику</strong><p>Рахувати результат із подій, а не ручних лічильників.</p></div><Badge variant="outline">Далі</Badge></li>
            </ol>
          </section>

          <section className="platform-card" aria-labelledby="platform-title">
            <div className="card-heading"><div><p className="eyebrow">Платформи</p><h2 id="platform-title">Результат сьогодні</h2></div><Button variant="ghost" size="sm">Відкрити всі</Button></div>
            <div className="platform-table">
              <div className="platform-table-head"><span>Платформа</span><span>Публікації</span><span>Відгуки</span><span>Записи</span></div>
              {platformRows.map((platform) => <div className="platform-row" key={platform.name}><span className="platform-name"><i style={{ background: platform.color }} />{platform.name}</span><strong>0</strong><strong>0</strong><strong>0</strong></div>)}
            </div>
          </section>

          <section className="status-card" aria-labelledby="status-title">
            <div className="status-icon"><CircleUserRound /></div>
            <div><p className="eyebrow">Доступ</p><h2 id="status-title">Хмарний профіль активний</h2><p>Цей екран доступний із будь-якого пристрою після входу.</p></div>
          </section>
        </div>

        <nav className="mobile-bottom-nav" aria-label="Мобільна навігація">
          {navigation.slice(0, 4).map(({ label, icon: Icon, active }) => <button type="button" aria-current={active ? 'page' : undefined} key={label}><Icon /><span>{label}</span></button>)}
        </nav>
      </main>
    </div>
  );
}

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : value.slice(0, 2)).toUpperCase();
}
