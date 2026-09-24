import { LeadError } from '../domain/validation.ts';

export type ConversationExportLead = {
  id: string;
  name: string;
  version: number;
};

export type ConversationExportAttachment = {
  id: string;
  messageId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
};

export type ConversationExportMessage = {
  id: string;
  sender: 'lead' | 'me';
  body: string;
  sentAt: number;
  attachments: ConversationExportAttachment[];
};

export type ConversationExportCursor = {
  sentAt: number;
  id: string;
};

export type ConversationExportPage = {
  messages: ConversationExportMessage[];
  hasMore: boolean;
  after: ConversationExportCursor | null;
};

export async function readConversationExportLead(
  db: D1Database,
  userId: string,
  leadId: string,
): Promise<ConversationExportLead | null> {
  return db
    .prepare(
      'SELECT id,name,version FROM leads WHERE id=?1 AND user_id=?2 LIMIT 1',
    )
    .bind(leadId, userId)
    .first<ConversationExportLead>();
}

export async function readConversationExportPage(
  db: D1Database,
  userId: string,
  leadId: string,
  version: number,
  after: ConversationExportCursor | null,
  limit = 100,
): Promise<ConversationExportPage | null> {
  const boundedLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
  const cursorSql = after ? 'AND (sent_at,id)>(?4,?5)' : '';
  const messageArgs = [
    leadId,
    userId,
    boundedLimit + 1,
    ...(after ? [after.sentAt, after.id] : []),
  ] as const;
  const [leadResult, messagesResult, attachmentsResult] = await db.batch([
    db
      .prepare('SELECT id,version FROM leads WHERE id=?1 AND user_id=?2 LIMIT 1')
      .bind(leadId, userId),
    db
      .prepare(
        `SELECT id,sender,body,sent_at AS sentAt FROM lead_messages
         WHERE lead_id=?1 AND user_id=?2 AND deleted_at IS NULL ${cursorSql}
         ORDER BY sent_at,id LIMIT ?3`,
      )
      .bind(...messageArgs),
    db
      .prepare(
        `SELECT a.id,a.message_id AS messageId,a.file_name AS fileName,
          a.content_type AS contentType,a.size_bytes AS sizeBytes
         FROM lead_message_attachments a
         WHERE a.lead_id=?1 AND a.user_id=?2
           AND a.message_id IN (
             SELECT id FROM lead_messages
             WHERE lead_id=?1 AND user_id=?2 AND deleted_at IS NULL ${cursorSql}
             ORDER BY sent_at,id LIMIT ?3
           )
         ORDER BY a.created_at,a.id`,
      )
      .bind(...messageArgs),
  ]);
  const lead = leadResult.results[0] as { id: string; version: number } | undefined;
  if (!lead) return null;
  if (Number(lead.version) !== version)
    throw new LeadError(
      'Переписку змінено під час експорту. Запустіть експорт ще раз.',
      409,
    );
  const rows = messagesResult.results as Array<Omit<ConversationExportMessage, 'attachments'>>;
  const attachmentRows = attachmentsResult.results as ConversationExportAttachment[];
  const messages = rows.slice(0, boundedLimit).map((message) => ({
    ...message,
    attachments: attachmentRows
      .filter((attachment) => attachment.messageId === message.id)
      .map((attachment) => ({
        ...attachment,
        sizeBytes: Number(attachment.sizeBytes),
      })),
  }));
  const hasMore = rows.length > boundedLimit;
  const last = messages[messages.length - 1];
  return {
    messages,
    hasMore,
    after: hasMore && last ? { sentAt: Number(last.sentAt), id: last.id } : null,
  };
}
