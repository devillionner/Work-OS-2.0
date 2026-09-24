export async function readBoundedText(
  request: Request,
  maxBytes: number,
  tooLargeMessage = 'Запит завеликий.',
): Promise<string | Response> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
    throw new RangeError('maxBytes must be a positive safe integer.');

  const declaredText = request.headers.get('content-length');
  if (declaredText) {
    const declared = Number(declaredText);
    if (Number.isFinite(declared) && declared > maxBytes)
      return tooLarge(tooLargeMessage);
  }

  const reader = request.body?.getReader();
  if (!reader) return '';

  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // The 413 response is authoritative even if the source rejects cancellation.
      }
      return tooLarge(tooLargeMessage);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function tooLarge(message: string): Response {
  return Response.json({ error: message }, { status: 413 });
}
