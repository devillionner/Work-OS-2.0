'use client';

import { buttonVariants } from '@/components/ui/button';

/** Вхід перенаправленням (OAuth code flow з PKCE): працює в будь-якому браузері, зокрема в Electron. Звичайна форма GET: повна навігація, без JS-залежностей. */
export function GoogleRedirectSignIn({ error }: { error?: string }) {
  return (
    <div className="flex flex-col items-start gap-3">
      <form action="/api/auth/google/start" method="get">
        <button type="submit" className={buttonVariants({ variant: 'action', size: 'lg' })}>Увійти через Google</button>
      </form>
      {error ? <p className="m-0 text-xs text-hot" role="alert">{error}</p> : null}
    </div>
  );
}
