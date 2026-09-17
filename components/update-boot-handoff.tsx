'use client';

import { useEffect } from 'react';

const UPDATE_BOOT_HANDOFF_DELAY_MS = 180;

export function UpdateBootHandoffCleanup() {
  useEffect(() => {
    if (document.documentElement.dataset.workOsUpdateBoot !== '1') return;

    let frame = 0;
    let timer = 0;
    frame = window.requestAnimationFrame(() => {
      timer = window.setTimeout(() => {
        document.documentElement.removeAttribute('data-work-os-update-boot');
      }, UPDATE_BOOT_HANDOFF_DELAY_MS);
    });

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, []);

  return null;
}
