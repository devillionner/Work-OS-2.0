import { Ghost } from '@/components/ui/ghost';

/** Каркас-привид на час першого завантаження знімка: точна форма майбутнього інтерфейсу, без спінера. */
export function BootSkeleton() {
  return (
    <div className="relative min-h-dvh p-3 md:h-dvh" aria-busy="true" aria-live="polite">
      <span className="sr-only">Відкриваємо Work OS</span>
      <div className="flex h-full min-h-[calc(100dvh-24px)] w-full gap-3 md:mx-auto md:max-w-[1680px] md:rounded-frame md:border md:border-line md:bg-sunken md:p-4">
        <div className="on-rail hidden w-[76px] shrink-0 rounded-panel bg-rail md:block" />
        <div className="glass flex min-w-0 flex-1 flex-col gap-3 rounded-panel p-4 md:p-6">
          <Ghost className="h-10 w-48 rounded-full" />
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
            <Ghost className="h-56 rounded-card lg:col-span-8" />
            <Ghost className="h-56 rounded-card lg:col-span-4" />
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((item) => <Ghost key={item} className="h-36 rounded-card" />)}</div>
          <Ghost className="h-48 rounded-card" />
        </div>
      </div>
    </div>
  );
}
