'use client';

import { History } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { APP_CHANGES, APP_RELEASE_DATE, APP_VERSION } from '@/lib/app-meta';

export function AppReleaseDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
    <DialogContent className="app-release-dialog">
      <DialogHeader>
        <DialogTitle>Що змінилося</DialogTitle>
        <DialogDescription>Короткі нотатки поточного релізу Work OS.</DialogDescription>
      </DialogHeader>
      <div className="app-release-meta"><Badge variant="secondary">Версія {APP_VERSION}</Badge><time dateTime={APP_RELEASE_DATE}>11 вересня 2026</time></div>
      <ul className="app-release-list">{APP_CHANGES.map((change) => <li key={change}><History aria-hidden="true" /><span>{change}</span></li>)}</ul>
      <div className="dialog-actions"><Button variant="outline" onClick={onClose}>Закрити</Button></div>
    </DialogContent>
  </Dialog>;
}
