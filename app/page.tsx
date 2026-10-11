import { env } from 'cloudflare:workers';
import { GoogleSignIn } from '@/components/google-sign-in';
import { AuthScreen } from '@/components/shell/auth-screen';
import { WorkOsBootstrap } from '@/components/work-os-bootstrap';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await getCurrentUser();

  if (user) {
    return <WorkOsBootstrap user={{ displayName: user.displayName, email: user.email }} />;
  }

  return (
    <AuthScreen
      eyebrow="Приватний робочий простір"
      title="Увійди до Work OS"
      description="Чати, ліди, звіти та статистика захищені. Доступ дозволено лише власнику застосунку."
      note="Увійти можна лише дозволеним Google-акаунтом."
    >
      <GoogleSignIn clientId={env.GOOGLE_CLIENT_ID ?? ''} />
    </AuthScreen>
  );
}
