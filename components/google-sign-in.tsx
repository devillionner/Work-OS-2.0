'use client';

import { useEffect, useRef, useState } from 'react';

type GoogleCredentialResponse = { credential?: string };

type GoogleAccounts = {
  id: {
    initialize(options: {
      client_id: string;
      callback(response: GoogleCredentialResponse): void;
    }): void;
    renderButton(
      parent: HTMLElement,
      options: { theme: string; size: string; width: number; text: string },
    ): void;
  };
};

declare global {
  interface Window {
    google?: { accounts: GoogleAccounts };
  }
}

export function GoogleSignIn({ clientId }: { clientId: string }) {
  const buttonRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!clientId) {
      setError('Google-вхід ще не налаштовано.');
      return;
    }

    let cancelled = false;
    const render = () => {
      if (cancelled || !window.google || !buttonRef.current) return;
      buttonRef.current.replaceChildren();
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async ({ credential }) => {
          if (!credential || busyRef.current) return;
          busyRef.current = true;
          setBusy(true);
          setError('');
          try {
            const response = await fetch('/api/auth/google', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ credential }),
            });
            const result = (await response.json()) as { error?: string };
            if (!response.ok) throw new Error(result.error || 'Не вдалося увійти.');
            window.location.assign('/');
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Не вдалося увійти.');
            busyRef.current = false;
            setBusy(false);
          }
        },
      });
      window.google.accounts.id.renderButton(buttonRef.current, {
        theme: 'outline',
        size: 'large',
        width: 320,
        text: 'signin_with',
      });
    };

    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-work-os-google-sign-in]',
    );
    if (existing) {
      if (window.google) render();
      else existing.addEventListener('load', render, { once: true });
    } else {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.dataset.workOsGoogleSignIn = 'true';
      script.addEventListener('load', render, { once: true });
      script.addEventListener('error', () => {
        if (!cancelled) setError('Не вдалося завантажити Google-вхід.');
      });
      document.head.append(script);
    }

    return () => {
      cancelled = true;
      existing?.removeEventListener('load', render);
    };
  }, [clientId]);

  return (
    <div className="google-sign-in-wrap" aria-busy={busy}>
      <div ref={buttonRef} className={busy ? 'is-busy' : undefined} />
      {busy && <p className="auth-note">Перевіряємо акаунт…</p>}
      {error && <p className="auth-error" role="alert">{error}</p>}
    </div>
  );
}
