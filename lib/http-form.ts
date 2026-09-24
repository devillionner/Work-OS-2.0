export async function readBoundedMultipartForm(
  request: Request,
  maxBytes: number,
): Promise<FormData | Response> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
    throw new RangeError('maxBytes must be a positive safe integer.');

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data;')) {
    return Response.json(
      { error: 'Потрібен multipart/form-data.' },
      { status: 415 },
    );
  }

  const declaredText = request.headers.get('content-length');
  if (declaredText) {
    const declared = Number(declaredText);
    if (Number.isFinite(declared) && declared > maxBytes) return tooLarge();
  }

  const reader = request.body?.getReader();
  if (!reader)
    return Response.json({ error: 'Порожній запит.' }, { status: 400 });

  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      return tooLarge();
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
    return await new Response(bytes, {
      headers: { 'Content-Type': contentType },
    }).formData();
  } catch {
    return Response.json(
      { error: 'Некоректна multipart-форма.' },
      { status: 400 },
    );
  }
}

function tooLarge(): Response {
  return Response.json({ error: 'Запит із файлом завеликий.' }, { status: 413 });
}
