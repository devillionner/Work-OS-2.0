import { env } from 'cloudflare:workers';
import { GoogleSignIn } from '@/components/google-sign-in';
import { WorkOsShell } from '@/components/work-os-shell';
import { getCurrentUser } from '@/lib/auth';
import { getDashboardSnapshot } from '@/lib/dashboard';
import { readSyncRevision } from '@/lib/sync-revision';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await getCurrentUser();

  if (user) {
    const [snapshot, syncRevision] = await Promise.all([
      getDashboardSnapshot(user.id),
      readSyncRevision(env.DB, user.id),
    ]);
    return <>
      <span hidden data-work-os-revision={syncRevision} />
      <WorkOsShell
        user={{ displayName: user.displayName, email: user.email }}
        signOutPath="/api/auth/logout"
        snapshot={snapshot}
        syncRevision={syncRevision}
      />
    </>;
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-brand"><span>W</span>Work OS 2.0</div>
        <p className="eyebrow">Приватний робочий простір</p>
        <h1 id="auth-title">Увійди до свого Work OS</h1>
        <p className="auth-description">
          Чати, ліди, звіти та статистика захищені. Доступ дозволено лише
          власнику застосунку.
        </p>
        <GoogleSignIn clientId={env.GOOGLE_CLIENT_ID ?? ''} />
        <p className="auth-note">Увійти можна лише дозволеним Google-акаунтом.</p>
      </section>
    </main>
  );
}
