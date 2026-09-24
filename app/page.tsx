import { env } from 'cloudflare:workers';
import { GoogleSignIn } from '@/components/google-sign-in';
import { WorkOsShell } from '@/components/work-os-shell';
import { getCurrentUser } from '@/lib/auth';
import { getDashboardSnapshot } from '@/lib/dashboard';
import { isD1DailyRowReadLimit } from '@/lib/d1-errors';
import { readSyncRevision } from '@/lib/sync-revision';

export const dynamic = 'force-dynamic';

export default async function Home() {
  try {
    return await renderHome();
  } catch (error) {
    if (isD1DailyRowReadLimit(error)) return <D1QuotaRecovery />;
    throw error;
  }
}

async function renderHome() {
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

function D1QuotaRecovery() {
  return (
    <main className="auth-page">
      <section className="auth-card quota-recovery-card" role="alert" aria-labelledby="quota-title">
        <div className="auth-brand"><span>W</span>Work OS 2.0</div>
        <p className="eyebrow">Тимчасове обмеження Cloudflare</p>
        <h1 id="quota-title">Дані тимчасово недоступні</h1>
        <p className="auth-description">
          Work OS досяг денного ліміту читання Cloudflare D1. Застосунок
          призупинив роботу з базою до автоматичного скидання ліміту.
        </p>
        <div className="quota-recovery-note">
          <strong>Дані не видалені й не пошкоджені.</strong>
          <span>Після скидання денного ліміту D1 звичайна робота відновиться без повторного імпорту.</span>
        </div>
        <p className="auth-note">
          Не потрібно постійно перезавантажувати сторінку — це не прискорить відновлення бази.
        </p>
      </section>
    </main>
  );
}
