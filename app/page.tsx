import { env } from 'cloudflare:workers';
import { GoogleSignIn } from '@/components/google-sign-in';
import { WorkOsBootstrap } from '@/components/work-os-bootstrap';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await getCurrentUser();

  if (user) {
    return <WorkOsBootstrap user={{ displayName: user.displayName, email: user.email }} />;
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
