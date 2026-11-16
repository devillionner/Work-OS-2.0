import { env } from 'cloudflare:workers';
import { GoogleSignIn } from '@/components/google-sign-in';
import { GoogleRedirectSignIn } from '@/components/google-redirect-sign-in';
import { AuthScreen } from '@/components/shell/auth-screen';
import { WorkOsBootstrap } from '@/components/work-os-bootstrap';
import { getCurrentUser } from '@/lib/auth';
import { authErrorText } from '@/lib/google-oauth';

export const dynamic = 'force-dynamic';

export default async function Home({ searchParams }: { searchParams?: Promise<{ auth_error?: string }> }) {
  const authError = authErrorText((await searchParams)?.auth_error);
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
      {env.GOOGLE_CLIENT_SECRET ? (
        <GoogleRedirectSignIn error={authError} />
      ) : (
        <>
          <GoogleSignIn clientId={env.GOOGLE_CLIENT_ID ?? ''} />
          {authError ? <p className="m-0 mt-3 text-xs text-hot" role="alert">{authError}</p> : null}
        </>
      )}
    </AuthScreen>
  );
}
