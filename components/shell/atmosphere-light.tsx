'use client';

import type { CSSProperties } from 'react';
import { gsap } from '@/components/motion/gsap';

/**
 * «Промені», «Глибина», «Аврора»: синє світло в темряві. Градієнти й розмиті плями дозволені лише тут (див. CLAUDE.md).
 * Розмиття статичне й ніколи не анімується; рухаються лише transform і opacity. Координати — частки екрана з макета.
 */
export type LightPreset = 'rays' | 'depth' | 'aurora';
export const LIGHT_PRESETS: readonly LightPreset[] = ['rays', 'depth', 'aurora'];
export const isLightPreset = (value: string): value is LightPreset => (LIGHT_PRESETS as readonly string[]).includes(value);

export const LIGHT_FIELD = '#02030A';

type Glow = { left: string; top: string; width: string; height: string; color: string; blur: number; opacity?: number };

const glowStyle = ({ left, top, width, height, color, blur, opacity }: Glow): CSSProperties => ({
  left, top, width, height, background: color, borderRadius: '50%', filter: `blur(${blur}px)`, ...(opacity === undefined ? null : { opacity }),
});

/** Віяло променів: сектори ≈ 8° через 8–10°, три відтінки синього; краї м'які, щоб промені були смугами світла, а не клинами. */
const RAY_COLORS = ['#1C3AF8', '#0F26D8', '#2A4BFF'] as const;
const RAY_GAPS = [9, 8, 10] as const;
const RAY_WIDTH = 8;

export function rayFanGradient(): string {
  const stops = ['transparent 0deg'];
  let at = 0;
  for (let index = 0; at + RAY_GAPS[index % 3] + RAY_WIDTH < 358; index += 1) {
    const start = at + RAY_GAPS[index % 3];
    const end = start + RAY_WIDTH;
    const color = RAY_COLORS[index % 3];
    stops.push(`transparent ${start}deg`, `${color} ${start + 1.5}deg`, `${color} ${end - 1.5}deg`, `transparent ${end}deg`);
    at = end;
  }
  stops.push('transparent 360deg');
  return `conic-gradient(from 160deg at 50% 30%, ${stops.join(', ')})`;
}

const RAYS_CORE: Glow = { left: '30%', top: '-30%', width: '40%', height: '70%', color: '#3D5CFF', blur: 40 };
const PILLAR_OPACITY = 0.55;
const RAYS_PILLAR: Glow = { left: '44%', top: '0%', width: '12%', height: '90%', color: '#9CB2FF', blur: 18, opacity: PILLAR_OPACITY };
const RAYS_FAN = { left: '-20%', top: '-60%', width: '140%', height: '150%', blur: 14 };
/** Промені гаснуть із відстанню від джерела: біля верхнього центру яскраві, до країв і низу — темрява. */
const RAYS_FAN_MASK = 'radial-gradient(ellipse 52% 44% at 50% 40%, #000 0%, rgb(0 0 0 / 0.62) 36%, transparent 100%)';

const DEPTH_GLOW: Glow = { left: '28%', top: '-30%', width: '44%', height: '70%', color: '#0D22D6', blur: 50, opacity: 0.85 };
const CORE_OPACITY = 0.7;
const DEPTH_CORE: Glow = { left: '42%', top: '-10%', width: '16%', height: '30%', color: '#3A58FF', blur: 24, opacity: CORE_OPACITY };
/** Сильна віньєтка: нижня половина екрана й кути — чорні. */
const DEPTH_VIGNETTE = [
  `linear-gradient(180deg, transparent 0%, transparent 28%, rgb(2 3 10 / 0.88) 58%, ${LIGHT_FIELD} 82%)`,
  `radial-gradient(ellipse 78% 70% at 50% 0%, transparent 30%, rgb(2 3 10 / 0.72) 72%, ${LIGHT_FIELD} 100%)`,
].join(', ');

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

export function LightLayers({ preset }: { preset: LightPreset }) {
  if (preset === 'rays') {
    return (
      <>
        <div data-fan="" className="absolute will-change-transform" style={{ left: RAYS_FAN.left, top: RAYS_FAN.top, width: RAYS_FAN.width, height: RAYS_FAN.height, background: rayFanGradient(), filter: `blur(${RAYS_FAN.blur}px)`, maskImage: RAYS_FAN_MASK, WebkitMaskImage: RAYS_FAN_MASK, transformOrigin: '50% 30%' }} />
        <div className="absolute" style={glowStyle(RAYS_CORE)} />
        <div data-pillar="" className="absolute will-change-[opacity]" style={glowStyle(RAYS_PILLAR)} />
        <div className="atm-veil" />
      </>
    );
  }
  if (preset === 'depth') {
    return (
      <>
        <div className="absolute" style={glowStyle(DEPTH_GLOW)} />
        <div data-core="" className="absolute will-change-[opacity]" style={glowStyle(DEPTH_CORE)} />
        <div className="absolute inset-0" style={{ background: DEPTH_VIGNETTE }} />
        <div className="atm-veil" />
      </>
    );
  }
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

/**
 * Повільний рух: лише transform і opacity, yoyo, `sine.inOut`. Промені повертаються на ±3,5° за 75 с, а стовп «дихає»
 * непрозорістю ±12 % за 25 с; у «Глибині» дихає лише ядро (±10 % за 30 с); смуги «Аврори» ковзають і гойдаються в різних фазах.
 */
export function lightMotion(node: HTMLElement, preset: LightPreset): gsap.core.Tween[] {
  const yoyo = { ease: 'sine.inOut', yoyo: true, repeat: -1 } as const;
  const tweens: gsap.core.Tween[] = [];
  const phase = (tween: gsap.core.Tween, progress: number) => { tween.progress(progress); return tween; };
  if (preset === 'rays') {
    const fan = node.querySelector('[data-fan]');
    const pillar = node.querySelector('[data-pillar]');
    gsap.set(fan, { rotation: -3.5 });
    tweens.push(phase(gsap.to(fan, { rotation: 3.5, duration: 75, ...yoyo }), 0.5));
    gsap.set(pillar, { opacity: PILLAR_OPACITY * 1.12 });
    tweens.push(gsap.to(pillar, { opacity: PILLAR_OPACITY * 0.88, duration: 25, ...yoyo }));
  } else if (preset === 'depth') {
    const core = node.querySelector('[data-core]');
    gsap.set(core, { opacity: CORE_OPACITY * 1.1 });
    tweens.push(gsap.to(core, { opacity: CORE_OPACITY * 0.9, duration: 30, ...yoyo }));
  } else {
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
  }
  return tweens;
}

/** Зразок для вибору: справжній вигляд пресета в мініатюрі. */
export function lightSwatchStyle(preset: LightPreset): CSSProperties {
  if (preset === 'rays') {
    return { backgroundColor: LIGHT_FIELD, backgroundImage: `radial-gradient(ellipse 22% 60% at 50% 0%, rgb(156 178 255 / 0.9), transparent 100%), radial-gradient(ellipse 60% 50% at 50% 0%, #3D5CFF, transparent 100%), ${rayFanGradient().replace('50% 30%', '50% -30%')}` };
  }
  if (preset === 'depth') {
    return { backgroundColor: LIGHT_FIELD, backgroundImage: `radial-gradient(ellipse 22% 28% at 50% 0%, #3A58FF, transparent 100%), radial-gradient(ellipse 62% 70% at 50% 0%, #0D22D6, transparent 100%), linear-gradient(180deg, transparent 40%, ${LIGHT_FIELD} 85%)` };
  }
  return { backgroundColor: LIGHT_FIELD, backgroundImage: `linear-gradient(162deg, transparent 52%, #0A1AA8 60%, transparent 72%), linear-gradient(160deg, transparent 30%, #1530F0 40%, #7D97FF 46%, #1530F0 53%, transparent 64%)` };
}
