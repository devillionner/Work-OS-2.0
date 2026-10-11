'use client';

import { Panel } from '@/components/shell/panel';
import { APP_CHANGES, APP_RELEASE_DATE, APP_VERSION } from '@/lib/app-meta';

/** Що змінилося у версії: версія, дата й короткі пункти простою мовою. */
export function ReleasePanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const date = new Intl.DateTimeFormat('uk-UA', { dateStyle: 'long', timeZone: 'Europe/Kyiv' }).format(new Date(`${APP_RELEASE_DATE}T12:00:00Z`));
  return (
    <Panel open={open} onOpenChange={onOpenChange} title="Що змінилося" subtitle={`Версія ${APP_VERSION} · ${date}`}>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {APP_CHANGES.map((change) => (
          <li key={change} className="rounded-inner border border-line bg-sunken px-4 py-3 text-sm leading-relaxed">{change}</li>
        ))}
      </ul>
    </Panel>
  );
}
