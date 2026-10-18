'use client';

import { useEffect } from 'react';
import { useToast } from '@/components/ui/toast';
import { DEMO_BLOCKED_EVENT, DEMO_BLOCK_HEADER, DEMO_BLOCK_MESSAGES, type DemoBlockKind } from '@/lib/demo';

/** Тонка смужка під Topbar: що це демо і чому дані не справжні. */
export function DemoBar() {
  return (
    <div role="note" className="shrink-0 border-b border-line px-4 py-1.5 text-center text-xs text-ink-2">
      Демо-версія · дані вигадані · скидаються щоночі
    </div>
  );
}

/**
 * Демо-сервер відповідає на недоступні дії (автопост, runner, резервні копії, вихід) заголовком x-demo-blocked.
 * Тут цей заголовок ловиться в кожній відповіді fetch, і замість помилки в картці показується один Toast.
 */
export function DemoNotice() {
  const toast = useToast();
  useEffect(() => {
    document.documentElement.dataset.demo = '1';
    let lastAt = 0;
    const notify = (kind: DemoBlockKind) => {
      const now = Date.now();
      if (now - lastAt < 1500) return;
      lastAt = now;
      toast.push({ message: DEMO_BLOCK_MESSAGES[kind] });
    };
    const original = window.fetch;
    window.fetch = async (...args) => {
      const response = await original(...args);
      const kind = response.headers.get(DEMO_BLOCK_HEADER);
      if (kind && kind in DEMO_BLOCK_MESSAGES) notify(kind as DemoBlockKind);
      return response;
    };
    const onBlocked = (event: Event) => {
      const kind = (event as CustomEvent<DemoBlockKind>).detail;
      notify(kind && kind in DEMO_BLOCK_MESSAGES ? kind : 'unavailable');
    };
    window.addEventListener(DEMO_BLOCKED_EVENT, onBlocked);
    return () => {
      window.fetch = original;
      window.removeEventListener(DEMO_BLOCKED_EVENT, onBlocked);
      delete document.documentElement.dataset.demo;
    };
  }, [toast]);
  return null;
}
