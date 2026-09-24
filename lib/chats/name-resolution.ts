import { cleanChatName, normalizeGroupLink, suggestedChatName, type ChatPlatform } from './bulk-input.ts';

export type ChatNameResolution = {
  name: string;
  platform: Extract<ChatPlatform, 'telegram' | 'whatsapp' | 'viber' | 'facebook'>;
  source: 'og:title' | 'title';
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const MAX_HTML_BYTES = 256 * 1024;
const TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 3;

export async function resolveChatName(link: string, fetcher: FetchLike = fetch): Promise<ChatNameResolution | null> {
  const parsed = normalizeGroupLink(link);
  if (!parsed || !['telegram', 'whatsapp', 'viber', 'facebook'].includes(parsed.platform)) return null;
  const platform = parsed.platform as ChatNameResolution['platform'];
  const html = await readSafeHtml(parsed.link, platform, fetcher);
  if (!html) return null;

  const candidates: Array<{ source: ChatNameResolution['source']; value: string | null }> = [
    { source: 'og:title', value: metaContent(html, 'og:title') },
    { source: 'title', value: titleContent(html) },
  ];
  for (const candidate of candidates) {
    const name = normalizeResolvedName(candidate.value || '', platform);
    if (name) return { name, platform, source: candidate.source };
  }
  return null;
}

export function isGeneratedChatName(name: string, link: string): boolean {
  const parsed = normalizeGroupLink(link);
  if (!parsed) return !cleanChatName(name);
  return normalizeName(name) === normalizeName(suggestedChatName(parsed));
}

export function shouldAutoApplyResolvedName(currentName: string, link: string, resolvedName: string): boolean {
  const current = cleanChatName(currentName);
  const resolved = cleanChatName(resolvedName);
  if (!resolved || normalizeName(current) === normalizeName(resolved)) return false;
  return !current || isGeneratedChatName(current, link);
}

async function readSafeHtml(link: string, platform: ChatNameResolution['platform'], fetcher: FetchLike): Promise<string | null> {
  let current = link;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    if (!allowedResolverUrl(current, platform)) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetcher(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { Accept: 'text/html,application/xhtml+xml' },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location || redirect === MAX_REDIRECTS) return null;
        try { current = new URL(location, current).toString(); }
        catch { return null; }
        continue;
      }
      if (!response.ok) return null;
      const contentType = response.headers.get('content-type') || '';
      if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) return null;
      const declared = Number(response.headers.get('content-length') || 0);
      if (declared > MAX_HTML_BYTES) return null;
      return await readBoundedText(response, MAX_HTML_BYTES);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

async function readBoundedText(response: Response, limit: number): Promise<string | null> {
  if (!response.body) {
    const text = await response.text();
    return new TextEncoder().encode(text).byteLength <= limit ? text : null;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } catch {
    try { await reader.cancel(); } catch { /* ignore */ }
    return null;
  }
}

function allowedResolverUrl(value: string, platform: ChatNameResolution['platform']): boolean {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const allowed: Record<ChatNameResolution['platform'], Set<string>> = {
    telegram: new Set(['t.me', 'telegram.me', 'telegram.dog']),
    whatsapp: new Set(['chat.whatsapp.com']),
    viber: new Set(['invite.viber.com', 'chats.viber.com', 'vb.me']),
    facebook: new Set(['facebook.com', 'm.facebook.com', 'mobile.facebook.com', 'fb.com']),
  };
  return allowed[platform].has(host);
}

function metaContent(html: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const first = new RegExp(`<meta\\b[^>]*(?:property|name)\\s*=\\s*["']${escaped}["'][^>]*content\\s*=\\s*["']([^"']*)["'][^>]*>`, 'i').exec(html);
  if (first?.[1]) return first[1];
  const second = new RegExp(`<meta\\b[^>]*content\\s*=\\s*["']([^"']*)["'][^>]*(?:property|name)\\s*=\\s*["']${escaped}["'][^>]*>`, 'i').exec(html);
  return second?.[1] || null;
}

function titleContent(html: string): string | null {
  return /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || null;
}

function normalizeResolvedName(value: string, platform: ChatNameResolution['platform']): string | null {
  let name = cleanChatName(value);
  if (platform === 'telegram') {
    name = name.replace(/^Telegram\s*:\s*/i, '').replace(/\s*[—–|-]\s*Telegram$/i, '').trim();
    if (/^(?:Contact\s+@|Join Group Chat|View in Telegram|Telegram)$/i.test(name)) return null;
  } else if (platform === 'whatsapp') {
    name = name.replace(/\s*[—–|-]\s*WhatsApp$/i, '').trim();
    if (/^(?:WhatsApp|WhatsApp Group Invite|Join WhatsApp Group)$/i.test(name)) return null;
  } else if (platform === 'viber') {
    name = name.replace(/\s*[—–|-]\s*Viber$/i, '').replace(/\s+on\s+Viber$/i, '').trim();
    if (/^(?:Viber|Viber Invite|Join Viber)$/i.test(name)) return null;
  } else {
    name = name.replace(/\s*[—–|-]\s*Facebook$/i, '').trim();
    if (/^(?:Facebook|Log into Facebook|Facebook\s*[—–|-]\s*log in or sign up|Update Your Browser|Unsupported Browser|Browser Not Supported)$/i.test(name)) return null;
  }
  name = cleanChatName(name);
  if (name.length < 2 || !/[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(name)) return null;
  return name;
}

function normalizeName(value: string) {
  return cleanChatName(value).toLocaleLowerCase('uk-UA');
}
