// Telegram Web A automation for Discovery sources (operator decision 2026-10-02): search public Telegram
// GROUPS (never channels) for WhatsApp invites through the operator's own logged-in web.telegram.org/a tab.
// Read-only: never joins a Telegram group, never sends a message. Groups that need a join request are skipped.
import { createCdpClient, isLocalCdpWebSocketUrl, normalizeLocalCdpBaseUrl } from './whatsapp-web-cdp.mjs';

const TELEGRAM_WEB_PREFIX = 'https://web.telegram.org/a';
// Telegram Web hides the chat list below ~925px; a wide viewport keeps the list and the chat clickable.
// The override belongs to this CDP session and disappears as soon as the session closes.
const WIDE_VIEWPORT = { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false };
const RESULT_WAIT_MS = 9_000;
const MAX_TRUNCATED_RESULT_OPENS = 3;
const MAX_IN_CHAT_RESULTS = 30;

const groupStatusPattern = /(?:\bmembers?\b|учасник|участник|member)/iu;
const channelStatusPattern = /(?:subscribers?|підписник|подписчик)/iu;
const joinRequestPattern = /(?:request to join|apply to join|join request|подати (?:запит|заявку)|запит на (?:вступ|приєднання)|подать заявку|заявк[ау] на вступление|запрос на вступление)/iu;
const floodPattern = /(?:too many (?:requests|attempts)|flood|please wait|try again later|забагато (?:запитів|спроб)|слишком много (?:запросов|попыток)|повторіть (?:спробу )?пізніше|повторите (?:попытку )?позже)/iu;
const inviteCodePattern = /(?:https?:\/\/)?chat\.whatsapp\.com\/(?:invite\/)?([A-Za-z0-9]{18,32})(?![A-Za-z0-9…]|\.\.\.)/giu;

export function classifyTelegramSearchStatus(status) {
  const text = String(status || '');
  if (channelStatusPattern.test(text)) return 'channel';
  if (groupStatusPattern.test(text)) return 'group';
  return 'other';
}

export function parseTelegramMemberCount(status) {
  const text = String(status || '');
  // "1.2K members" / "1,2 тис. учасників": decimal with a thousands suffix.
  const short = text.match(/(\d+(?:[.,]\d+)?)\s*(?:k\b|к\b|тис|тыс)/iu);
  if (short) return Math.round(Number(short[1].replace(',', '.')) * 1000);
  // "21,565 members" / "21 565 учасників": separators are thousands separators.
  const full = text.match(/\d[\d\s,. ]*/u);
  if (!full) return null;
  const value = Number(full[0].replace(/[\s,. ]/gu, ''));
  return Number.isFinite(value) ? value : null;
}

// Only complete invite codes: a search snippet cut with "…" must be opened to read the full link.
export function completeWhatsappInvites(text) {
  const invites = new Set();
  for (const match of String(text || '').matchAll(inviteCodePattern)) invites.add(`https://chat.whatsapp.com/${match[1]}`);
  return [...invites];
}

export function isTelegramFloodText(text) {
  return floodPattern.test(String(text || ''));
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// Thrown from any wait inside a Telegram step once the operator stopped the run, so a long group scan
// ends within a fraction of a second instead of finishing the group (live report 2026-10-04).
export class TelegramStopped extends Error {
  constructor() { super('telegram_stopped'); this.name = 'TelegramStopped'; }
}
// Human-like pause between Telegram actions so the account is not rate limited.
export function telegramActionPauseMs(random = Math.random) { return 4_000 + Math.floor(random() * 4_000); }

export async function openTelegramWebSession({ cdpBaseUrl, pauseMs = telegramActionPauseMs, shouldStop = () => false } = {}) {
  const base = cdpBaseUrl ? normalizeLocalCdpBaseUrl(cdpBaseUrl) : null;
  if (!base) return { kind: 'blocked', reason: 'cdp_not_configured' };
  let pages;
  try {
    const response = await fetch(`${base}/json/list`, { signal: AbortSignal.timeout(4_000) });
    pages = await response.json();
  } catch { return { kind: 'blocked', reason: 'cdp_unavailable' }; }
  const page = (Array.isArray(pages) ? pages : []).find(item => item?.type === 'page'
    && String(item.url || '').startsWith(TELEGRAM_WEB_PREFIX)
    && item.webSocketDebuggerUrl && isLocalCdpWebSocketUrl(item.webSocketDebuggerUrl));
  if (!page) return { kind: 'blocked', reason: 'telegram_tab_missing' };
  const client = await createCdpClient(page.webSocketDebuggerUrl);
  const session = new TelegramWebSession(client, pauseMs, shouldStop);
  try {
    await client.send('Page.bringToFront');
    await client.send('Emulation.setDeviceMetricsOverride', WIDE_VIEWPORT);
    await sleep(800);
    const ready = await session.evaluate(`Boolean(document.getElementById('telegram-search-input'))`);
    if (!ready) { client.close(); return { kind: 'blocked', reason: 'telegram_not_authenticated' }; }
  } catch (error) {
    client.close();
    return { kind: 'blocked', reason: 'telegram_tab_unavailable', detail: error instanceof Error ? error.message : String(error) };
  }
  return { kind: 'result', session };
}

export class TelegramWebSession {
  constructor(client, pauseMs, shouldStop = () => false) {
    this.client = client;
    this.pauseMs = pauseMs;
    this.shouldStop = shouldStop;
  }

  checkStop() { if (this.shouldStop()) throw new TelegramStopped(); }

  // Every wait in a step goes through here and re-checks the stop flag four times a second.
  async wait(ms) {
    const end = Date.now() + Math.max(0, ms);
    this.checkStop();
    while (Date.now() < end) {
      await sleep(Math.min(250, end - Date.now()));
      this.checkStop();
    }
  }

  close() { try { this.client.close(); } catch {} }

  async evaluate(expression) {
    const response = await this.client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response?.exceptionDetails) throw new Error('telegram_page_script_failed');
    return response?.result?.value;
  }

  async pause() { await this.wait(Math.max(0, Number(this.pauseMs()) || 0)); }

  async key(key, code, keyCode, modifiers = 0) {
    for (const type of ['keyDown', 'keyUp']) {
      await this.client.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: keyCode, modifiers });
    }
  }

  // Real mouse events: Telegram Web ignores synthetic element.click() on list items.
  async click(selectorExpression) {
    const box = await this.evaluate(`(()=>{const el=${selectorExpression};if(!el)return null;
      el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();
      if(r.width<=0||r.height<=0||r.x<0||r.y<0)return null;return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    if (!box) return false;
    await this.client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.client.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
    }
    return true;
  }

  async floodVisible() {
    const text = await this.evaluate(`[...document.querySelectorAll('.Notification, .Notification-container, [class*="Notification"], .modal-dialog')]
      .map(el=>el.innerText||'').join('\\n').slice(0,2000)`);
    return isTelegramFloodText(text);
  }

  async typeGlobalSearch(query) {
    await this.client.send('Page.bringToFront');
    // Opening a forum group replaces the global search with its topic list; close that panel first.
    for (let attempt = 0; attempt < 3; attempt++) {
      const hidden = await this.evaluate(`Boolean(document.getElementById('telegram-search-input')?.closest('.SearchInput--hidden'))`);
      if (!hidden) break;
      await this.click(`[...document.querySelectorAll('#LeftColumn .left-header button')]
        .find(b=>/close|закрити|закрыть/iu.test(b.getAttribute('aria-label')||b.title||''))`);
      await this.wait(700);
    }
    const focused = await this.evaluate(`(()=>{const input=document.getElementById('telegram-search-input');
      if(!input||input.closest('.SearchInput--hidden'))return false;input.focus();input.select();return document.activeElement===input;})()`);
    if (!focused) return { flood: false, unavailable: true };
    await this.client.send('Input.insertText', { text: String(query) });
    const result = await this.waitForSearchResults();
    if (result.flood) return result;
    // Maximum coverage (operator decision 2026-10-05): the quick combined panel truncates each
    // category to a handful of rows behind a "Show More"/"Показати більше" link. Best-effort: a
    // missing/renamed link just means click() no-ops and we keep whatever the quick panel already
    // has, never a hard failure.
    const expanded = await this.click(`[...document.querySelectorAll('.LeftSearch [role="button"], .LeftSearch .ListItem-button, .LeftSearch span, .LeftSearch a')]
      .find(el=>/^(show more|показати (більше|ще)|показать (больше|ещё))$/iu.test((el.innerText||'').trim()))`);
    if (expanded) return this.waitForSearchResults();
    return result;
  }

  async waitForSearchResults() {
    const startedAt = Date.now();
    let previous = -1;
    let stableSince = Date.now();
    while (Date.now() - startedAt < RESULT_WAIT_MS) {
      await this.wait(500);
      if (await this.floodVisible()) return { flood: true };
      const count = await this.evaluate(`document.querySelectorAll('.LeftSearch .ListItem.search-result').length`);
      if (count !== previous) { previous = count; stableSince = Date.now(); }
      else if (Date.now() - stableSince >= 1_500 && Date.now() - startedAt >= 2_500) break;
    }
    return { flood: false };
  }

  readSearchResults() {
    return this.evaluate(`[...document.querySelectorAll('.LeftSearch .ListItem.search-result')].map((item,index)=>({
      index,
      title:(item.querySelector('.fullName')?.innerText||'').trim().slice(0,180),
      username:(item.querySelector('.handle')?.innerText||'').trim().replace(/^@/,''),
      status:(item.querySelector('.group-status, .status')?.innerText||'').trim().slice(0,80),
      peerId:item.querySelector('[data-peer-id]')?.getAttribute('data-peer-id')||'',
    }))`);
  }

  async openSearchResult(username) {
    const results = await this.readSearchResults();
    const wanted = String(username).toLowerCase();
    const match = (results || []).find(item => item.username.toLowerCase() === wanted);
    if (!match) return null;
    const clicked = await this.click(`document.querySelectorAll('.LeftSearch .ListItem.search-result')[${match.index}]`);
    if (!clicked) return null;
    await this.wait(2_500);
    return match;
  }

  readOpenChat() {
    return this.evaluate(`(()=>{
      const middle=document.querySelector('#MiddleColumn');
      const header=middle?.querySelector('.MiddleHeader');
      const visible=el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0;};
      const buttons=[...(middle?.querySelectorAll('button')||[])].filter(visible).map(b=>(b.innerText||'').trim()).filter(Boolean);
      return {
        title:(header?.querySelector('.fullName, h3')?.innerText||'').trim().slice(0,180),
        status:(header?.querySelector('.status, .group-status')?.innerText||'').trim().slice(0,80),
        footer:buttons.slice(-3).join(' | ').slice(0,200),
        composer:Boolean(middle?.querySelector('#editable-message-text, .Composer')),
      };
    })()`);
  }

  focusInChatSearchInput() {
    return this.evaluate(`(()=>{const input=[...document.querySelectorAll('#MiddleColumn input')]
      .find(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0;});
      if(!input)return false;input.focus();input.select();return document.activeElement===input;})()`);
  }

  async searchInOpenChat(text) {
    // Each group is opened fresh from the chat list, so its in-chat search starts closed. (The header keeps
    // a transparent search input, so "is an input visible" cannot tell whether search is open.)
    const opened = await this.click(`[...document.querySelectorAll('#MiddleColumn .MiddleHeader button')]
      .find(b=>/search|пошук|поиск/iu.test(b.getAttribute('aria-label')||b.title||''))`);
    if (!opened) return { opened: false };
    await this.wait(800);
    if (!await this.focusInChatSearchInput()) return { opened: false };
    const filtered = await this.evaluate(`/(?:^|\\s)(?:from|від|от):/iu.test([...document.querySelectorAll('#MiddleColumn .SearchInput')]
      .map(el=>el.innerText||'').join(' '))`);
    if (filtered) return { opened: false, reason: 'telegram_search_filtered' };
    await this.client.send('Input.insertText', { text });
    await this.key('Enter', 'Enter', 13);
    const startedAt = Date.now();
    let previous = -1;
    let stableSince = Date.now();
    while (Date.now() - startedAt < RESULT_WAIT_MS) {
      await this.wait(500);
      if (await this.floodVisible()) return { opened: true, flood: true };
      const count = await this.evaluate(`document.querySelectorAll('.MiddleSearchResult').length`);
      if (count !== previous) { previous = count; stableSince = Date.now(); }
      else if (Date.now() - stableSince >= 1_500 && Date.now() - startedAt >= 3_000) break;
    }
    return { opened: true, flood: false };
  }

  readInChatResults() {
    return this.evaluate(`[...document.querySelectorAll('.MiddleSearchResult')].slice(0,${MAX_IN_CHAT_RESULTS})
      .map((item,index)=>({index,text:(item.innerText||'').replace(/\\s+/g,' ').trim().slice(0,600)}))`);
  }

  readVisibleInviteMessages() {
    return this.evaluate(`[...document.querySelectorAll('#MiddleColumn .Message')].map(message=>{
      const links=[...message.querySelectorAll('a')].map(a=>a.href||'').filter(href=>/chat\\.whatsapp\\.com\\//i.test(href));
      const text=(message.querySelector('.text-content')?.innerText||message.innerText||'').replace(/\\s+/g,' ').trim();
      return links.length||/chat\\.whatsapp\\.com\\//i.test(text)?{text:text.slice(0,900),links}:null;
    }).filter(Boolean).slice(0,40)`);
  }

  async closeInChatSearch() {
    await this.key('Escape', 'Escape', 27);
    await this.wait(300);
  }
}

// Global Telegram search for one plan query; returns public groups only (channels are not sources).
export async function searchTelegramPublicGroups(session, query, { limit = 6 } = {}) {
  const typed = await session.typeGlobalSearch(query);
  if (typed.flood) return { kind: 'blocked', reason: 'telegram_flood_wait' };
  if (typed.unavailable) return { kind: 'blocked', reason: 'telegram_search_unavailable' };
  const results = await session.readSearchResults();
  const groups = [];
  const seen = new Set();
  for (const item of Array.isArray(results) ? results : []) {
    if (!item.username || classifyTelegramSearchStatus(item.status) !== 'group') continue;
    const key = item.username.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    groups.push({ username: item.username, title: item.title, memberCount: parseTelegramMemberCount(item.status) });
    if (groups.length >= limit) break;
  }
  return { kind: 'result', groups };
}

// Opens one public group WITHOUT joining and collects the WhatsApp invites posted in it.
export async function scanTelegramGroupForInvites(session, { username, title = '' }) {
  let opened = await session.openSearchResult(username);
  if (!opened) {
    await session.pause();
    const typed = await session.typeGlobalSearch(username);
    if (typed.flood) return { kind: 'blocked', reason: 'telegram_flood_wait' };
    if (typed.unavailable) return { kind: 'blocked', reason: 'telegram_search_unavailable' };
    opened = await session.openSearchResult(username);
  }
  if (!opened) return { kind: 'result', status: 'not_found', username, title, invites: [] };
  if (classifyTelegramSearchStatus(opened.status) !== 'group') return { kind: 'result', status: 'not_group', username, title: opened.title, invites: [] };
  const chat = await session.readOpenChat();
  if (!chat.composer && joinRequestPattern.test(chat.footer)) {
    return { kind: 'result', status: 'join_request', username, title: chat.title || opened.title, invites: [] };
  }
  await session.pause();
  const search = await session.searchInOpenChat('chat.whatsapp.com');
  if (search.flood) return { kind: 'blocked', reason: 'telegram_flood_wait' };
  if (!search.opened) return { kind: 'result', status: 'search_unavailable', username, title: chat.title || opened.title, invites: [] };
  const results = (await session.readInChatResults()) || [];
  const snippets = new Map();
  const truncated = [];
  for (const result of results) {
    const invites = completeWhatsappInvites(result.text);
    for (const invite of invites) if (!snippets.has(invite)) snippets.set(invite, result.text);
    if (!invites.length && /chat\.whatsapp\.com/iu.test(result.text)) truncated.push(result.index);
  }
  // A cut snippet only shows "chat.whatsapp.com/…": open that message and read the real link.
  for (const index of truncated.slice(0, MAX_TRUNCATED_RESULT_OPENS)) {
    session.checkStop();
    const clicked = await session.click(`document.querySelectorAll('.MiddleSearchResult')[${index}]`);
    if (!clicked) continue;
    await session.wait(2_000);
    if (await session.floodVisible()) return { kind: 'blocked', reason: 'telegram_flood_wait' };
    for (const message of (await session.readVisibleInviteMessages()) || []) {
      for (const invite of completeWhatsappInvites([message.text, ...message.links].join('\n'))) {
        if (!snippets.has(invite)) snippets.set(invite, message.text);
      }
    }
  }
  await session.closeInChatSearch();
  return {
    kind: 'result', status: 'scanned', username, title: chat.title || opened.title,
    memberCount: parseTelegramMemberCount(chat.status || opened.status),
    invites: [...snippets.entries()].map(([link, text]) => ({ link, text })),
  };
}
