'use client';

import { useEffect } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[AppError]', error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background text-foreground">
      <div className="max-w-md w-full p-6 text-center bg-card border border-border rounded-xl shadow-lg">
        <div className="size-12 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="size-6" />
        </div>
        <h1 className="text-xl font-bold mb-2">Щось пішло не так</h1>
        <p className="text-sm text-muted-foreground mb-6">
          {error.message || 'Сталася непередбачена помилка під час завантаження застосунку.'}
        </p>
        <div className="flex items-center justify-center gap-3">
          <Button onClick={() => reset()} variant="default">
            <RotateCcw data-icon="inline-start" className="size-4" />
            Спробувати знову
          </Button>
          <Button onClick={() => window.location.assign('/')} variant="outline">
            На головну
          </Button>
        </div>
      </div>
    </div>
  );
}
