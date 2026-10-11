'use client';

import { useEffect, useMemo, useState } from 'react';
import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Ghost } from '@/components/ui/ghost';
import { useToast } from '@/components/ui/toast';
import type { LeadDetail } from '@/lib/leads/application/queries';
import { rankLeadScripts, type LeadScriptItem } from '@/lib/leads/domain/script-match';

let scriptsCache: LeadScriptItem[] | null = null;

/** Доречні скрипти з Бібліотеки: підбір за предметом, платформою, етапом і кваліфікацією. */
export function ScriptsTab({ lead }: { lead: LeadDetail['lead'] }) {
  const toast = useToast();
  const [items, setItems] = useState<LeadScriptItem[] | null>(scriptsCache);
  const [error, setError] = useState('');

  useEffect(() => {
    if (scriptsCache) return;
    const controller = new AbortController();
    void fetch('/api/library?kind=script', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as { items?: LeadScriptItem[]; error?: string };
        if (!response.ok) throw new Error(body.error || 'Не вдалося завантажити скрипти.');
        scriptsCache = body.items ?? [];
        setItems(scriptsCache);
      })
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Не вдалося завантажити скрипти.'); });
    return () => controller.abort();
  }, []);

  const scripts = useMemo(() => rankLeadScripts(items ?? [], { platform: lead.platform, subject: lead.subject, funnelStage: lead.funnelStage, qualification: lead.qualification }), [items, lead.platform, lead.subject, lead.funnelStage, lead.qualification]);

  async function copy(text: string, title: string, language: string) {
    if (!text.trim()) return;
    if (!navigator.clipboard) { toast.push({ message: 'Браузер не дозволив автоматичне копіювання.', tone: 'hot' }); return; }
    try {
      await navigator.clipboard.writeText(text);
      toast.push({ message: `${title}: ${language} скопійовано.` });
    } catch {
      toast.push({ message: 'Не вдалося скопіювати текст.', tone: 'hot' });
    }
  }

  if (error) return <p role="alert" className="m-0 text-sm text-hot">{error}</p>;
  if (!items) return <div aria-busy="true" className="flex flex-col gap-2">{[0, 1, 2].map((item) => <Ghost key={item} className="h-14 rounded-inner" />)}</div>;
  if (!scripts.length) return <EmptyState text="У Бібліотеці ще немає відповідних скриптів." />;
  return (
    <section className="flex flex-col gap-3" aria-label="Скрипти">
      <p className="m-0 text-xs text-ink-2">Підбір за предметом, платформою, етапом і кваліфікацією. Джерело — єдина Бібліотека Work OS.</p>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {scripts.map((script) => (
          <li key={script.id} className="rounded-inner border border-line bg-sunken">
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium">
                <span className="min-w-0 truncate">{script.title}</span>
                <span className="shrink-0 text-xs font-normal text-ink-2">{script.audience === 'personal' ? 'Особистий' : 'Робочий'}</span>
              </summary>
              <div className="flex flex-col gap-3 px-4 pb-4">
                {script.notes ? <p className="m-0 text-xs text-ink-2">{script.notes}</p> : null}
                {script.ukText ? <p className="m-0 whitespace-pre-wrap text-sm">{script.ukText}</p> : null}
                {script.ruText ? <p className="m-0 whitespace-pre-wrap text-sm">{script.ruText}</p> : null}
                <div className="flex flex-wrap gap-2">
                  {script.ukText ? <Button variant="outline" size="sm" onClick={() => void copy(script.ukText, script.title, 'UA')}><Copy aria-hidden="true" strokeWidth={1.5} />Копіювати UA</Button> : null}
                  {script.ruText ? <Button variant="outline" size="sm" onClick={() => void copy(script.ruText, script.title, 'RU')}><Copy aria-hidden="true" strokeWidth={1.5} />Копіювати RU</Button> : null}
                </div>
              </div>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}
