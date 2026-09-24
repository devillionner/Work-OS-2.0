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
  onChanged,
}: {
  detail: LeadDetail;
  mutate: Mutation;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deletingAttachment, setDeletingAttachment] = useState<{
    messageId: string;
    attachmentId: string;
    fileName: string;
  } | null>(null);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaError, setMediaError] = useState('');
  const [uploadingMessageId, setUploadingMessageId] = useState<string | null>(null);
  const mediaVersion = useRef(detail.lead.version);
  const leadIdentity = useRef(detail.lead.id);
  const uploadTarget = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [olderMessages, setOlderMessages] = useState<LeadDetail['messages']>([]);
  const [olderPage, setOlderPage] = useState<LeadDetail['messagesPage'] | null>(null);
  const [olderBusy, setOlderBusy] = useState(false);
  const [olderError, setOlderError] = useState('');
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => {
    mediaVersion.current=detail.lead.version;
    if(leadIdentity.current===detail.lead.id)return;
    leadIdentity.current=detail.lead.id;
    pending.current?.abort();
    pending.current=null;
    setEditing(null);
    setDeleting(null);
    setDeletingAttachment(null);
    setMediaError('');
    setUploadingMessageId(null);
    setOlderMessages([]);
    setOlderPage(null);
    setOlderBusy(false);
    setOlderError('');
    uploadTarget.current=null;
    if(fileInput.current)fileInput.current.value='';
  },[detail.lead.id,detail.lead.version]);
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
  const chooseAttachments = (messageId: string) => {
    if (archived || mediaBusy) return;
    uploadTarget.current = messageId;
    setMediaError('');
    fileInput.current?.click();
  };
  const uploadAttachments = async (files: FileList | null) => {
    const messageId = uploadTarget.current;
    if (!messageId || !files?.length) return;
    setMediaBusy(true);
    setMediaError('');
    let version = mediaVersion.current;
    setUploadingMessageId(messageId);
    try {
      for (const file of Array.from(files)) {
        if (file.size > 10 * 1024 * 1024)
          throw new Error(`${file.name}: максимум 10 MB.`);
        const form = new FormData();
        form.set('leadId', detail.lead.id);
        form.set('messageId', messageId);
        form.set('attachmentId', crypto.randomUUID());
        form.set('version', String(version));
        form.set('file', file);
        const response = await fetch('/api/leads/attachments', {
          method: 'POST',
          body: form,
        });
        const body = (await response.json()) as { version?: number; error?: string };
        if (!response.ok || !Number.isSafeInteger(body.version))
          throw new Error(body.error || 'Не вдалося прикріпити файл.');
        version = Number(body.version);
        mediaVersion.current = version;
      }
      onChanged();
    } catch (error) {
      setMediaError(
        error instanceof Error ? error.message : 'Не вдалося прикріпити файл.',
      );
      onChanged();
    } finally {
      setMediaBusy(false);
      setUploadingMessageId(null);
      uploadTarget.current = null;
      if (fileInput.current) fileInput.current.value = '';
    }
  };
  const removeAttachment = async () => {
    if (!deletingAttachment || mediaBusy) return;
    setMediaBusy(true);
    setMediaError('');
    try {
      const response = await fetch('/api/leads/attachments', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId: detail.lead.id,
          messageId: deletingAttachment.messageId,
          attachmentId: deletingAttachment.attachmentId,
          version: mediaVersion.current,
        }),
      });
      const body = (await response.json()) as { version?: number; error?: string };
      if (!response.ok || !Number.isSafeInteger(body.version))
        throw new Error(body.error || 'Не вдалося видалити вкладення.');
      mediaVersion.current = Number(body.version);
      setDeletingAttachment(null);
      onChanged();
    } catch (error) {
      setMediaError(
        error instanceof Error ? error.message : 'Не вдалося видалити вкладення.',
      );
      onChanged();
    } finally {
      setMediaBusy(false);
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
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        accept="image/jpeg,image/png,image/webp,image/gif,image/bmp,image/heic,image/heif,audio/*,video/*,application/pdf,text/plain,text/csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
        onChange={(event) => void uploadAttachments(event.currentTarget.files)}
      />
      {mediaError && <p className="lead-error" role="alert">{mediaError}</p>}
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
            {!!m.attachments.length && (
              <ul className="lead-attachments" aria-label="Вкладення">
                {m.attachments.map((attachment) => {
                  const url = `/api/leads/attachments?id=${encodeURIComponent(attachment.id)}`;
                  return (
                    <li key={attachment.id}>
                      {isPreviewImage(attachment.contentType) && (
                        <a href={url} target="_blank" rel="noreferrer" className="lead-attachment-preview" aria-label={`Відкрити ${attachment.fileName}`}>
                          <span
                            className="lead-attachment-preview-image"
                            aria-hidden="true"
                            style={{ backgroundImage: `url("${url}")` }}
                          />
                        </a>
                      )}
                      <div>
                        <a href={url} target="_blank" rel="noreferrer" download={!isPreviewImage(attachment.contentType)}>
                          {attachment.fileName}
                        </a>
                        <small>{formatFileSize(attachment.sizeBytes)} · {attachment.contentType}</small>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={archived || mediaBusy}
                        onClick={() => setDeletingAttachment({
                          messageId: m.id,
                          attachmentId: attachment.id,
                          fileName: attachment.fileName,
                        })}
                      >
                        Видалити файл
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="lead-actions">
              <Button
                type="button"
                variant="ghost"
                disabled={archived || mediaBusy}
                onClick={() => chooseAttachments(m.id)}
                aria-label={`Прикріпити файл до повідомлення від ${displayTime(m.sentAt)}`}
              >
                {mediaBusy && uploadingMessageId === m.id ? 'Додаємо…' : 'Прикріпити файл'}
              </Button>
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
      {deletingAttachment && (
        <Confirmation
          title="Видалити вкладення з CRM?"
          description={`Файл «${deletingAttachment.fileName}» буде видалено з цієї переписки та резервної копії.`}
          close={() => setDeletingAttachment(null)}
          run={removeAttachment}
        />
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

function isPreviewImage(contentType: string) {
  return ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp'].includes(contentType);
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
