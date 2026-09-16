'use client';
import { useEffect, useRef, useState } from 'react';
import type { LeadDetail } from '@/lib/leads/application/queries';
import { Button } from '@/components/ui/button';
import {
  Confirmation,
  EditDialog,
  Field,
  NoteField,
  SaveForm,
  SelectField,
  textValue,
  epochValue,
  datetimeValue,
} from './form';
import { displayTime, type Mutation } from './client';
export function Conversation({
  detail,
  mutate,
}: {
  detail: LeadDetail;
  mutate: Mutation;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [olderMessages, setOlderMessages] = useState<LeadDetail['messages']>([]);
  const [olderPage, setOlderPage] = useState<LeadDetail['messagesPage'] | null>(null);
  const [olderBusy, setOlderBusy] = useState(false);
  const [olderError, setOlderError] = useState('');
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const messages = [...olderMessages, ...detail.messages];
  const current = messages.find((m) => m.id === editing);
  const archived = detail.lead.archivedAt !== null;
  const [now] = useState(() => Math.floor(Date.now() / 1000));
  const page = olderPage ?? detail.messagesPage;
  const loadOlder = async () => {
    if (pending.current || !page.hasMore || !page.before) return;
    const controller = new AbortController();
    pending.current = controller;
    setOlderBusy(true);
    setOlderError('');
    try {
      const response = await fetch(
        `/api/leads/messages?id=${encodeURIComponent(detail.lead.id)}&version=${detail.lead.version}&limit=30&beforeSentAt=${page.before.sentAt}&beforeId=${encodeURIComponent(page.before.id)}`,
        { cache: 'no-store', signal: controller.signal },
      );
      const body = (await response.json()) as {
        messages?: LeadDetail['messages'];
        page?: LeadDetail['messagesPage'];
        error?: string;
      };
      if (!response.ok || !body.messages || !body.page)
        throw new Error(body.error || 'Не вдалося завантажити попередні повідомлення.');
      if (controller.signal.aborted) return;
      setOlderMessages((current) => [...body.messages!, ...current]);
      setOlderPage(body.page);
    } catch (error) {
      if (controller.signal.aborted) return;
      setOlderError(
        error instanceof Error
          ? error.message
          : 'Не вдалося завантажити попередні повідомлення.',
      );
    } finally {
      pending.current = null;
      if (!controller.signal.aborted) setOlderBusy(false);
    }
  };
  return (
    <section className="lead-panel" aria-labelledby="conversation-title">
      <div className="lead-section-head">
        <div>
          <h3 id="conversation-title">Історія спілкування</h3>
          <p className="muted-note">
            Ручні записи переписки. Повідомлення звідси не надсилаються у
            месенджери.
          </p>
        </div>
        <div className="lead-actions">
          <a
            href={`/api/leads?id=${encodeURIComponent(detail.lead.id)}&export=txt`}
            download
          >
            Експорт .txt
          </a>
          <Button
            variant="outline"
            disabled={archived}
            onClick={() => setEditing('new')}
          >
            Додати повідомлення
          </Button>
        </div>
      </div>
      {!messages.length && (
        <p className="lead-empty">Повідомлень ще немає.</p>
      )}
      {page.hasMore && page.before && (
        <div className="lead-history-more">
          <Button variant="ghost" onClick={() => void loadOlder()} disabled={olderBusy}>
            {olderBusy ? 'Завантаження…' : 'Показати попередні'}
          </Button>
          {olderError && <p className="lead-error" role="alert">{olderError}</p>}
        </div>
      )}
      <ol className="lead-messages">
        {messages.map((m) => (
          <li key={m.id} className={m.sender === 'me' ? 'from-me' : ''}>
            <div>
              <strong>{m.sender === 'lead' ? 'Лід' : 'Я'}</strong>
              <time dateTime={new Date(m.sentAt * 1000).toISOString()}>
                {displayTime(m.sentAt)} (Київ)
              </time>
            </div>
            <p className="lead-preserve">{m.body}</p>
            <div className="lead-actions">
              <Button
                variant="ghost"
                disabled={archived}
                onClick={() => setEditing(m.id)}
                aria-label={`Редагувати повідомлення від ${displayTime(m.sentAt)}`}
              >
                Редагувати
              </Button>
              <Button
                variant="ghost"
                disabled={archived}
                onClick={() => setDeleting(m.id)}
                aria-label={`Видалити повідомлення від ${displayTime(m.sentAt)}`}
              >
                Видалити
              </Button>
            </div>
          </li>
        ))}
      </ol>
      {editing && (
        <EditDialog
          title={current ? 'Редагувати повідомлення' : 'Додати повідомлення'}
          close={() => setEditing(null)}
          description="Це внутрішній запис CRM. Він не змінює реальну переписку."
        >
          <SaveForm
            cancel={() => setEditing(null)}
            save={async (f) => {
              await mutate(
                current ? 'message_update' : 'message_create',
                {
                  sender: textValue(f, 'sender'),
                  body: textValue(f, 'body'),
                  sentAt: epochValue(f, 'sentAt', current?.sentAt),
                },
                current?.id,
              );
              setEditing(null);
            }}
          >
            <SelectField
              label="Автор"
              name="sender"
              value={current?.sender ?? 'lead'}
              options={[
                { value: 'lead', label: 'Лід' },
                { value: 'me', label: 'Я' },
              ]}
            />
            <Field
              label="Час повідомлення (Київ)"
              name="sentAt"
              type="datetime-local"
              value={datetimeValue(current?.sentAt ?? now)}
              required
            />
            <NoteField
              label="Текст *"
              name="body"
              value={current?.body}
              required
            />
          </SaveForm>
        </EditDialog>
      )}
      {deleting && (
        <Confirmation
          title="Видалити повідомлення з CRM?"
          description="Повідомлення зникне з цієї історії та текстового експорту."
          close={() => setDeleting(null)}
          run={() => mutate('message_delete', {}, deleting)}
        />
      )}
    </section>
  );
}
