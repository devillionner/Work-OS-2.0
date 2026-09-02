export const dynamic = 'force-dynamic';

export default function Home() {
  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-brand"><span>W</span>Work OS 2.0</div>
        <p className="eyebrow">Приватний робочий простір</p>
        <h1 id="auth-title">Хмарну версію підключено</h1>
        <p className="auth-description">
          Застосунок і база даних уже працюють у твоєму Cloudflare. Наступний
          крок — підключити приватний вхід через обраний Google-акаунт.
        </p>
        <button className="auth-button" type="button" disabled>
          Вхід через Google налаштовується
        </button>
        <p className="auth-note">
          Робочі дані поки не імпортовано й нікому не показуються.
        </p>
      </section>
    </main>
  );
}
