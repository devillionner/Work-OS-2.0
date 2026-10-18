'use client';

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CommandPalette } from '@/components/shell/command-palette';
import { useCommand } from '@/components/shell/command-bus';
import { CreateMenu } from '@/components/shell/create-menu';
import { Dock } from '@/components/shell/dock';
import { MoreSheet } from '@/components/shell/more-sheet';
import { PanelSlotProvider, useOpenPanelCount } from '@/components/shell/panel';
import { PulseRail, type PulseRing } from '@/components/shell/pulse-rail';
import { QuickSettings } from '@/components/shell/quick-settings';
import { Rail } from '@/components/shell/rail';
import { ReleasePanel } from '@/components/shell/release-panel';
import { useScrollActivity } from '@/components/shell/scroll-activity';
import { ShellProvider, type ShellContextValue } from '@/components/shell/shell-context';
import { DemoBar, DemoNotice } from '@/components/shell/demo-bar';
import { Topbar } from '@/components/shell/topbar';
import { isDemoEmail } from '@/lib/demo';
import { useQueryParam } from '@/components/shell/url-state';
import { DESKTOP, PHONE, WIDE, useMediaQuery } from '@/components/shell/use-media';
import { ViewPane, TopbarSlotProvider } from '@/components/shell/view-pane';
import { getActiveView, setActiveView, useActiveView, viewLabel, type ViewKey } from '@/components/shell/views';
import { Ghost } from '@/components/ui/ghost';
import { toneFor } from '@/components/views/shared/pace';
import { WorkspaceErrorBoundary } from '@/components/workspace-error-boundary';
import { SERVER_SYNC_IDLE_MAX_MS } from '@/components/server-sync';
import { announceDataChange, requestDataSync } from '@/lib/client-sync';
import type { DashboardSnapshot } from '@/lib/dashboard';

const loadToday = () => import('@/components/views/today/today-view');
const loadPlatforms = () => import('@/components/views/platforms/platforms-view');
const loadLeads = () => import('@/components/views/leads/leads-view');
const loadAnalytics = () => import('@/components/views/analytics/analytics-view');
const loadReports = () => import('@/components/views/reports/reports-view');
const loadLibrary = () => import('@/components/views/library/library-view');
const loadSettings = () => import('@/components/views/settings/settings-view');

const TodayView = lazy(loadToday);
const PlatformsView = lazy(loadPlatforms);
const LeadsView = lazy(loadLeads);
const AnalyticsView = lazy(loadAnalytics);
const ReportsView = lazy(loadReports);
const LibraryView = lazy(loadLibrary);
const SettingsView = lazy(loadSettings);

// Передзавантажується лише код розділів (разом із важчими чанками всередині), дані — тільки при відкритті.
const PRELOAD: Record<ViewKey, () => Promise<unknown>> = {
  today: loadToday,
  platforms: loadPlatforms,
  leads: loadLeads,
  analytics: () => Promise.all([loadAnalytics(), import('@/components/views/analytics/trend-chart')]),
  reports: () => Promise.all([loadReports(), import('@/components/views/reports/checkpoints'), import('@/components/views/reports/subjects-card')]),
  library: loadLibrary,
  settings: loadSettings,
};

function prefetchView(key: ViewKey) {
  void PRELOAD[key]().catch(() => undefined);
}

const VIEW_KEYS: ViewKey[] = ['today', 'platforms', 'leads', 'analytics', 'reports', 'library', 'settings'];
const FALLBACK_MINUTES = Math.max(1, Math.round(SERVER_SYNC_IDLE_MAX_MS / 60_000));

function renderView(key: ViewKey): ReactNode {
  switch (key) {
    case 'today': return <TodayView />;
    case 'platforms': return <PlatformsView />;
    case 'leads': return <LeadsView />;
    case 'analytics': return <AnalyticsView />;
    case 'reports': return <ReportsView />;
    case 'library': return <LibraryView />;
    case 'settings': return <SettingsView />;
  }
}

type Props = {
  user: { displayName: string; email: string };
  signOutPath: string;
  snapshot: DashboardSnapshot;
  syncRevision: number;
};

export function WorkOsShell({ user, signOutPath, snapshot, syncRevision }: Props) {
  const activeView = useActiveView();
  const phone = useMediaQuery(PHONE);
  const desktop = useMediaQuery(DESKTOP);
  const wide = useMediaQuery(WIDE);
  const [visited, setVisited] = useState(() => new Set<ViewKey>([activeView]));
  if (!visited.has(activeView)) setVisited(new Set(visited).add(activeView));

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [asideElement, setAsideElement] = useState<HTMLElement | null>(null);
  const [topbarSlot, setTopbarSlot] = useState<HTMLElement | null>(null);
  const [leadParam, setLeadParam] = useQueryParam('lead');
  const scroller = useRef<HTMLDivElement>(null);
  useScrollActivity();

  const navigate = useCallback((next: ViewKey) => {
    if (next === getActiveView()) return;
    if (next === 'today') requestDataSync('focus');
    setActiveView(next);
  }, []);

  useEffect(() => {
    const run = () => VIEW_KEYS.forEach(prefetchView);
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(run, { timeout: 4000 });
      return () => window.cancelIdleCallback(id);
    }
    const timer = window.setTimeout(run, 1500);
    return () => window.clearTimeout(timer);
  }, []);

  const openLead = useCallback((leadId: string) => {
    if (leadId) setLeadParam(leadId, leadParam ? 'replace' : 'push');
    navigate('leads');
  }, [navigate, leadParam, setLeadParam]);

  const refreshSnapshot = useCallback(() => announceDataChange('dashboard'), []);
  const openRelease = useCallback(() => setReleaseOpen(true), []);

  useCommand('release:open', openRelease);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((value) => !value);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (phone) window.scrollTo({ top: 0, behavior: 'auto' });
    else scroller.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [activeView, phone]);

  const context = useMemo<ShellContextValue>(() => ({ user, signOutPath, snapshot, syncRevision, navigate, openLead, refreshSnapshot, openRelease }), [user, signOutPath, snapshot, syncRevision, navigate, openLead, refreshSnapshot, openRelease]);

  const rings = useMemo<PulseRing[]>(() => {
    const totals = snapshot.platforms.reduce((sum, platform) => ({ publications: sum.publications + platform.publications, joined: sum.joined + platform.joined, bookings: sum.bookings + platform.bookings }), { publications: 0, joined: 0, bookings: 0 });
    return [
      { key: 'publications', label: 'Публікації', count: totals.publications, target: snapshot.publicationGoal.target || null, tone: toneFor(totals.publications, snapshot.publicationGoal.target) },
      { key: 'joined', label: 'Нові чати', count: totals.joined, target: snapshot.chatGoal.target || null, tone: snapshot.chatGoal.target > 0 ? toneFor(totals.joined, snapshot.chatGoal.target) : 'rail' },
      { key: 'bookings', label: 'Записи', count: totals.bookings, target: snapshot.bookingGoal.target || null, tone: toneFor(totals.bookings, snapshot.bookingGoal.target) },
    ];
  }, [snapshot.platforms, snapshot.publicationGoal.target, snapshot.chatGoal.target, snapshot.bookingGoal.target]);

  const demo = isDemoEmail(user.email);
  const topbar = (
    <Topbar
      title={viewLabel(activeView)}
      phone={phone}
      user={user}
      signOutPath={signOutPath}
      enabledPlatforms={snapshot.enabledPlatforms}
      viewKey={activeView}
      fallbackMinutes={FALLBACK_MINUTES}
      onNavigate={navigate}
      onOpenPalette={() => setPaletteOpen(true)}
      slotRef={setTopbarSlot}
    />
  );
  const header = demo ? <>{topbar}<DemoBar /></> : topbar;

  const panes = (
    <>
      {VIEW_KEYS.filter((key) => visited.has(key)).map((key) => (
        <ViewPane key={key} active={activeView === key}>
          <WorkspaceErrorBoundary name={viewLabel(key)}>
            <Suspense fallback={<ViewFallback />}>{renderView(key)}</Suspense>
          </WorkspaceErrorBoundary>
        </ViewPane>
      ))}
    </>
  );

  const overlays = (
    <>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} onNavigate={navigate} />
      <ReleasePanel open={releaseOpen} onOpenChange={setReleaseOpen} />
    </>
  );

  return (
    <ShellProvider value={context}>
      <TopbarSlotProvider element={topbarSlot}>
        <PanelSlotProvider element={asideElement}>
          <span hidden data-work-os-revision={syncRevision} />
          {demo ? <DemoNotice /> : null}
          {phone ? (
            <div className="relative min-h-dvh pb-[calc(168px+env(safe-area-inset-bottom))]">
              {header}
              <main className="flex flex-col gap-3 px-3 pt-2">{panes}</main>
              <PulseRail rings={rings} onOpenSettings={() => setQuickOpen(true)} />
              <div className="fixed right-3 z-30" style={{ bottom: 'calc(12px + 64px + 12px + env(safe-area-inset-bottom))' }}>
                <CreateMenu onNavigate={navigate} fab />
              </div>
              <Dock active={activeView} onNavigate={navigate} onPrefetch={prefetchView} onMore={() => setMoreOpen(true)} />
              <MoreSheet open={moreOpen} onOpenChange={setMoreOpen} active={activeView} onNavigate={navigate} />
              <QuickSettings open={quickOpen} onOpenChange={setQuickOpen} onNavigate={navigate} />
              {overlays}
            </div>
          ) : (
            <div className="relative flex h-dvh justify-center p-3">
              <div className="flex h-full w-full max-w-[1680px] gap-3 rounded-frame border border-line bg-sunken p-4">
                <Rail active={activeView} leadCount={snapshot.leads} canExpand={desktop} onNavigate={navigate} onPrefetch={prefetchView} onOpenRelease={openRelease} />
                <div className="glass frost relative flex min-w-0 flex-1 overflow-hidden rounded-panel">
                  <div className="flex min-w-0 flex-1 flex-col">
                    {header}
                    <main ref={scroller} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-8 pt-1">{panes}</main>
                  </div>
                  {wide ? <InspectorColumn onElement={setAsideElement} /> : null}
                </div>
              </div>
              {overlays}
            </div>
          )}
        </PanelSlotProvider>
      </TopbarSlotProvider>
    </ShellProvider>
  );
}

/** Права колонка Inspector: зсуває контент, а не накриває його (≥ 1440px). Ширина змінюється миттєво, вміст виїжджає transform. */
function InspectorColumn({ onElement }: { onElement: (element: HTMLElement | null) => void }) {
  const count = useOpenPanelCount();
  return (
    <div className="shrink-0 overflow-hidden border-l border-line bg-glass-strong" style={{ width: count > 0 ? 'var(--inspector-w)' : 0, borderLeftWidth: count > 0 ? 1 : 0 }}>
      <div ref={onElement} className="h-full" style={{ width: 'var(--inspector-w)' }} />
    </div>
  );
}

function ViewFallback() {
  return (
    <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-3" aria-busy="true">
      <Ghost className="h-40 rounded-card" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((item) => <Ghost key={item} className="h-36 rounded-card" />)}</div>
      <Ghost className="h-64 rounded-card" />
    </div>
  );
}
