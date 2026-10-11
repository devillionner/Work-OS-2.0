'use client';

import { useRef, type ReactNode } from 'react';
import { useReveal } from '@/components/motion/use-reveal';

/**
 * Екран входу й службові екрани (завантаження, помилка, ліміт D1): чорне поле, тонкі напрямні лінії,
 * величезний легкий заголовок.
 */
export function AuthScreen({ eyebrow, title, description, note, children }: { eyebrow: string; title: string; description?: ReactNode; note?: ReactNode; children?: ReactNode }) {
  const root = useRef<HTMLElement>(null);
  useReveal(root);
  return (
    <main ref={root} className="relative flex min-h-dvh flex-col justify-between overflow-hidden px-6 pb-10 pt-8 sm:px-14 sm:pt-12" aria-live="polite">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <i className="absolute inset-y-0 left-[12%] w-px bg-line" />
        <i className="absolute inset-y-0 left-[50%] w-px bg-line" />
        <i className="absolute inset-y-0 right-[12%] w-px bg-line" />
        <i className="absolute inset-x-0 top-[68%] h-px bg-line" />
      </div>
      <header data-reveal className="relative z-10 flex items-center gap-3">
        <span aria-hidden="true" className="inline-grid size-10 place-items-center rounded-full border border-line-strong text-[15px] font-medium">W</span>
        <span className="text-[15px] font-medium">Work OS</span>
      </header>
      <section className="relative z-10 flex flex-col gap-8" aria-labelledby="auth-title">
        <div className="flex flex-col gap-5">
          <p data-reveal className="m-0 text-[13px] text-ink-2">{eyebrow}</p>
          <h1 data-reveal id="auth-title" className="m-0 max-w-[14ch] text-[clamp(44px,10vw,132px)] font-light leading-[0.95] tracking-[-0.045em]">{title}</h1>
        </div>
        <div className="flex flex-col gap-6 sm:max-w-[420px]">
          {description ? <p data-reveal className="m-0 text-[15px] leading-relaxed text-ink-2">{description}</p> : null}
          {children ? <div data-reveal>{children}</div> : null}
          {note ? <p data-reveal className="m-0 text-xs text-ink-2">{note}</p> : null}
        </div>
      </section>
    </main>
  );
}
