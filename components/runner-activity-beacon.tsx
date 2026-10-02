'use client';

import { useEffect } from 'react';
import { noteRunnerActivity } from '@/lib/runner-activity';

// Marks real operator activity on any Work OS page so the local runner stays quiet when the site is unused.
export function RunnerActivityBeacon() {
  useEffect(() => {
    const note = () => { if (document.visibilityState === 'visible') noteRunnerActivity(); };
    note();
    const events = ['pointerdown', 'keydown', 'focus', 'visibilitychange'] as const;
    for (const event of events) window.addEventListener(event, note, { passive: true });
    return () => { for (const event of events) window.removeEventListener(event, note); };
  }, []);
  return null;
}
