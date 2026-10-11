'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, Paperclip, Pencil, Plus, Trash2 } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import type { LeadDetail } from '@/lib/leads/application/queries';
import { cn } from '@/lib/utils';
import { Confirmation, EditDialog, Field, NoteField, SaveForm, SelectField, textValue, epochValue, datetimeValue } from './form';
import { displayTime, type Mutation } from './client';

/** Внутрішня історія спілкування: повідомлення, вкладення, довантаження старих, експорт. */
export function ConversationTab({ detail, mutate, onChanged }: { detail: LeadDetail; mutate: Mutation; onChanged: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deletingAttachment, setDeletingAttachment] = useState<{ messageId: string; attachmentId: string; fileName: string } | null>(null);
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
    mediaVersion.current = detail.lead.version;
    if (leadIdentity.current === detail.lead.id) return;
    leadIdentity.current = detail.lead.id;
    pending.current?.abort();
    pending.current = null;
    uploadTarget.current = null;
    if (fileInput.current) fileInput.current.value = '';
    queueMicrotask(() => {
      setEditing(null); setDeleting(null); setDeletingAttachment(null); setMediaError(''); setUploadingMessageId(null);
      setOlderMessages([]); setOlderPage(null); setOlderBusy(false); setOlderError('');
    });
  }, [detail.lead.id, detail.lead.version]);

  const messages = [...olderMessages, ...detail.messages];
  const current = messages.find((message) => message.id === editing);
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
      const response = await fetch(`/api/leads/messages?id=${encodeURIComponent(detail.lead.id)}&version=${detail.lead.version}&limit=30&beforeSentAt=${page.before.sentAt}&beforeId=${encodeURIComponent(page.before.id)}`, { cache: 'no-store', signal: controller.signal });
      const body = await response.json() as { messages?: LeadDetail['messages']; page?: LeadDetail['messagesPage']; error?: string };
      if (!response.ok || !body.messages || !body.page) throw new Error(body.error || 'Не вдалося завантажити попередні повідомлення.');
      if (controller.signal.aborted) return;
      setOlderMessages((existing) => [...body.messages!, ...existing]);
      setOlderPage(body.page);
    } catch (error) {
      if (!controller.signal.aborted) setOlderError(error instanceof Error ? error.message : 'Не вдалося завантажити попередні повідомлення.');
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
        if (file.size > 10 * 1024 * 1024) throw new Error(`${file.name}: максимум 10 MB.`);
        const form = new FormData();
        form.set('leadId', detail.lead.id);
        form.set('messageId', messageId);
        form.set('attachmentId', crypto.randomUUID());
        form.set('version', String(version));
        form.set('file', file);
        const response = await fetch('/api/leads/attachments', { method: 'POST', body: form });
        const body = await response.json() as { version?: number; error?: string };
        if (!response.ok || !Number.isSafeInteger(body.version)) throw new Error(body.error || 'Не вдалося прикріпити файл.');
        version = Number(body.version);
        mediaVersion.current = version;
      }
      onChanged();
    } catch (error) {
      setMediaError(error instanceof Error ? error.message : 'Не вдалося прикріпити файл.');
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
        body: JSON.stringify({ leadId: detail.lead.id, messageId: deletingAttachment.messageId, attachmentId: deletingAttachment.attachmentId, version: mediaVersion.current }),
      });
      const body = await response.json() as { version?: number; error?: string };
      if (!response.ok || !Number.isSafeInteger(body.version)) throw new Error(body.error || 'Не вдалося видалити вкладення.');
      mediaVersion.current = Number(body.version);
      setDeletingAttachment(null);
      onChanged();
    } catch (error) {
      setMediaError(error instanceof Error ? error.message : 'Не вдалося видалити вкладення.');
      onChanged();
    } finally {
      setMediaBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-4" aria-label="Розмова">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 max-w-[34ch] text-xs text-ink-2">Внутрішні записи CRM. Повідомлення зберігаються тут і не надсилаються в месенджери.</p>
        <div className="flex gap-2">
          <a href={`/api/leads?id=${encodeURIComponent(detail.lead.id)}&export=txt`} download className="inline-flex h-8 items-center gap-2 rounded-full border border-line-strong px-3.5 text-[13px] font-medium transition-colors hover:bg-raised"><Download aria-hidden="true" strokeWidth={1.5} className="size-4" />Експорт</a>
          <Button variant="action" size="sm" disabled={archived} onClick={() => setEditing('new')}><Plus aria-hidden="true" strokeWidth={1.5} />Повідомлення</Button>
        </div>
      </div>
      <input ref={fileInput} type="file" multiple hidden accept="image/jpeg,image/png,image/webp,image/gif,image/bmp,image/heic,image/heif,audio/*,video/*,application/pdf,text/plain,text/csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx" onChange={(event) => void uploadAttachments(event.currentTarget.files)} />
      {mediaError ? <p role="alert" className="m-0 text-sm text-hot">{mediaError}</p> : null}
      {!messages.length ? <EmptyState text="Повідомлень ще немає. Зафіксуй ключові деталі розмови." /> : null}
      {page.hasMore && page.before ? (
        <div className="flex flex-col items-start gap-1">
          <Button variant="ghost" size="sm" busy={olderBusy} onClick={() => void loadOlder()}>{olderBusy ? 'Завантаження…' : 'Показати попередні повідомлення'}</Button>
          {olderError ? <p role="alert" className="m-0 text-xs text-hot">{olderError}</p> : null}
        </div>
      ) : null}
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {messages.map((message) => {
          const mine = message.sender === 'me';
          return (
            <li key={message.id} className={cn('flex flex-col gap-2 rounded-inner px-4 py-3', mine ? 'ml-6 bg-raised' : 'mr-6 border border-line bg-sunken')}>
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-xs font-medium"><Avatar name={mine ? 'Я' : detail.lead.name} size={20} />{mine ? 'Я' : 'Лід'}</span>
                <time className="font-mono text-[11px] text-ink-2" dateTime={new Date(message.sentAt * 1000).toISOString()}>{displayTime(message.sentAt)}</time>
              </div>
              <p className="m-0 whitespace-pre-wrap break-words text-sm leading-relaxed">{message.body}</p>
              {message.attachments.length ? (
                <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Вкладення">
                  {message.attachments.map((attachment) => {
                    const url = `/api/leads/attachments?id=${encodeURIComponent(attachment.id)}`;
                    const image = isPreviewImage(attachment.contentType);
                    return (
                      <li key={attachment.id} className="flex items-center gap-3 rounded-inner border border-line px-3 py-2">
                        {image ? (
                          <a href={url} target="_blank" rel="noreferrer" aria-label={`Відкрити ${attachment.fileName}`} className="size-10 shrink-0 overflow-hidden rounded-field bg-sunken">
                            <span aria-hidden="true" className="block size-full bg-cover bg-center" style={{ backgroundImage: `url("${url}")` }} />
                          </a>
                        ) : null}
                        <div className="min-w-0 flex-1">
                          <a href={url} target="_blank" rel="noreferrer" download={!image} className="block truncate text-sm underline-offset-4 hover:underline">{attachment.fileName}</a>
                          <small className="text-[11px] text-ink-2">{formatFileSize(attachment.sizeBytes)} · {attachment.contentType}</small>
                        </div>
                        <Button variant="icon" size="sm" tone="danger" disabled={archived || mediaBusy} aria-label={`Видалити файл ${attachment.fileName}`} onClick={() => setDeletingAttachment({ messageId: message.id, attachmentId: attachment.id, fileName: attachment.fileName })}><Trash2 aria-hidden="true" strokeWidth={1.5} /></Button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              <div className="flex flex-wrap gap-1">
                <Button variant="ghost" size="sm" disabled={archived || mediaBusy} aria-label={`Прикріпити файл до повідомлення від ${displayTime(message.sentAt)}`} onClick={() => chooseAttachments(message.id)}><Paperclip aria-hidden="true" strokeWidth={1.5} />{mediaBusy && uploadingMessageId === message.id ? 'Додаємо…' : 'Прикріпити'}</Button>
                <Button variant="ghost" size="sm" disabled={archived} aria-label={`Редагувати повідомлення від ${displayTime(message.sentAt)}`} onClick={() => setEditing(message.id)}><Pencil aria-hidden="true" strokeWidth={1.5} />Редагувати</Button>
                <Button variant="ghost" size="sm" disabled={archived} aria-label={`Видалити повідомлення від ${displayTime(message.sentAt)}`} onClick={() => setDeleting(message.id)}><Trash2 aria-hidden="true" strokeWidth={1.5} />Видалити</Button>
              </div>
            </li>
          );
        })}
      </ol>
      {editing ? (
        <EditDialog title={current ? 'Редагувати повідомлення' : 'Додати повідомлення'} close={() => setEditing(null)} description="Це внутрішній запис CRM. Він не змінює реальну переписку.">
          <SaveForm
            cancel={() => setEditing(null)}
            save={async (f) => {
              await mutate(current ? 'message_update' : 'message_create', { sender: textValue(f, 'sender'), body: textValue(f, 'body'), sentAt: epochValue(f, 'sentAt', current?.sentAt) }, current?.id);
              setEditing(null);
            }}
          >
            <SelectField label="Автор" name="sender" value={current?.sender ?? 'lead'} options={[{ value: 'lead', label: 'Лід' }, { value: 'me', label: 'Я' }]} />
            <Field label="Час повідомлення (Київ)" name="sentAt" type="datetime-local" value={datetimeValue(current?.sentAt ?? now)} required />
            <NoteField label="Текст *" name="body" value={current?.body} required />
          </SaveForm>
        </EditDialog>
      ) : null}
      {deletingAttachment ? <Confirmation title="Видалити вкладення з CRM?" description={`Файл «${deletingAttachment.fileName}» буде видалено з цієї переписки та резервної копії.`} close={() => setDeletingAttachment(null)} run={removeAttachment} /> : null}
      {deleting ? <Confirmation title="Видалити повідомлення з CRM?" description="Повідомлення зникне з цієї історії та текстового експорту." close={() => setDeleting(null)} run={() => mutate('message_delete', {}, deleting)} /> : null}
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
