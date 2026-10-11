'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { humanError } from '@/components/ui/human-error';

type Manifest = { app: string; schemaVersion: number; ownerId: string; revision: number; ownerEmail: string; createdAt: string; tables: string[]; counts: Record<string, number> };

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' });
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(result.error || 'Помилка отримання даних.');
  return result;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function saveFile(payload: string, filename: string) {
  const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Переносна резервна копія: таблиці читаються сторінками, звіряються з ревізією й зберігаються файлом. */
export function BackupButton({ onComplete, label = 'Створити резервну копію' }: { onComplete?: () => void; label?: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  const download = async () => {
    if (busy) return;
    setBusy(true);
    setProgress(0);
    try {
      const manifest = await getJson<Manifest>('/api/backups/export');
      const tables: Record<string, unknown[]> = {};
      let completed = 0;
      for (const table of manifest.tables) {
        const rows: unknown[] = [];
        let cursor = '';
        do {
          const page = await getJson<{ rows: unknown[]; nextCursor: string | null }>(`/api/backups/export?table=${encodeURIComponent(table)}&cursor=${encodeURIComponent(cursor)}&revision=${manifest.revision}`);
          rows.push(...page.rows);
          cursor = page.nextCursor || '';
        } while (cursor);
        if (rows.length !== manifest.counts[table]) throw new Error('Неповна резервна копія. Спробуй ще раз.');
        tables[table] = rows;
        completed += 1;
        setProgress(Math.round((completed / manifest.tables.length) * 90));
      }
      const final = await getJson<Manifest>('/api/backups/export');
      if (final.revision !== manifest.revision) throw new Error('Дані змінилися під час копіювання. Спробуй ще раз.');
      const payload = JSON.stringify({ app: manifest.app, schemaVersion: manifest.schemaVersion, createdAt: manifest.createdAt, ownerEmail: manifest.ownerEmail, ownerId: manifest.ownerId, revision: manifest.revision, counts: manifest.counts, tables });
      const bytes = new TextEncoder().encode(payload);
      const hash = await sha256Hex(bytes);
      const audit = await fetch('/api/backups/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sha256: hash, byteSize: bytes.byteLength, counts: manifest.counts, revision: manifest.revision }) });
      if (!audit.ok) {
        const result = await audit.json().catch(() => ({})) as { error?: string };
        throw new Error(result.error || 'Не вдалося підтвердити копію.');
      }
      setProgress(100);
      saveFile(payload, `work-os-backup_${manifest.createdAt.slice(0, 10)}_${manifest.createdAt.slice(11, 19).replaceAll(':', '-')}.json`);
      toast.push({ message: 'Резервну копію збережено файлом.', tone: 'ok' });
      onComplete?.();
    } catch (cause) {
      toast.push({ message: humanError(cause, 'Не вдалося створити резервну копію.'), tone: 'hot', duration: 7000 });
    } finally {
      setBusy(false);
    }
  };

  return <Button variant="outline" size="sm" busy={busy} onClick={() => void download()}>{busy ? `Копіюємо ${progress}%` : label}</Button>;
}
