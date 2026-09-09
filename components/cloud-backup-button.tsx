'use client';

import { useState } from 'react';
import { CheckCircle2, Download, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Manifest = {
  app: string; schemaVersion: number; ownerId: string; revision: number; ownerEmail: string; createdAt: string;
  tables: string[]; counts: Record<string, number>;
};

export function CloudBackupButton() {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const download = async () => {
    if (busy) return;
    setBusy(true); setDone(false); setError(''); setProgress(0);
    try {
      const manifest = await getJson<Manifest>('/api/backups/export');
      const tables: Record<string, unknown[]> = {};
      let completedTables = 0;
      for (const table of manifest.tables) {
        const rows: unknown[] = [];
        let cursor = '';
        do {
          const page = await getJson<{ rows: unknown[]; nextCursor: string | null }>(`/api/backups/export?table=${encodeURIComponent(table)}&cursor=${encodeURIComponent(cursor)}&revision=${manifest.revision}`);
          rows.push(...page.rows);
          cursor = page.nextCursor || '';
        } while (cursor);
        if (rows.length !== manifest.counts[table]) throw new Error('Неповна резервна копія. Спробуйте ще раз.');
        tables[table] = rows;
        completedTables += 1;
        setProgress(Math.round(completedTables / manifest.tables.length * 90));
      }
      const final = await getJson<Manifest>('/api/backups/export');
      if (final.revision !== manifest.revision) throw new Error('Дані змінилися під час копіювання. Спробуйте ще раз.');
      const payload = JSON.stringify({
        app: manifest.app, schemaVersion: manifest.schemaVersion, createdAt: manifest.createdAt,
        ownerEmail: manifest.ownerEmail, ownerId: manifest.ownerId, revision: manifest.revision, counts: manifest.counts, tables,
      });
      const bytes = new TextEncoder().encode(payload);
      const hash = await sha256Hex(bytes);
      await postAudit(hash, bytes.byteLength, manifest.counts, manifest.revision);
      setProgress(100);
      saveFile(payload, `work-os-backup_${manifest.createdAt.slice(0, 10)}_${manifest.createdAt.slice(11, 19).replaceAll(':', '-')}.json`);
      setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не вдалося створити резервну копію.');
    } finally { setBusy(false); }
  };

  return <div className="cloud-backup-action">
    <Button variant="outline" type="button" onClick={() => void download()} disabled={busy}>
      {busy ? <><LoaderCircle className="is-spinning" />Копіюємо {progress}%</> : done ? <><CheckCircle2 />Копію збережено</> : <><Download />Створити резервну копію</>}
    </Button>
    {error && <small role="alert">{error}</small>}
  </div>;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' });
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(result.error || 'Помилка отримання даних.');
  return result;
}
async function postAudit(sha256: string, byteSize: number, counts: Record<string, number>, revision: number) {
  const response = await fetch('/api/backups/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sha256, byteSize, counts, revision }) });
  if (!response.ok) { const result = await response.json() as { error?: string }; throw new Error(result.error || 'Не вдалося підтвердити копію.'); }
}
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
function saveFile(payload: string, filename: string) {
  const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

