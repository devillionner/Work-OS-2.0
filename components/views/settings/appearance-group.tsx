'use client';

import { ImagePlus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ATMOSPHERE_PHOTO_EVENT, clearAtmospherePhoto, loadAtmospherePhoto, saveAtmospherePhoto } from '@/components/shell/atmosphere-store';
import { AtmosphereSwatch } from '@/components/shell/atmosphere';
import { PRESET_GROUPS } from '@/components/shell/atmosphere-presets';
import { useTheme, type Density } from '@/components/shell/theme-provider';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { Group, Row } from './ui';
import { humanError } from '@/components/ui/human-error';

/** Вигляд: тема, атмосфера (пресети й власне фото, що живе лише в IndexedDB цього пристрою) і щільність. */
export function AppearanceGroup() {
  const { atmosphere, setAtmosphere, density, setDensity } = useTheme();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [hasPhoto, setHasPhoto] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => { void loadAtmospherePhoto().then((blob) => setHasPhoto(blob !== null)); }, []);
  useEffect(() => {
    refresh();
    window.addEventListener(ATMOSPHERE_PHOTO_EVENT, refresh);
    return () => window.removeEventListener(ATMOSPHERE_PHOTO_EVENT, refresh);
  }, [refresh]);

  const upload = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      await saveAtmospherePhoto(file);
      setAtmosphere('photo');
      toast.push({ message: 'Фото збережено на цьому пристрої.', tone: 'ok' });
    } catch (reason) {
      toast.push({ message: humanError(reason, 'Не вдалося зберегти фото.'), tone: 'hot' });
    } finally {
      setBusy(false);
    }
  };

  const removePhoto = async () => {
    setBusy(true);
    try {
      await clearAtmospherePhoto();
      if (atmosphere === 'photo') setAtmosphere('fog');
      toast.push({ message: 'Фото видалено з цього пристрою.' });
    } catch {
      toast.push({ message: 'Не вдалося видалити фото.', tone: 'hot' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Group id="appearance" title="Вигляд" hint="Налаштування вигляду діють лише на цьому пристрої.">
      <Row label="Атмосфера" description="Тло за склом. Власне фото не залишає цей пристрій і не потрапляє в базу даних." stacked>
        {PRESET_GROUPS.map((group) => (
          <fieldset key={group.label} className="m-0 min-w-0 border-0 p-0">
            <legend className="mb-2 p-0 text-xs font-medium text-ink-2">{group.label}</legend>
            <div className="flex flex-wrap items-center gap-2">
              {group.items.map((item) => (
                <button key={item.key} type="button" aria-pressed={atmosphere === item.key} onClick={() => setAtmosphere(item.key)} className={cn('flex items-center gap-2.5 rounded-full border py-1.5 [@media(pointer:coarse)]:py-2 pl-1.5 pr-4 text-[13px] font-medium transition-colors duration-200 active:scale-[0.985]', atmosphere === item.key ? 'border-line-strong bg-raised' : 'border-line hover:bg-raised')}>
                  <AtmosphereSwatch preset={item.key} />
                  {item.label}
                </button>
              ))}
            </div>
          </fieldset>
        ))}
        {/* Власне фото: обирається, лише коли воно вже є; до того — одна дія «Завантажити фото», без неактивного пункту. */}
        <fieldset className="m-0 min-w-0 border-0 p-0">
          <legend className="mb-2 p-0 text-xs font-medium text-ink-2">Власне фото</legend>
          <div className="flex flex-wrap items-center gap-2">
            <input ref={input} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-label="Власне фото для атмосфери" onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = ''; }} />
            {hasPhoto ? (
              <>
                <button type="button" aria-pressed={atmosphere === 'photo'} onClick={() => setAtmosphere('photo')} className={cn('flex h-10 [@media(pointer:coarse)]:h-11 items-center rounded-full border px-4 text-[13px] font-medium transition-colors duration-200 active:scale-[0.985]', atmosphere === 'photo' ? 'border-line-strong bg-raised' : 'border-line hover:bg-raised')}>Моє фото</button>
                <Button variant="ghost" size="sm" busy={busy} onClick={() => input.current?.click()}>Замінити</Button>
                <Button variant="ghost" size="sm" tone="danger" disabled={busy} onClick={() => void removePhoto()}>Видалити</Button>
              </>
            ) : (
              <Button variant="outline" size="md" busy={busy} onClick={() => input.current?.click()}><ImagePlus aria-hidden="true" strokeWidth={1.5} />Завантажити фото</Button>
            )}
          </div>
        </fieldset>
      </Row>
      <Row label="Щільність">
        <Segmented<Density> label="Щільність" size="sm" value={density} onValueChange={setDensity} items={[{ value: 'comfortable', label: 'Комфортно' }, { value: 'compact', label: 'Щільно' }]} />
      </Row>
    </Group>
  );
}
