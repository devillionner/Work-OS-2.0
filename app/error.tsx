'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[AppError]', error);
  }, [error]);

  return (
    <main className="relative z-10 grid min-h-dvh place-items-center p-4">
      <Surface variant="glass-strong" radius="panel" role="alert" className="flex w-full max-w-md flex-col gap-4 p-7">
        <h1 className="m-0 text-[22px] font-medium tracking-[-0.02em]">Щось пішло не так</h1>
        <p className="m-0 text-sm text-ink-2">{error.message || 'Сталася непередбачена помилка під час завантаження застосунку.'}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="action" onClick={() => reset()}>Спробувати ще раз</Button>
          <Button variant="outline" onClick={() => window.location.assign('/')}>На головну</Button>
        </div>
      </Surface>
    </main>
  );
}
