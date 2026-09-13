export const DEFAULT_JSON_MAX_BYTES = 64 * 1024;

type JsonObject = Record<string, unknown>;

export async function readJsonObject(
  request: Request,
  maxBytes = DEFAULT_JSON_MAX_BYTES,
): Promise<JsonObject | Response> {
  if (!isJsonContentType(request.headers.get('content-type'))) {
    return Response.json({ error: 'Очікується JSON-запит.' }, { status: 415 });
  }
  const declared = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > maxBytes) return tooLarge();
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) return tooLarge();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return Response.json({ error: 'Некоректний JSON.' }, { status: 400 });
    }
    return parsed as JsonObject;
  } catch {
    return Response.json({ error: 'Некоректний JSON.' }, { status: 400 });
  }
}

export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return Boolean(origin && origin === new URL(request.url).origin);
}

export function isJsonContentType(value: string | null): boolean {
  return Boolean(value && /^application\/json(?:\s*;|$)/i.test(value));
}

function tooLarge(): Response {
  return Response.json({ error: 'Запит завеликий.' }, { status: 413 });
}
