'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/toggle';
import { useToast } from '@/components/ui/toast';
import { humanError } from '@/components/ui/human-error';
import { Group, Row } from './ui';

type PushInfo = { publicKey: string; configured: boolean; devices: number; endpoints: string[] };

function keyBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) out[index] = raw.charCodeAt(index);
  return out;
}

async function postPush(body: Record<string, unknown>) {
  const response = await fetch('/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({})) as { error?: string; devices?: number; delivered?: number };
  if (!response.ok) throw new Error(data.error || 'Не вдалося виконати дію.');
  return data;
}

/** «Сповіщення на телефон»: Web Push у PWA. Підписка живе в браузері пристрою, а сервер зберігає лише ключі для шифрування. */
export function PushGroup() {
  const toast = useToast();
  const [supported, setSupported] = useState<boolean | null>(null);
  const [info, setInfo] = useState<PushInfo | null>(null);
  const [here, setHere] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const capable = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    setSupported(capable);
    try {
      const response = await fetch('/api/push', { cache: 'no-store' });
      if (!response.ok) return;
      const next = await response.json() as PushInfo;
      setInfo(next);
      if (capable) {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        setHere(Boolean(subscription && next.endpoints.includes(subscription.endpoint)));
      }
    } catch { /* без мережі сторінка просто не знає стану */ }
  }, []);
  useEffect(() => { const timer = setTimeout(() => void refresh(), 0); return () => clearTimeout(timer); }, [refresh]);

  async function toggle(checked: boolean) {
    if (!info) return;
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      if (checked) {
        if (await Notification.requestPermission() !== 'granted') throw new Error('Браузер не дав дозволу на сповіщення. Дозвіл змінюється в налаштуваннях сайту.');
        const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(info.publicKey) });
        await postPush({ action: 'subscribe', subscription: subscription.toJSON() });
        toast.push({ message: 'Сповіщення на цей пристрій увімкнено.', tone: 'ok' });
      } else {
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) { await postPush({ action: 'unsubscribe', endpoint: subscription.endpoint }); await subscription.unsubscribe(); }
        toast.push({ message: 'Сповіщення на цей пристрій вимкнено.' });
      }
      await refresh();
    } catch (reason) { toast.push({ message: humanError(reason, 'Не вдалося змінити сповіщення.'), tone: 'hot' }); }
    finally { setBusy(false); }
  }

  async function test() {
    setBusy(true);
    try { await postPush({ action: 'test' }); toast.push({ message: 'Пробне сповіщення надіслано.', tone: 'ok' }); }
    catch (reason) { toast.push({ message: humanError(reason, 'Не вдалося надіслати пробне сповіщення.'), tone: 'hot' }); }
    finally { setBusy(false); }
  }

  const unavailable = supported === false;
  const unconfigured = info !== null && !info.configured;
  return (
    <Group id="push" title="Сповіщення на телефон" hint="Приходять не частіше разу на 30 хв на одну причину й не вночі (22:00–08:00). На iPhone працює лише для застосунку, доданого на головний екран: у Safari «Поділитися» → «На початковий екран», далі відкрий його звідти й увімкни перемикач.">
      <Row
        label="Сповіщати на цей пристрій"
        description={unavailable ? 'Цей браузер не вміє сповіщення. На iPhone додай Work OS на головний екран і відкрий звідти.' : unconfigured ? 'Сервер ще без ключа сповіщень.' : 'Runner вимкнений понад 10 хв, вихід із WhatsApp чи Telegram Web, партія стоїть понад 15 хв, партія завершилась.'}
      >
        <Switch aria-label="Сповіщати на цей пристрій" checked={here} disabled={busy || unavailable || unconfigured || info === null} onCheckedChange={(checked) => void toggle(checked)} />
      </Row>
      {here ? <Row label="Пробне сповіщення" description={`Пристроїв підключено: ${info?.devices ?? 0}.`}><Button variant="outline" size="sm" disabled={busy} onClick={() => void test()}>Надіслати</Button></Row> : null}
    </Group>
  );
}
