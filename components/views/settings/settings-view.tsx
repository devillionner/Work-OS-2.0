'use client';

import { useCallback } from 'react';
import { useCommand } from '@/components/shell/command-bus';
import { Chip } from '@/components/ui/chip';
import { AppearanceGroup } from './appearance-group';
import { DangerGroup, GoalsGroup, PlatformsGroup, ProfileGroup, ServiceGroup } from './groups';
import { PaymentsGroup } from './payments-group';

const SECTIONS = [
  ['profile', 'Профіль'],
  ['goals', 'Цілі дня'],
  ['platforms', 'Платформи'],
  ['payments', 'Оплати'],
  ['appearance', 'Вигляд'],
  ['service', 'Сервіс'],
  ['danger', 'Небезпечні дії'],
] as const;

/** «Налаштування»: згруповані списки в стилі системних; швидкий перехід до групи (`settings:section`). */
export default function SettingsView() {
  const scrollTo = useCallback((section: string) => {
    const node = document.getElementById(`settings-${section}`);
    if (!node) return;
    node.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }, []);

  useCommand('settings:section', (section) => {
    if (typeof section === 'string') window.requestAnimationFrame(() => scrollTo(section));
  });

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6 pb-10">
      <nav aria-label="Групи налаштувань" className="hide-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">
        {SECTIONS.map(([id, label]) => <Chip key={id} onClick={() => scrollTo(id)}>{label}</Chip>)}
      </nav>
      <ProfileGroup />
      <GoalsGroup />
      <PlatformsGroup />
      <PaymentsGroup />
      <AppearanceGroup />
      <ServiceGroup />
      <DangerGroup />
    </div>
  );
}
