'use client';

import type { CSSProperties } from 'react';
import { gsap } from '@/components/motion/gsap';

/**
 * «Аврора»: смуги синього світла в темряві. Градієнти й розмиті плями дозволені лише тут (див. CLAUDE.md).
 * Розмиття статичне й ніколи не анімується; рухаються лише transform і opacity. Координати — частки екрана з макета.
 */
export const LIGHT_FIELD = '#02030A';

type Glow = { left: string; top: string; width: string; height: string; color: string; blur: number; opacity?: number };

const glowStyle = ({ left, top, width, height, color, blur, opacity }: Glow): CSSProperties => ({
  left, top, width, height, background: color, borderRadius: '50%', filter: `blur(${blur}px)`, ...(opacity === undefined ? null : { opacity }),
});

type Band = { box: Pick<Glow, 'left' | 'top' | 'width' | 'height'>; rotate: number; glow: Pick<Glow, 'color' | 'blur' | 'opacity'> };
const AURORA_MAIN: Band = { box: { left: '-25%', top: '28%', width: '150%', height: '26%' }, rotate: -18, glow: { color: '#1530F0', blur: 34 } };
const AURORA_THREAD: Band = { box: { left: '-10%', top: '40%', width: '120%', height: '8%' }, rotate: -18, glow: { color: '#7D97FF', blur: 16, opacity: 0.7 } };
const AURORA_LOW: Band = { box: { left: '-20%', top: '58%', width: '140%', height: '18%' }, rotate: -12, glow: { color: '#0A1AA8', blur: 30, opacity: 0.8 } };
const AURORA_SMOKE: Glow = { left: '60%', top: '10%', width: '30%', height: '30%', color: LIGHT_FIELD, blur: 24 };

/** Смуга «Аврори»: обгортка задає кут і розмір (її кут гойдається), а всередині пляма ковзає вздовж осі смуги. */
function AuroraBand({ band, id }: { band: Band; id: string }) {
  return (
    <div data-aurora={id} className="absolute will-change-transform" style={{ ...band.box, transform: `rotate(${band.rotate}deg)` }}>
      <div data-slide="" className="absolute inset-0 will-change-transform" style={{ background: band.glow.color, borderRadius: '50%', filter: `blur(${band.glow.blur}px)`, ...(band.glow.opacity === undefined ? null : { opacity: band.glow.opacity }) }} />
    </div>
  );
}

export function AuroraLayers() {
  return (
    <>
      <AuroraBand band={AURORA_MAIN} id="main" />
      <AuroraBand band={AURORA_THREAD} id="thread" />
      <AuroraBand band={AURORA_LOW} id="low" />
      <div className="absolute" style={glowStyle(AURORA_SMOKE)} />
      <div className="atm-veil" />
    </>
  );
}

/** Повільний рух: лише transform, yoyo, `sine.inOut`; смуги ковзають і гойдаються в різних фазах. */
export function auroraMotion(node: HTMLElement): gsap.core.Tween[] {
  const yoyo = { ease: 'sine.inOut', yoyo: true, repeat: -1 } as const;
  const tweens: gsap.core.Tween[] = [];
  const phase = (tween: gsap.core.Tween, progress: number) => { tween.progress(progress); return tween; };
  const bands: Array<[string, Band, number, number, number, number]> = [
    ['main', AURORA_MAIN, 2, 7, 84, 0.2], ['thread', AURORA_THREAD, 1.5, -9, 62, 0.65], ['low', AURORA_LOW, 2, 6, 72, 0.85],
  ];
  for (const [id, band, turn, slide, duration, start] of bands) {
    const wrapper = node.querySelector<HTMLElement>(`[data-aurora="${id}"]`);
    if (!wrapper) continue;
    gsap.set(wrapper, { rotation: band.rotate - turn });
    tweens.push(phase(gsap.to(wrapper, { rotation: band.rotate + turn, duration, ...yoyo }), start));
    tweens.push(phase(gsap.fromTo(wrapper.querySelector('[data-slide]'), { xPercent: -slide }, { xPercent: slide, duration: duration * 1.1, ...yoyo }), 1 - start));
  }
  return tweens;
}

/** Зразок для вибору: справжній вигляд «Аврори» в мініатюрі. */
export function auroraSwatchStyle(): CSSProperties {
  return { backgroundColor: LIGHT_FIELD, backgroundImage: `linear-gradient(162deg, transparent 52%, #0A1AA8 60%, transparent 72%), linear-gradient(160deg, transparent 30%, #1530F0 40%, #7D97FF 46%, #1530F0 53%, transparent 64%)` };
}
