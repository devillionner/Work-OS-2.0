import { LeadError } from '../domain/validation.ts';
import {
  readConversationExportLead,
  readConversationExportPage,
  type ConversationExportCursor,
  type ConversationExportMessage,
} from '../data/conversation-export.ts';

const PAGE_SIZE = 100;

export async function prepareConversationExport(
  db: D1Database,
  userId: string,
  leadId: string,
): Promise<{ stream: ReadableStream<Uint8Array>; name: string } | null> {
  const lead = await readConversationExportLead(db, userId, leadId);
  if (!lead) return null;
  const encoder = new TextEncoder();
  let after: ConversationExportCursor | null = null;
  let headerPending = true;
  let firstMessage = true;
  let finished = false;

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (finished) return;
      try {
        if (headerPending) {
          headerPending = false;
          controller.enqueue(
            encoder.encode(
              `Work OS — внутрішня CRM-історія\nЛід: ${lead.name}\nЧас повідомлень: UTC (ISO 8601)\n\n`,
            ),
          );
          return;
        }
        const page = await readConversationExportPage(
          db,
          userId,
          leadId,
          lead.version,
          after,
          PAGE_SIZE,
        );
        if (!page)
          throw new LeadError('Ліда не знайдено під час експорту.', 404);
        if (page.messages.length) {
          const chunk = page.messages
            .map((message) => formatExportMessage(message))
            .join('\n\n');
          controller.enqueue(
            encoder.encode(`${firstMessage ? '' : '\n\n'}${chunk}`),
          );
          firstMessage = false;
        }
        if (page.hasMore && page.after) {
          after = page.after;
          return;
        }
        finished = true;
        controller.enqueue(encoder.encode('\n'));
        controller.close();
      } catch (error) {
        finished = true;
        controller.error(error);
      }
    },
  });
  return { stream, name: lead.name };
}

function formatExportMessage(message: ConversationExportMessage) {
  const media = message.attachments
    .map(
      (attachment) =>
        `Вкладення: ${attachment.fileName} (${attachment.contentType}, ${attachment.sizeBytes} B)`,
    )
    .join('\n');
  return `[${new Date(Number(message.sentAt) * 1000).toISOString()}] ${message.sender === 'lead' ? 'Лід' : 'Я'}:\n${message.body}${media ? `\n${media}` : ''}`;
}
