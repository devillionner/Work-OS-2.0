import { LeadError } from '../domain/validation.ts';
export function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}
export function errorResponse(error: unknown): Response {
  if (error instanceof LeadError)
    return json({ error: error.message, details: error.details }, error.status);
  console.error(
    'Leads request failed',
    error instanceof Error ? error.name : 'unknown',
  );
  return json(
    { error: 'Не вдалося зберегти або завантажити дані. Спробуйте ще раз.' },
    500,
  );
}
export async function commandBody(request: Request): Promise<unknown> {
  if (request.headers.get('origin') !== new URL(request.url).origin)
    throw new LeadError('Недійсне джерело запиту.', 403);
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new LeadError('Потрібен JSON.', 415);
  // Bound streaming body allocation, including chunked requests without Content-Length.
  const reader = request.body?.getReader();
  if (!reader) throw new LeadError('Порожній запит.');
  let length = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 65536) {
      await reader.cancel();
      throw new LeadError('Запит завеликий.', 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new LeadError('Некоректний JSON.');
  }
}
