'use client';

import { useEffect, useRef, useState } from 'react';
import { ATMOSPHERE_PHOTO_EVENT, loadAtmospherePhoto } from '@/components/shell/atmosphere-store';
import { gsap, matchMotion, useGSAP } from '@/components/motion/gsap';
import { AuroraLayers, auroraMotion, auroraSwatchStyle } from '@/components/shell/atmosphere-light';
import { useTheme } from '@/components/shell/theme-provider';

/** Зразок «Аврори» для вибору у «Вигляді»: показує справжній вигляд, а не умовну плашку. */
export function AtmosphereSwatch({ className }: { className?: string }) {
  return <span aria-hidden="true" data-atmosphere="aurora" className={`inline-block shrink-0 rounded-full border border-line ${className ?? 'size-7'}`} style={auroraSwatchStyle()} />;
}

/** Тло за склом: «Аврора» або власне фото з IndexedDB цього пристрою (поверх нього приглушення кольором поля). */
export function Atmosphere() {
  const { atmosphere } = useTheme();
  const root = useRef<HTMLDivElement>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (atmosphere !== 'photo') return;
    let url: string | null = null;
    let cancelled = false;
    const refresh = () => {
      void loadAtmospherePhoto().then((blob) => {
        if (cancelled) return;
        if (url) URL.revokeObjectURL(url);
        url = blob ? URL.createObjectURL(blob) : null;
        setPhotoUrl(url);
      });
    };
    refresh();
    window.addEventListener(ATMOSPHERE_PHOTO_EVENT, refresh);
    return () => {
      cancelled = true;
      window.removeEventListener(ATMOSPHERE_PHOTO_EVENT, refresh);
      if (url) URL.revokeObjectURL(url);
    };
  }, [atmosphere]);

  // Повільний фоновий рух лише через transform, yoyo; на паузі, коли вкладка прихована; вимкнено при reduced motion.
  useGSAP(() => {
    const node = root.current;
    if (!node || atmosphere !== 'aurora') return;
    const mm = matchMotion((reduced) => {
      if (reduced) return;
      const tweens: gsap.core.Tween[] = auroraMotion(node);
      const sync = () => tweens.forEach((tween) => (document.hidden ? tween.pause() : tween.resume()));
      sync();
      document.addEventListener('visibilitychange', sync);
      return () => document.removeEventListener('visibilitychange', sync);
    });
    return () => mm.revert();
  }, { scope: root, dependencies: [atmosphere] });

  return (
    <div ref={root} className="atmosphere" aria-hidden="true">
      {atmosphere === 'aurora' ? (
        <AuroraLayers />
      ) : photoUrl ? (
        <>
          <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${photoUrl})` }} />
          <div className="absolute inset-0 bg-field opacity-40" />
        </>
      ) : null}
    </div>
  );
}
