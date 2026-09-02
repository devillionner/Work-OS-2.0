import { WorkOsShell } from '@/components/work-os-shell';
import {
  chatGPTSignInPath,
  chatGPTSignOutPath,
  getChatGPTUser,
} from './chatgpt-auth';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await getChatGPTUser();

  if (!user) {
    return (
      <main className="auth-page">
        <section className="auth-card" aria-labelledby="auth-title">
          <div className="auth-brand"><span>W</span>Work OS 2.0</div>
          <p className="eyebrow">Приватний робочий простір</p>
          <h1 id="auth-title">Уся робота — в одному надійному місці</h1>
          <p className="auth-description">
            Вхід захищає ваші чати, ліди, звіти та статистику. Після входу
            дані будуть доступні з ноутбука, Linux, iPhone та інших пристроїв.
          </p>
          <a className="auth-button" href={chatGPTSignInPath('/')} target="_top">
            Увійти до Work OS
          </a>
          <p className="auth-note">Доступ має лише власник застосунку.</p>
        </section>
      </main>
    );
  }

  return (
    <WorkOsShell
      user={{ displayName: user.displayName, email: user.email }}
      signOutPath={chatGPTSignOutPath('/')}
    />
  );
}
