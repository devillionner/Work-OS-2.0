'use client';

import { useEffect, useState } from 'react';
import { subscribeLiveStatus } from '@/lib/live-channel';

/** true, коли на живому каналі вже є знімок стану від сервера (hello); до цього картки пишуть «Оновлюю…», а не вигадують стан. */
export function useLiveSynced(): boolean {
  const [synced, setSynced] = useState(false);
  useEffect(() => subscribeLiveStatus((status) => setSynced(status.connected && status.synced === true)), []);
  return synced;
}
