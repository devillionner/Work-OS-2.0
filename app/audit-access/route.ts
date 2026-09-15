import { env } from 'cloudflare:workers';
import { createSession, sessionCookie } from '@/lib/auth';
import { isAuditAccessHost, secureTokenEqual } from '@/lib/audit-access';
import { sameOrigin } from '@/lib/http-json';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  if (!enabled(request)) return notFound();
  const failed = new URL(request.url).searchParams.get('error') === '1';
  return new Response(page(failed), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  if (!enabled(request)) return notFound();
  if (!sameOrigin(request)) return new Response('Forbidden', { status: 403 });
  const type = request.headers.get('content-type') || '';
  if (!type.toLowerCase().startsWith('application/x-www-form-urlencoded')) {
    return new Response('Unsupported Media Type', { status: 415 });
  }
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > 2048) return new Response('Request too large', { status: 413 });
  const form = new URLSearchParams(await request.text());
  const token = (form.get('token') || '').trim();
  if (token.length > 256 || !(await secureTokenEqual(token, env.AUDIT_ACCESS_TOKEN || ''))) {
    return redirect(request, '/audit-access?error=1');
  }
  const ownerEmail = (env.OWNER_EMAIL || '').trim().toLowerCase();
  if (!ownerEmail) return new Response('Audit owner is not configured.', { status: 503 });
  const owner = await env.DB.prepare('SELECT id FROM users WHERE lower(email)=?1 LIMIT 1')
    .bind(ownerEmail)
    .first<{ id: string }>();
  if (!owner) return new Response('Staging owner is not initialized.', { status: 409 });
  const sessionToken = await createSession(owner.id);
  const response = redirect(request, '/');
  response.headers.set('Set-Cookie', sessionCookie(sessionToken, true));
  return response;
}

function enabled(request: Request): boolean {
  return isAuditAccessHost(request.url) && Boolean(env.AUDIT_ACCESS_TOKEN);
}

function redirect(request: Request, path: string): Response {
  return new Response(null, { status: 303, headers: { Location: new URL(path, request.url).toString() } });
}

function notFound(): Response {
  return new Response('Not Found', { status: 404 });
}

function page(failed: boolean): string {
  const error = failed ? '<p class="error" role="alert">Невірний або вже змінений код аудиту.</p>' : '';
  return `<!doctype html><html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Work OS · Audit access</title><style>html{background:#f5f6f8;color:#17191e;font-family:system-ui,sans-serif}body{min-height:100vh;margin:0;display:grid;place-items:center;padding:24px}.card{width:min(420px,100%);box-sizing:border-box;background:#fff;border:1px solid #dfe2e8;border-radius:18px;padding:28px;box-shadow:0 24px 70px rgba(25,31,48,.12)}h1{margin:0 0 8px;font-size:28px}p{color:#69707d;line-height:1.5}.error{color:#b42318}label{display:grid;gap:8px;font-weight:700}input,button{min-height:46px;border-radius:10px;font:inherit}input{border:1px solid #dfe2e8;padding:0 12px}button{margin-top:14px;width:100%;border:0;background:#3157f6;color:#fff;font-weight:750;cursor:pointer}</style></head><body><main class="card"><h1>Audit access</h1><p>Тимчасовий вхід лише для UI/UX-аудиту staging.</p>${error}<form method="post" action="/audit-access" autocomplete="off"><label>Код аудиту<input name="token" type="password" required maxlength="256" autocomplete="off" autofocus></label><button type="submit">Увійти в staging</button></form></main></body></html>`;
}
