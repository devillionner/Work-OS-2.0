import { env } from 'cloudflare:workers';
import { authorizeUrl, encodeTransaction, pkceChallenge, randomValue, redirectUri, transactionCookie } from '@/lib/google-oauth';

/** Початок входу перенаправленням: state, code_verifier і nonce лягають у короткоживучу HttpOnly cookie, далі редірект на Google. */
export async function GET(request: Request): Promise<Response> {
  const origin = new URL(request.url).origin;
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return Response.redirect(`${origin}/?auth_error=not_configured`, 302);
  const transaction = { state: randomValue(), verifier: randomValue(48), nonce: randomValue() };
  const location = authorizeUrl({
    clientId: env.GOOGLE_CLIENT_ID, redirect: redirectUri(request.url), state: transaction.state, nonce: transaction.nonce,
    challenge: await pkceChallenge(transaction.verifier),
  });
  const secure = new URL(request.url).protocol === 'https:';
  return new Response(null, { status: 302, headers: { Location: location, 'Set-Cookie': transactionCookie(encodeTransaction(transaction), secure), 'Cache-Control': 'no-store' } });
}
