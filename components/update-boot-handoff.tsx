'use client';

import { useEffect } from 'react';

export function UpdateBootHandoffCleanup() {
  useEffect(() => {
    if (document.documentElement.dataset.workOsUpdateBoot !== '1') return;

    let frame = 0;
    let secondFrame = 0;
    frame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        document.documentElement.removeAttribute('data-work-os-update-boot');
      });
    });

    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, []);

  return null;
}
