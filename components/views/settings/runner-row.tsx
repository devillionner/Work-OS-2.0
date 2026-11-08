'use client';

import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { subscribeLiveStatus, type LiveStatus } from '@/lib/live-channel';
import { Row } from './ui';

const REPO_URL = 'https://github.com/devillionner/Work-OS-2.0.git';
const INSTALL_COMMAND = `git clone ${REPO_URL} ~/Work-OS-2.0 && ~/Work-OS-2.0/scripts/install-runner.sh`;
const CHECK_COMMAND = '~/Work-OS-2.0/scripts/install-runner.sh --check';

/** «Runner на цьому ПК»: стан зв'язку з live-каналу (без запитів до бази) і команди встановлення та перевірки. */
export function RunnerRow() {
  const toast = useToast();
  const [status, setStatus] = useState<LiveStatus>({ connected: false, runnerConnected: null });
  useEffect(() => subscribeLiveStatus(setStatus), []);
  const state = !status.connected ? 'Зв’язок із сервером перевіряється.' : status.runnerConnected === null ? 'Стан runner ще не відомий.' : status.runnerConnected ? `Runner підключений${status.runnerVersion ? `, версія ${status.runnerVersion}` : ''}.` : 'Runner не підключений.';
  const copy = (text: string) => void navigator.clipboard.writeText(text).then(() => toast.push({ message: 'Команду скопійовано.' }));
  return (
    <Row label="Runner на цьому ПК" description={`${state} Новий ПК чи нова система: відкрий термінал і встанови одну командою; потрібен доступ до репозиторію. Інсталятор спитає про браузер, поставить Waydroid і Viber і перевірить готовність; архів зі сесіями переносить scripts/runner-backup.sh.`} stacked>
      <div className="flex w-full min-w-0 flex-col gap-2">
        {[['Встановити', INSTALL_COMMAND], ['Перевірити готовність', CHECK_COMMAND]].map(([label, command]) => (
          <div key={label} className="flex min-w-0 items-center gap-2 rounded-inner border border-line bg-sunken px-3 py-2">
            <div className="min-w-0 flex-1"><p className="m-0 text-xs text-ink-2">{label}</p><code className="block truncate font-mono text-xs" title={command}>{command}</code></div>
            <Button variant="icon" size="sm" aria-label={`Скопіювати команду: ${label}`} onClick={() => copy(command)}><Copy aria-hidden="true" strokeWidth={1.5} /></Button>
          </div>
        ))}
      </div>
    </Row>
  );
}
