const DEFAULT_TIMEOUT_MS = 20_000;
const POLL_MS = 400;

const pendingPattern = /(?:request(?: to join)? sent|request pending|запит (?:на вступ )?надіслано|запит очікує|заявк[ау] (?:на вступление )?отправлен[а]?|заявк[ау] ожидает)/iu;
const adminOnlyPattern = /(?:only admins can send messages|лише адміністратори можуть надсилати повідомлення|только администраторы могут отправлять сообщения)/iu;
const authPattern = /(?:link with phone number|log in to whatsapp|увійти у whatsapp|войти в whatsapp)/iu;
const unavailablePatterns = [
  { pattern: /(?:invite link).*(?:invalid|reset|expired)|(?:недійсне|скинуте|прострочене).*(?:посилання|запрошення)|(?:недействительн|сброшен|истек).*(?:ссылк|приглашен)/iu, reason: 'invalid_whatsapp_link' },
  { pattern: /(?:group).*(?:no longer available|does not exist)|(?:група).*(?:більше недоступна|не існує)|(?:группа).*(?:больше недоступна|не существует)/iu, reason: 'whatsapp_chat_missing' },
];

const joinPattern = /^(?:join(?: group| chat)?|request to join|приєднатися(?: до групи| до чату)?|подати запит на вступ|присоединиться(?: к группе| к чату)?|отправить запрос на вступление)$/iu;
const viewPattern = /^(?:view(?: group| chat)?|open(?: group| chat)?|continue to chat|переглянути(?: групу| чат)?|відкрити(?: групу| чат)?|продовжити до чату|просмотреть(?: группу| чат)?|открыть(?: группу| чат)?|продолжить в чат)$/iu;

export function normalizeTargetLabel(value) {
  return String(value || '')
    .replace(/[\u200e\u200f\u202a-\u202e]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLocaleLowerCase('uk-UA');
}

function isGeneratedExpectedName(value) {
  return /^whatsapp\s*·/iu.test(String(value || '').trim());
}

export function whatsappInviteCode(link) {
  let url;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (!/(^|\.)chat\.whatsapp\.com$/iu.test(url.hostname)) return null;
  const code = url.pathname.split('/').filter(Boolean)[0] || '';
  return /^[A-Za-z0-9_-]{8,128}$/u.test(code) ? code : null;
}

export function toWhatsAppWebInviteUrl(link) {
  const code = whatsappInviteCode(link);
  return code ? `https://web.whatsapp.com/accept?code=${encodeURIComponent(code)}` : null;
}

export function normalizeLocalCdpBaseUrl(value) {
  if (!value) return null;
  let url;
  try {
    url = new URL(String(value));
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' || url.username || url.password) return null;
  if (!isLoopbackHost(url.hostname)) return null;
  return url.origin;
}

export function isLocalCdpWebSocketUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    return false;
  }
  return url.protocol === 'ws:' && !url.username && !url.password && isLoopbackHost(url.hostname);
}

function isLoopbackHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function exactTarget(snapshot, task) {
  const expected = task.expectedTarget?.name || task.name;
  if (!expected || isGeneratedExpectedName(expected)) return null;
  const normalizedExpected = normalizeTargetLabel(expected);
  const candidates = [...(snapshot.headerTitles || []), ...(snapshot.targetTexts || [])];
  return candidates.find((value) => normalizeTargetLabel(value) === normalizedExpected) || null;
}

function firstMatchingButton(snapshot, pattern) {
  return (snapshot.buttons || []).find((value) => pattern.test(String(value).trim())) || null;
}

export function classifyWhatsAppSnapshot(task, snapshot) {
  const bodyText = String(snapshot.bodyText || '');
  const expectedInviteCode = whatsappInviteCode(task.expectedTarget?.link || task.link);
  const expectedInviteContext = expectedInviteCode
    ? String(snapshot.url || '').includes(expectedInviteCode)
    : false;

  for (const entry of unavailablePatterns) {
    if (expectedInviteContext && entry.pattern.test(bodyText)) {
      return {
        kind: 'result',
        result: {
          status: 'failed',
          accessible: false,
          targetVerified: false,
          reason: entry.reason,
        },
      };
    }
  }

  if (snapshot.hasQr || authPattern.test(bodyText)) {
    return { kind: 'blocked', reason: 'whatsapp_not_authenticated' };
  }

  const observedName = exactTarget(snapshot, task);
  if (!observedName) {
    return { kind: 'blocked', reason: 'target_not_verified' };
  }

  const normalizedExpected = normalizeTargetLabel(task.expectedTarget?.name || task.name);
  const headerMatches = (snapshot.headerTitles || []).some(
    (value) => normalizeTargetLabel(value) === normalizedExpected,
  );

  if (headerMatches) {
    return {
      kind: 'result',
      result: {
        status: 'inspected',
        targetVerified: true,
        accessible: true,
        membershipState: 'joined',
        observedName,
        chatType: 'group',
        canWrite: snapshot.composer ? true : snapshot.adminOnly ? false : undefined,
        adsPolicy: 'unknown',
        activityState: 'unknown',
        topicMatch: 'unknown',
      },
    };
  }

  const targetRegionText = String(snapshot.targetRegionText || bodyText);
  if (pendingPattern.test(targetRegionText)) {
    return {
      kind: 'result',
      result: {
        status: 'inspected',
        targetVerified: true,
        accessible: true,
        membershipState: 'pending',
        observedName,
        chatType: 'group',
        adsPolicy: 'unknown',
        activityState: 'unknown',
        topicMatch: 'unknown',
      },
    };
  }

  const viewButtonText = firstMatchingButton(snapshot, viewPattern);
  if (viewButtonText && task.action !== 'join_and_inspect') {
    return { kind: 'action', action: 'view', buttonText: viewButtonText };
  }

  const joinButtonText = firstMatchingButton(snapshot, joinPattern);
  if (joinButtonText && task.action === 'join_and_inspect') {
    return { kind: 'action', action: 'join', buttonText: joinButtonText };
  }

  return { kind: 'blocked', reason: 'membership_not_confirmed' };
}

export async function inspectWhatsappTaskViaCdp(
  task,
  { cdpBaseUrl, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  if (task.runtime !== 'whatsapp_web' || task.platform !== 'whatsapp') {
    return { kind: 'blocked', reason: 'unsupported_runtime' };
  }
  const targetUrl = toWhatsAppWebInviteUrl(task.expectedTarget?.link || task.link);
  if (!targetUrl) return { kind: 'blocked', reason: 'invalid_whatsapp_link' };
  if (!cdpBaseUrl) return { kind: 'blocked', reason: 'cdp_not_configured' };
  const base = normalizeLocalCdpBaseUrl(cdpBaseUrl);
  if (!base) return { kind: 'blocked', reason: 'cdp_not_local' };

  const page = await findOrCreateWhatsappPage(base);
  if (!isLocalCdpWebSocketUrl(page.webSocketDebuggerUrl)) {
    return { kind: 'blocked', reason: 'cdp_websocket_not_local' };
  }
  const client = await createCdpClient(page.webSocketDebuggerUrl);
  try {
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Page.navigate', { url: targetUrl });

    let classified = await waitForClassification(client, task, timeoutMs);
    if (classified.kind === 'action') {
      const clicked = await clickExactButton(client, classified.buttonText, task.expectedTarget?.name || task.name);
      if (!clicked) return { kind: 'blocked', reason: 'expected_control_disappeared' };
      classified = await waitForClassification(client, task, timeoutMs, classified.action);
    }
    return classified;
  } finally {
    client.close();
  }
}

async function findOrCreateWhatsappPage(base) {
  const response = await fetch(`${base}/json/list`, {
    signal: AbortSignal.timeout(4_000),
  });
  if (!response.ok) throw new Error(`CDP list HTTP ${response.status}`);
  const pages = await response.json();
  const existing = Array.isArray(pages)
    ? pages.find((page) => page?.type === 'page' && /^https:\/\/web\.whatsapp\.com\//u.test(page.url || ''))
    : null;
  if (existing?.webSocketDebuggerUrl) return existing;

  const created = await fetch(
    `${base}/json/new?${encodeURIComponent('https://web.whatsapp.com/')}`,
    { method: 'PUT', signal: AbortSignal.timeout(4_000) },
  );
  if (!created.ok) throw new Error(`CDP new page HTTP ${created.status}`);
  const page = await created.json();
  if (!page?.webSocketDebuggerUrl) throw new Error('CDP did not return a page websocket.');
  return page;
}

async function waitForClassification(client, task, timeoutMs, afterAction = null) {
  const deadline = Date.now() + timeoutMs;
  let last = { kind: 'blocked', reason: 'page_not_ready' };
  while (Date.now() < deadline) {
    const snapshot = await readSnapshot(client);
    last = classifyWhatsAppSnapshot(task, snapshot);
    if (last.kind === 'result') return last;
    if (last.kind === 'action') {
      if (afterAction && last.action === afterAction) {
        await sleep(POLL_MS);
        continue;
      }
      return last;
    }
    if (!['target_not_verified', 'membership_not_confirmed', 'page_not_ready'].includes(last.reason)) {
      return last;
    }
    await sleep(POLL_MS);
  }
  return last;
}

async function readSnapshot(client) {
  const expression = `(() => {
    const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const unique = (values) => [...new Set(values.map(clean).filter(Boolean))];
    const read = (root, selectors) => unique(selectors.flatMap((selector) =>
      [...root.querySelectorAll(selector)].map((node) => node.getAttribute('title') || node.textContent || '')
    ));
    const bodyText = document.body?.innerText || '';
    const headerTitles = read(document, [
      '[data-testid="conversation-info-header"] [title]',
      'header [title]',
      'header h1',
      'header h2',
    ]);
    const dialog = document.querySelector('[role="dialog"]');
    const targetTexts = dialog ? read(dialog, ['[title]', 'h1', 'h2', 'h3', 'span']) : [];
    const buttons = read(document, ['button', '[role="button"]']);
    const composer = Boolean(document.querySelector(
      'footer [contenteditable="true"][role="textbox"], footer [contenteditable="true"], [data-testid="conversation-compose-box-input"]'
    ));
    const hasQr = Boolean(document.querySelector('canvas[aria-label*="QR" i], [data-ref] canvas'));
    return {
      url: location.href,
      bodyText,
      headerTitles,
      targetTexts,
      targetRegionText: dialog?.innerText || '',
      buttons,
      composer,
      adminOnly: ${adminOnlyPattern}.test(bodyText),
      hasQr,
    };
  })()`;
  const response = await client.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  return response?.result?.value || {};
}

async function clickExactButton(client, label, expectedName) {
  const expression = `(() => {
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim().toLocaleLowerCase('uk-UA');
    const expected = ${JSON.stringify(String(label || '').trim().toLocaleLowerCase('uk-UA'))};
    const target = ${JSON.stringify(String(expectedName || '').trim().toLocaleLowerCase('uk-UA'))};
    const dialogs = [...document.querySelectorAll('[role="dialog"]')];
    const container = dialogs.find((dialog) =>
      [...dialog.querySelectorAll('[title], h1, h2, h3, span')].some((node) =>
        normalize(node.getAttribute('title') || node.textContent) === target
      )
    );
    if (!container) return false;
    const candidates = [...container.querySelectorAll('button, [role="button"]')];
    const button = candidates.find((node) => normalize(node.textContent) === expected && !node.hasAttribute('disabled'));
    if (!button) return false;
    button.click();
    return true;
  })()`;
  const response = await client.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
  });
  return response?.result?.value === true;
}

async function createCdpClient(url) {
  const WebSocketClient = globalThis.WebSocket;
  if (!WebSocketClient) throw new Error('This Node runtime does not provide WebSocket.');
  const socket = new WebSocketClient(url);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('CDP websocket timeout.')), 4_000);
    socket.addEventListener('open', () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
    socket.addEventListener('error', () => {
      clearTimeout(timeout);
      reject(new Error('CDP websocket connection failed.'));
    }, { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (!message.id || !pending.has(message.id)) return;
    const waiter = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message || 'CDP command failed.'));
    else waiter.resolve(message.result);
  });

  return {
    send(method, params = {}) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      for (const waiter of pending.values()) waiter.reject(new Error('CDP connection closed.'));
      pending.clear();
      socket.close();
    },
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
