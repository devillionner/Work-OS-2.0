'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ATMOSPHERE_PHOTO_EVENT, loadAtmospherePhoto } from '@/components/shell/atmosphere-store';
import { gsap, matchMotion, useGSAP } from '@/components/motion/gsap';
import { useTheme, type AtmospherePreset } from '@/components/shell/theme-provider';

type Spot = { left: string; top: string; size: string; color: 1 | 2 | 3 | 4; stretch?: string };
type SpotPreset = Exclude<AtmospherePreset, 'photo' | 'mercury' | 'steel'>;

// Розкладка плям на пресет; кольори беруться з токенів --atm-1..4 у globals.css.
const LAYOUTS: Record<SpotPreset, Spot[]> = {
  fog: [
    { left: '-8%', top: '-10%', size: '58vmax', color: 1 }, { left: '48%', top: '8%', size: '46vmax', color: 3 },
    { left: '10%', top: '55%', size: '52vmax', color: 2 }, { left: '62%', top: '58%', size: '40vmax', color: 4 },
  ],
  coast: [
    { left: '-10%', top: '-20%', size: '70vmax', color: 1 }, { left: '20%', top: '62%', size: '55vmax', color: 3 },
    { left: '55%', top: '40%', size: '48vmax', color: 2 }, { left: '-5%', top: '70%', size: '42vmax', color: 4 },
  ],
  forest: [
    { left: '-6%', top: '-12%', size: '46vmax', color: 1, stretch: '0.55' }, { left: '38%', top: '-6%', size: '52vmax', color: 3, stretch: '0.5' },
    { left: '72%', top: '10%', size: '44vmax', color: 1, stretch: '0.55' }, { left: '14%', top: '58%', size: '58vmax', color: 4 },
  ],
  road: [
    { left: '18%', top: '-18%', size: '60vmax', color: 3 }, { left: '-14%', top: '30%', size: '50vmax', color: 1 },
    { left: '58%', top: '34%', size: '50vmax', color: 2 }, { left: '26%', top: '66%', size: '56vmax', color: 4 },
  ],
};

/**
 * «Ртуть»: краплі рідкого хрому на майже чорному тлі. Кожна крапля — вісім шарів: щільний дзеркальний відблиск і вікно-відблиск,
 * дугове відображення горизонту (темна смуга під світлою лінією), небо вгорі, відскок знизу, холодний відблиск-обідок
 * із нижньо-правого боку й тіло від світлого хрому до темного краю. Градієнти дозволені лише тут (див. CLAUDE.md);
 * кольори — токени --hg-* з globals.css.
 */
const DROP_BODY = [
  'radial-gradient(ellipse 8% 5.5% at 30% 19%, #fff 0%, rgb(255 255 255 / 0.92) 38%, transparent 100%)',
  'radial-gradient(ellipse 22% 7% at 40% 26%, rgb(255 255 255 / 0.5), transparent 100%)',
  'radial-gradient(ellipse 100% 90% at 50% 135%, transparent 67%, rgb(6 8 12 / 0.92) 73%, rgb(6 8 12 / 0.9) 85%, rgb(244 248 255 / 0.9) 89.5%, rgb(150 166 196 / 0.45) 94%, transparent 98%)',
  'radial-gradient(ellipse 85% 55% at 44% 6%, rgb(225 235 252 / 0.78), rgb(150 166 196 / 0.42) 55%, transparent 100%)',
  'radial-gradient(ellipse 72% 26% at 56% 104%, rgb(188 201 222 / 0.62), transparent 100%)',
  'radial-gradient(circle farthest-corner at 34% 30%, transparent 58%, rgb(var(--hg-rim) / 0.55) 75%, transparent 87%)',
  'radial-gradient(circle at 40% 40%, var(--hg-mid) 0%, var(--hg-dark) 40%, var(--hg-deep) 78%, transparent 100%)',
].join(', ');

// base — початковий нахил краплі (відблиски нахиляються разом із нею), rotate — на скільки градусів вона повільно гойдається.
type Drop = { left: string; top: string; size: string; radius: string; base: number; dx: number; dy: number; scale: number; rotate: number; duration: number };
const DROPS: readonly Drop[] = [
  { left: '-9%', top: '36%', size: '50vmax', radius: '58% 42% 40% 60% / 62% 46% 54% 38%', base: -14, dx: 5, dy: -4, scale: 1.04, rotate: 5, duration: 78 },
  { left: '60%', top: '-16%', size: '40vmax', radius: '44% 56% 60% 40% / 48% 40% 60% 52%', base: 22, dx: -4, dy: 5, scale: 1.05, rotate: -6, duration: 66 },
  { left: '71%', top: '50%', size: '31vmax', radius: '50% 50% 47% 53% / 53% 49% 51% 47%', base: -28, dx: -6, dy: -5, scale: 1.04, rotate: 4, duration: 88 },
  { left: '27%', top: '-9%', size: '21vmax', radius: '54% 46% 50% 50% / 48% 52% 48% 52%', base: 10, dx: 7, dy: 6, scale: 1.06, rotate: -5, duration: 72 },
  { left: '45%', top: '67%', size: '15vmax', radius: '46% 54% 52% 48% / 52% 48% 52% 48%', base: 35, dx: -8, dy: -6, scale: 1.05, rotate: 6, duration: 84 },
];

/**
 * «Синя сталь»: темна сталь діагональними тонами з горизонтальною фактурою шліфування, двома м'якими смугами відблиску
 * й глибоким синім світінням із нижнього правого кута, що повільно «дихає». Синій тут лише світло на металі.
 */
const STEEL_BASE = 'linear-gradient(135deg, var(--st-1) 0%, var(--st-2) 24%, var(--st-3) 46%, var(--st-2) 64%, var(--st-1) 80%, var(--st-0) 100%)';
const STEEL_BRUSH = 'repeating-linear-gradient(0deg, rgb(255 255 255 / 0.04) 0 1px, transparent 1px 3px)';
const STEEL_SHEEN = [
  'linear-gradient(112deg, transparent 18%, rgb(255 255 255 / 0.075) 27%, rgb(255 255 255 / 0.03) 33%, transparent 41%)',
  'linear-gradient(112deg, transparent 58%, rgb(255 255 255 / 0.05) 63%, transparent 69%)',
].join(', ');
const STEEL_GLOW = 'radial-gradient(closest-side, rgb(var(--st-glow) / 1), rgb(var(--st-glow) / 0.72) 22%, rgb(var(--st-glow) / 0.34) 50%, rgb(var(--st-glow) / 0.12) 76%, transparent 100%)';

/** Зразок пресета для вибору в «Вигляді»: показує справжній вигляд, а не умовну плашку. */
function swatchStyle(preset: AtmospherePreset): { attrs: { 'data-atmosphere': string }; style: CSSProperties } {
  if (preset === 'mercury') {
    return { attrs: { 'data-atmosphere': preset }, style: { backgroundColor: 'var(--field)', backgroundImage: DROP_BODY } };
  }
  if (preset === 'steel') {
    return { attrs: { 'data-atmosphere': preset }, style: { backgroundImage: `radial-gradient(circle at 100% 100%, rgb(var(--st-glow) / 0.95), transparent 64%), ${STEEL_BRUSH}, ${STEEL_BASE}` } };
  }
  return { attrs: { 'data-atmosphere': preset }, style: { background: 'conic-gradient(from 210deg, var(--atm-1), var(--atm-3), var(--atm-2), var(--atm-1))' } };
}

export function AtmosphereSwatch({ preset, className }: { preset: AtmospherePreset; className?: string }) {
  const { attrs, style } = swatchStyle(preset);
  return <span aria-hidden="true" {...attrs} className={`inline-block shrink-0 rounded-full border border-line ${className ?? 'size-7'}`} style={style} />;
}

export function Atmosphere() {
  const { atmosphere } = useTheme();
  const root = useRef<HTMLDivElement>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const metal = atmosphere === 'mercury' || atmosphere === 'steel';
  const layout = LAYOUTS[atmosphere === 'photo' || metal ? 'fog' : atmosphere];

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

  // Повільний фоновий рух лише через transform і opacity, 20–90 с, yoyo; на паузі, коли вкладка прихована; вимкнено при reduced motion.
  useGSAP(() => {
    const node = root.current;
    if (!node || !metal) return;
    const mm = matchMotion((reduced) => {
      if (reduced) return;
      const tweens: gsap.core.Tween[] = [];
      if (atmosphere === 'mercury') {
        node.querySelectorAll<HTMLElement>('[data-drop]').forEach((drop, index) => {
          const spec = DROPS[index];
          if (!spec) return;
          tweens.push(gsap.to(drop, { xPercent: spec.dx, yPercent: spec.dy, scale: spec.scale, rotation: spec.base + spec.rotate, duration: spec.duration, ease: 'sine.inOut', yoyo: true, repeat: -1 }));
        });
      } else {
        tweens.push(gsap.to(node.querySelector('[data-glow]'), { opacity: 0.72, duration: 26, ease: 'sine.inOut', yoyo: true, repeat: -1 }));
      }
      const sync = () => tweens.forEach((tween) => (document.hidden ? tween.pause() : tween.resume()));
      sync();
      document.addEventListener('visibilitychange', sync);
      return () => document.removeEventListener('visibilitychange', sync);
    });
    return () => mm.revert();
  }, { scope: root, dependencies: [atmosphere] });

  return (
    <div ref={root} className="atmosphere" aria-hidden="true">
      {atmosphere === 'mercury' ? (
        <div className="absolute inset-0">
          {DROPS.map((drop, index) => (
            <div
              key={index}
              data-drop=""
              className="absolute will-change-transform"
              style={{ left: drop.left, top: drop.top, width: drop.size, height: drop.size, borderRadius: drop.radius, background: DROP_BODY, transform: `rotate(${drop.base}deg)`, filter: 'blur(2px)', maskImage: 'radial-gradient(closest-side, #000 90%, transparent 100%)', WebkitMaskImage: 'radial-gradient(closest-side, #000 90%, transparent 100%)' }}
            />
          ))}
          <div className="atm-veil" />
        </div>
      ) : atmosphere === 'steel' ? (
        <>
          <div className="absolute inset-0" style={{ background: STEEL_BASE }} />
          <div className="absolute inset-0" style={{ background: STEEL_BRUSH }} />
          <div className="absolute inset-0" style={{ background: STEEL_SHEEN }} />
          <div className="atm-veil" />
          <div data-glow="" className="absolute will-change-[opacity]" style={{ right: '-38vmax', bottom: '-38vmax', width: '76vmax', height: '76vmax', background: STEEL_GLOW, opacity: 0.97 }} />
        </>
      ) : (
        <>
          <div className="atm-layer">
            {layout.map((blob, index) => (
              <div
                className="atm-blob"
                key={`${atmosphere}-${index}`}
                style={{ left: blob.left, top: blob.top, width: blob.size, height: `calc(${blob.size} * ${blob.stretch ?? '1'})`, background: `var(--atm-${blob.color})` }}
              />
            ))}
          </div>
          <div className="atm-layer atm-dither" style={{ background: 'linear-gradient(180deg, var(--atm-3), transparent 70%)' }} />
          <div className="atm-layer atm-vignette" />
          {atmosphere === 'photo' && photoUrl ? (
            <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${photoUrl})` }} />
          ) : null}
          {atmosphere === 'photo' && photoUrl ? <div className="absolute inset-0 bg-field opacity-40" /> : null}
        </>
      )}
    </div>
  );
}
