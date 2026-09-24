'use client';

import { History } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { APP_CHANGES, APP_RELEASE_DATE, APP_VERSION } from '@/lib/app-meta';

export function AppReleaseDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
    <DialogContent
      className="app-release-dialog duration-200 ease-out data-open:zoom-in-[0.985] data-closed:zoom-out-[0.99] data-closed:duration-150"
      style={{
        overflow: 'hidden',
        willChange: 'transform, opacity',
        animationTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
      }}
    >
      <DialogHeader>
        <DialogTitle>Що змінилося</DialogTitle>
        <DialogDescription>Коротко про те, що стало зручніше в цій версії.</DialogDescription>
      </DialogHeader>
      <div className="app-release-meta"><Badge variant="secondary">Версія {APP_VERSION}</Badge><time dateTime={APP_RELEASE_DATE}>{new Intl.DateTimeFormat('uk-UA', { dateStyle: 'long', timeZone: 'Europe/Kyiv' }).format(new Date(`${APP_RELEASE_DATE}T12:00:00Z`))}</time></div>
      <div className="app-release-scroll" style={{ minHeight: 0, maxHeight: 'min(48svh, 420px)', overflowY: 'auto', overscrollBehavior: 'contain', scrollbarGutter: 'stable' }}>
        <ul className="app-release-list">{APP_CHANGES.map((change) => <li key={change}><History aria-hidden="true" /><span>{change}</span></li>)}</ul>
      </div>
      <div className="dialog-actions"><Button variant="outline" onClick={onClose}>Закрити</Button></div>
    </DialogContent>
  </Dialog>;
}
