'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AuthScreen } from '@/components/shell/auth-screen';
import { BootSkeleton } from '@/components/shell/boot-skeleton';
import { Button } from '@/components/ui/button';
import { WorkOsShell } from '@/components/work-os-shell';
import { DATA_SYNC_EVENT, type DataSyncDetail } from '@/lib/client-sync';
import type { DashboardSnapshot } from '@/lib/dashboard';

type BootstrapPayload = {
  snapshot: DashboardSnapshot;
  syncRevision: number;
};

export function WorkOsBootstrap({ user }: { user: { displayName: string; email: string } }) {
  const [payload, setPayload] = useState<BootstrapPayload | null>(null);
  const [error, setError] = useState('');
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const payloadRef = useRef<BootstrapPayload | null>(null);
  useEffect(() => { payloadRef.current = payload; });

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    void (async () => {
      try {
        setError('');
        const response = await fetch('/api/dashboard-bootstrap', {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
        const body = await response.json().catch(() => null) as (BootstrapPayload & { error?: string; code?: string }) | null;
        if (cancelled) return;
        if (body?.code === 'd1_daily_read_limit') {
          setQuotaExceeded(true);
          return;
        }
        if (!response.ok || !body?.snapshot || !Number.isSafeInteger(body.syncRevision)) {
          throw new Error(body?.error || 'Не вдалося завантажити робочі дані.');
        }
        setPayload({ snapshot: body.snapshot, syncRevision: body.syncRevision });
      } catch (reason) {
        if (cancelled || controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : 'Не вдалося завантажити робочі дані.');
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [attempt]);

  // A newer authoritative revision (ServerSync's /api/sync poll, same- or cross-tab) must reach this
  // snapshot too: without this, syncRevision was fixed at the initial mount forever and no workspace
  // ever saw a cross-device change (only a same-tab mutation's own direct reload worked).
  const reloadSnapshot = useCallback(async () => {
    try {
      const response = await fetch('/api/dashboard-bootstrap', { cache: 'no-store', headers: { Accept: 'application/json' } });
      const body = await response.json().catch(() => null) as (BootstrapPayload & { error?: string }) | null;
      if (!response.ok || !body?.snapshot || !Number.isSafeInteger(body.syncRevision)) return;
      setPayload((current) => (current && body.syncRevision <= current.syncRevision ? current : { snapshot: body.snapshot, syncRevision: body.syncRevision }));
    } catch { /* next poll/local write will retry */ }
  }, []);

  useEffect(() => {
    const onDataSync = (event: Event) => {
      const detail = (event as CustomEvent<DataSyncDetail>).detail;
      const current = payloadRef.current;
      if (!detail || !current) return;
      if (detail.scope === 'dashboard' || detail.scope === 'all') {
        void reloadSnapshot();
        return;
      }
      // Other scopes don't need a fresh dashboard snapshot, but the revision number itself must stay
      // live so SettingsWorkspace-style consumers and the next same-scope comparison see it move.
      if (Number.isSafeInteger(detail.revision) && (detail.revision as number) > current.syncRevision) {
        setPayload({ ...current, syncRevision: detail.revision as number });
      }
    };
    window.addEventListener(DATA_SYNC_EVENT, onDataSync);
    return () => window.removeEventListener(DATA_SYNC_EVENT, onDataSync);
  }, [reloadSnapshot]);

  if (payload) {
    return (
      <WorkOsShell
        user={user}
        signOutPath="/api/auth/logout"
        snapshot={payload.snapshot}
        syncRevision={payload.syncRevision}
      />
    );
  }

  if (quotaExceeded) return <D1QuotaRecovery />;

  if (error) {
    return (
      <AuthScreen eyebrow="Завантаження" title="Не вдалося отримати дані" description={error}>
        <Button variant="action" size="lg" onClick={() => setAttempt((value) => value + 1)}>Спробувати ще раз</Button>
      </AuthScreen>
    );
  }

  return <BootSkeleton />;
}

// Денний ліміт D1 оновлюється сам; повторні спроби лише витрачають читання, тому кнопки «ще раз» тут немає.
function D1QuotaRecovery() {
  return (
    <AuthScreen
      eyebrow="Денний ліміт бази даних"
      title="Work OS тимчасово недоступний"
      description="Сьогодні вичерпано денний ліміт читання Cloudflare D1. Дані не видалені й не пошкоджені. Доступ відновиться сам після оновлення ліміту — о 03:00 за Києвом."
      note="Не перезавантажуй сторінку без потреби: кожна спроба лише витрачає ліміт."
    />
  );
}
