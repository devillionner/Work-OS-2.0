'use client';

import { useEffect, useState } from 'react';
import { WorkOsShell } from '@/components/work-os-shell';
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

  if (payload) {
    return <>
      <span hidden data-work-os-revision={payload.syncRevision} />
      <WorkOsShell
        user={user}
        signOutPath="/api/auth/logout"
        snapshot={payload.snapshot}
        syncRevision={payload.syncRevision}
      />
    </>;
  }

  if (quotaExceeded) return <D1QuotaRecovery />;

  return (
    <main className="auth-page">
      <section className="auth-card" aria-live="polite">
        <div className="auth-brand"><span>W</span>Work OS 2.0</div>
        <p className="eyebrow">Завантаження</p>
        <h1>{error ? 'Не вдалося отримати дані' : 'Відкриваємо Work OS'}</h1>
        <p className="auth-description">
          {error || 'Інтерфейс уже завантажено. Підтягуємо актуальні чати, ліди та показники окремим легким запитом.'}
        </p>
        {error ? <button className="account-link" type="button" onClick={() => setAttempt(value => value + 1)}>Спробувати ще раз</button> : null}
      </section>
    </main>
  );
}

// The daily D1 read quota resets on its own; retrying only spends more reads, so no retry control here.
function D1QuotaRecovery() {
  return (
    <main className="auth-page">
      <section className="auth-card" aria-live="polite">
        <div className="auth-brand"><span>W</span>Work OS 2.0</div>
        <p className="eyebrow">Денний ліміт бази даних</p>
        <h1>Work OS тимчасово недоступний</h1>
        <p className="auth-description">
          Сьогодні вичерпано денний ліміт читання Cloudflare D1. Дані не видалені й не пошкоджені.
          Доступ відновиться автоматично після оновлення ліміту — о 03:00 за Києвом.
        </p>
        <p className="auth-note">Не потрібно постійно перезавантажувати сторінку: кожна спроба лише витрачає ліміт.</p>
      </section>
    </main>
  );
}
