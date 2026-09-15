export const AUDIT_STAGING_HOST = 'work-os-2-staging.devillionner.workers.dev';

export function isAuditAccessHost(input: string | URL): boolean {
  const url = typeof input === 'string' ? new URL(input) : input;
  return url.protocol === 'https:' && url.hostname === AUDIT_STAGING_HOST && (!url.port || url.port === '443');
}

export async function secureTokenEqual(provided: string, expected: string): Promise<boolean> {
  if (!provided || !expected) return false;
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  const left = new Uint8Array(providedHash);
  const right = new Uint8Array(expectedHash);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}
