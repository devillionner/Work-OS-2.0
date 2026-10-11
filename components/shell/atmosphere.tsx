'use client';

import { useEffect, useState } from 'react';
import { ATMOSPHERE_PHOTO_EVENT, loadAtmospherePhoto } from '@/components/shell/atmosphere-store';
import { useTheme, type AtmospherePreset } from '@/components/shell/theme-provider';

type Spot = { left: string; top: string; size: string; color: 1 | 2 | 3 | 4; stretch?: string };

// Розкладка плям на пресет; кольори беруться з токенів --atm-1..4 у globals.css.
const LAYOUTS: Record<Exclude<AtmospherePreset, 'photo'>, Spot[]> = {
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

export function Atmosphere() {
  const { atmosphere } = useTheme();
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const layout = LAYOUTS[atmosphere === 'photo' ? 'fog' : atmosphere];

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

  return (
    <div className="atmosphere" aria-hidden="true">
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
      <div className="atm-tint" />
    </div>
  );
}
