'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { LeadDetail } from '@/lib/leads/application/queries';
import {
  rankLeadScripts,
  type LeadScriptItem,
} from '@/lib/leads/domain/script-match';

export function LeadScripts({ lead }: { lead: LeadDetail['lead'] }) {
  const [items, setItems] = useState<LeadScriptItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void fetch('/api/library?kind=script', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as { items?: LeadScriptItem[]; error?: string };
        if (!response.ok) throw new Error(body.error || 'Не вдалося завантажити скрипти.');
        setItems(body.items ?? []);
        setError('');
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Не вдалося завантажити скрипти.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const scripts = useMemo(() => rankLeadScripts(items, {
    platform: lead.platform,
    subject: lead.subject,
    funnelStage: lead.funnelStage,
    qualification: lead.qualification,
  }), [items, lead.platform, lead.subject, lead.funnelStage, lead.qualification]);

  async function copy(text: string, title: string, language: string) {
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
    setNotice(`${title}: ${language} скопійовано.`);
  }

  return (
    <section className="lead-panel" aria-labelledby="lead-scripts-heading">
      <div className="lead-section-head">
        <div>
          <p className="eyebrow">Бібліотека</p>
          <h3 id="lead-scripts-heading">Доречні скрипти</h3>
        </div>
        <Badge variant="outline">{scripts.length}</Badge>
      </div>
      <p className="muted-note">Підбір за предметом, платформою, етапом і кваліфікацією. Джерело — єдина Бібліотека Work OS.</p>
      {error ? <p className="lead-error" role="alert">{error}</p> : loading ? <output>Завантаження скриптів…</output> : scripts.length ? (
        <ul className="lead-simple-list">
          {scripts.map((script) => (
            <li key={script.id}>
              <details>
                <summary>
                  <strong>{script.title}</strong>{' '}
                  <Badge variant="outline">{script.audience === 'personal' ? 'Особистий' : 'Робочий'}</Badge>
                </summary>
                {script.notes && <p>{script.notes}</p>}
                {script.ukText && <p className="lead-preserve">{script.ukText}</p>}
                {script.ruText && <p className="lead-preserve">{script.ruText}</p>}
                <div className="lead-actions">
                  {script.ukText && <Button size="sm" variant="outline" onClick={() => void copy(script.ukText, script.title, 'UA')}>Копіювати UA</Button>}
                  {script.ruText && <Button size="sm" variant="outline" onClick={() => void copy(script.ruText, script.title, 'RU')}>Копіювати RU</Button>}
                </div>
              </details>
            </li>
          ))}
        </ul>
      ) : <p className="lead-empty">У Бібліотеці ще немає відповідних скриптів.</p>}
      {notice && <output>{notice}</output>}
    </section>
  );
}
