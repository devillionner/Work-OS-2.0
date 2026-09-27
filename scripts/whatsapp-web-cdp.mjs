// Real WhatsApp invite resolution can exceed 20s before the factual join/retry modal appears.
const DEFAULT_TIMEOUT_MS = 45_000;
const POLL_MS = 400;

const pendingPattern = /(?:request(?: to join)? sent|request pending|запит (?:на вступ )?надіслано|запит очікує|заявк[ау] (?:на вступление )?отправлен[а]?|заявк[ау] ожидает)/iu;
const approvalRequiredPattern = /(?:admin(?:istrator)? approval (?:is )?(?:required|turned on)|an admin (?:must|needs to) approve|request to join|потрібне схвалення адміністратор|адміністратор має схвалити|потрібно подати запит на вступ|требуется одобрение администратора|администратор должен одобрить|нужно отправить запрос на вступление)/iu;
const adminOnlyPattern = /(?:only admins can send messages|лише адміністратори можуть надсилати повідомлення|только администраторы могут отправлять сообщения)/iu;
const authPattern = /(?:link with phone number|log in to whatsapp|увійти у whatsapp|войти в whatsapp)/iu;
const joinRetryLaterPattern = /(?:could(?:n['’]?t| not) join (?:this )?(?:group|community)|try again later|не вдалося приєднатися до (?:цієї )?(?:групи|спільноти)|повторіть спробу пізніше|не удалось присоединиться к (?:этой )?(?:группе|сообществу)|повторите попытку позже)/iu;
const unavailablePatterns = [
  { pattern: /(?:invite link).*(?:invalid|reset|expired)|(?:недійсне|скинуте|прострочене).*(?:посилання|запрошення)|(?:недействительн|сброшен|истек).*(?:ссылк|приглашен)/iu, reason: 'invalid_whatsapp_link' },
  { pattern: /(?:group).*(?:no longer available|does not exist)|(?:група).*(?:більше недоступна|не існує)|(?:группа).*(?:больше недоступна|не существует)/iu, reason: 'whatsapp_chat_missing' },
];

const requestJoinPattern = /^(?:request(?: to join)?(?: group| chat| community)?|send (?:a )?request(?: to join)?|подати запит(?: на вступ)?|надіслати запит(?: на вступ)?|отправить запрос(?: на вступление)?|подать заявку(?: на вступление)?)$/iu;
const directJoinPattern = /^(?:join(?: group| chat| community)?|приєднатися(?: до групи| до чату| до спільноти)?|присоединиться(?: к группе| к чату| к сообществу)?)$/iu;
const joinPattern = /^(?:join(?: group| chat| community)?|request to join|приєднатися(?: до групи| до чату| до спільноти)?|подати запит на вступ|присоединиться(?: к группе| к чату| к сообществу)?|отправить запрос на вступление)$/iu;
const viewPattern = /^(?:view(?: group| chat)?|open(?: group| chat)?|continue to chat|переглянути(?: групу| чат)?|відкрити(?: групу| чат)?|продовжити до чату|просмотреть(?: группу| чат)?|открыть(?: группу| чат)?|продолжить в чат)$/iu;
const leavePattern = /^(?:exit group|leave group|вийти з групи|покинути групу|выйти из группы|покинуть группу)$/iu;
const confirmLeavePattern = /^(?:exit(?: group)?|leave(?: group)?|вийти(?: з групи)?|покинути(?: групу)?|выйти(?: из группы)?|покинуть(?: группу)?)$/iu;
const leftPattern = /(?:you (?:left|are no longer a participant)|ви (?:вийшли|більше не є учасником)|вы (?:вышли|больше не участник))/iu;
const joinedViaInvitePattern = /(?:you (?:joined|were added) (?:via|using|through) (?:an? )?(?:invite|invitation|invite link)|joined (?:via|using) (?:the )?(?:group )?invite|ви приєдналися за (?:посиланням[- ]?)?запрошенням|вы присоединились по (?:ссылке[- ]?)?приглашени[юя])/iu;
const spamPattern = /(?:crypto|крипт|bitcoin|forex|casino|казино|betting|ставк[аи]|dating|знакомств|знайомств|escort|ескорт|onlyfans|adult|18\+|nft|airdrop|signals?\b|binary options)/iu;
const ukrainianIdentityPattern = /(?:україн|украин|ukrain|🇺🇦)/iu;
const adsForbiddenPattern = /(?:no\s+(?:ads?|advertis(?:ing|ements?))|advertis(?:ing|ements?)\s+(?:is\s+)?(?:forbidden|prohibited)|(?:реклам[ауи]|оголошення)\s+(?:суворо\s+)?заборонен|без\s+реклами|(?:реклам[ауы]|объявления)\s+(?:строго\s+)?запрещен|без\s+рекламы)/iu;
const adsAllowedPattern = /(?:ads?\s+allowed|advertis(?:ing|ements?)\s+allowed|оголошення\s+дозволен|реклам[ауи]\s+дозволен|объявления\s+разрешен|реклам[ауы]\s+разрешен)/iu;
const adLikeMessagePattern = /(?:продам|продаю|продаж|куплю|купую|віддам|отдам|обмін|обмен|шукаю|ищу|послуг|услуг|урок|репетитор|оренд|аренд|здам|сдам|робот[ауи]|работ[ауи]|ваканс|доставк|перевез|advert|for\s+sale|give\s+away|exchange|looking\s+for|services?|rent|job|vacanc)/iu;
const recentActivityPattern = /(?:^|\s)(?:today|yesterday|сьогодні|вчора|сегодня|вчера)(?:\s|$)/iu;

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

function isWeakExpectedName(value) {
  const text=String(value || '').trim();
  if(!text) return true;
  if(isGeneratedExpectedName(text)) return true;
  if(/<\/?[a-z][^>]*>|(?:src|href|class|id)\s*=\s*["']|https?:\/\/|chat\.whatsapp\.com/iu.test(text)) return true;
  if(/(?:notion-|svelte|data-testid|aria-label)/iu.test(text)) return true;
  return !/\p{L}/u.test(text);
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


export async function readWorkOsExecutorTokenViaCdp(
  workOsUrl,
  { cdpBaseUrl } = {},
) {
  if (!cdpBaseUrl) return { kind:'blocked', reason:'cdp_not_configured' };
  const base = normalizeLocalCdpBaseUrl(cdpBaseUrl);
  if (!base) return { kind:'blocked', reason:'cdp_not_local' };

  let expectedOrigin;
  try {
    const url = new URL(String(workOsUrl || ''));
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password) {
      return { kind:'blocked', reason:'work_os_origin_invalid' };
    }
    expectedOrigin = url.origin;
  } catch {
    return { kind:'blocked', reason:'work_os_origin_invalid' };
  }

  const response = await fetch(`${base}/json/list`, { signal:AbortSignal.timeout(4_000) });
  if (!response.ok) throw new Error(`CDP list HTTP ${response.status}`);
  const pages = await response.json();
  const page = Array.isArray(pages)
    ? pages.find((item) => {
        if (item?.type !== 'page' || !item?.webSocketDebuggerUrl) return false;
        try { return new URL(item.url || '').origin === expectedOrigin; }
        catch { return false; }
      })
    : null;
  if (!page) return { kind:'blocked', reason:'work_os_page_not_found' };
  if (!isLocalCdpWebSocketUrl(page.webSocketDebuggerUrl)) {
    return { kind:'blocked', reason:'cdp_websocket_not_local' };
  }

  const client = await createCdpClient(page.webSocketDebuggerUrl);
  try {
    const result = await client.send('Runtime.evaluate', {
      expression: `(()=>{
        const panel=document.querySelector('[aria-label="Executor пошуку чатів"]');
        const token=panel?.querySelector('code')?.textContent?.trim()||'';
        return token;
      })()`,
      returnByValue:true,
    });
    const token=String(result?.result?.value||'').trim();
    if (token.length < 32 || token.length > 512) {
      return { kind:'blocked', reason:'executor_token_not_visible' };
    }
    return { kind:'result', token };
  } finally {
    client.close();
  }
}

const WORK_OS_LOCAL_PREVIEW_KEY='work-os:chat-discovery-local-preview:v3';
const WORK_OS_LOCAL_PREFLIGHT_RESULTS_KEY='work-os:chat-discovery-local-preflight-results:v1';

export async function readWorkOsLocalDiscoveryTaskViaCdp(
  workOsUrl,
  { cdpBaseUrl } = {},
) {
  const pagesResult=await listWorkOsPagesForCdp(workOsUrl,cdpBaseUrl);
  if(pagesResult.kind==='blocked')return pagesResult;
  let fallback={kind:'result',active:false,goal:0,task:null};
  for(const page of pagesResult.pages){
    const client=await createCdpClient(page.webSocketDebuggerUrl);
    try{
      const response=await client.send('Runtime.evaluate',{
        expression:`(()=>{
          const raw=sessionStorage.getItem(${JSON.stringify(WORK_OS_LOCAL_PREVIEW_KEY)});
          if(!raw)return {active:false,goal:0,task:null};
          let state;try{state=JSON.parse(raw);}catch{return {active:false,goal:0,task:null};}
          const resultRaw=sessionStorage.getItem(${JSON.stringify(WORK_OS_LOCAL_PREFLIGHT_RESULTS_KEY)});
          let results={};try{results=resultRaw?JSON.parse(resultRaw):{};}catch{}
          const candidates=Array.isArray(state?.candidates)?state.candidates:[];
          const candidate=candidates.find((item)=>
            item&&item.localOnly===true&&item.preflightState==='queued'&&typeof item.id==='string'
            &&typeof item.link==='string'&&!results[item.id]
          )||null;
          return {
            active:state?.running===true,
            goal:Number(state?.goal)||0,
            task:candidate?{
              candidateId:candidate.id,
              runtime:'whatsapp_web',
              platform:'whatsapp',
              action:'join_and_inspect',
              name:String(candidate.name||'WhatsApp candidate'),
              link:String(candidate.link||''),
              topicMatch:candidate.topicMatch||'unknown',
              minMembers:700,
              expectedTarget:{name:String(candidate.name||'WhatsApp candidate'),link:String(candidate.link||'')},
            }:null,
          };
        })()`,
        returnByValue:true,
      });
      const value=response?.result?.value||{active:false,goal:0,task:null};
      if(value.active===true||value.task)return {kind:'result',...value};
      fallback={kind:'result',...value};
    }finally{client.close();}
  }
  return fallback;
}

export async function writeWorkOsLocalDiscoveryResultViaCdp(
  workOsUrl,
  candidateId,
  payload,
  { cdpBaseUrl } = {},
) {
  const pagesResult=await listWorkOsPagesForCdp(workOsUrl,cdpBaseUrl);
  if(pagesResult.kind==='blocked')return pagesResult;
  for(const page of pagesResult.pages){
    const client=await createCdpClient(page.webSocketDebuggerUrl);
    try{
      const response=await client.send('Runtime.evaluate',{
        expression:`(()=>{
          const raw=sessionStorage.getItem(${JSON.stringify(WORK_OS_LOCAL_PREVIEW_KEY)});
          if(!raw)return false;
          let state;try{state=JSON.parse(raw);}catch{return false;}
          const candidates=Array.isArray(state?.candidates)?state.candidates:[];
          if(!candidates.some((item)=>item&&item.id===${JSON.stringify(String(candidateId||''))}))return false;
          const key=${JSON.stringify(WORK_OS_LOCAL_PREFLIGHT_RESULTS_KEY)};
          let results={};try{results=JSON.parse(sessionStorage.getItem(key)||'{}');}catch{}
          results[${JSON.stringify(String(candidateId||''))}]=${JSON.stringify(payload)};
          const entries=Object.entries(results).slice(-300);
          sessionStorage.setItem(key,JSON.stringify(Object.fromEntries(entries)));
          return true;
        })()`,
        returnByValue:true,
      });
      if(response?.result?.value===true)return {kind:'result'};
    }finally{client.close();}
  }
  return {kind:'blocked',reason:'work_os_result_target_not_found'};
}

async function listWorkOsPagesForCdp(workOsUrl,cdpBaseUrl){
  if(!cdpBaseUrl)return {kind:'blocked',reason:'cdp_not_configured'};
  const base=normalizeLocalCdpBaseUrl(cdpBaseUrl);
  if(!base)return {kind:'blocked',reason:'cdp_not_local'};
  let expectedOrigin;
  try{
    const url=new URL(String(workOsUrl||''));
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return {kind:'blocked',reason:'work_os_origin_invalid'};
    expectedOrigin=url.origin;
  }catch{return {kind:'blocked',reason:'work_os_origin_invalid'};}
  const response=await fetch(`${base}/json/list`,{signal:AbortSignal.timeout(4_000)});
  if(!response.ok)throw new Error(`CDP list HTTP ${response.status}`);
  const listed=await response.json();
  const pages=Array.isArray(listed)?listed.filter((item)=>{
    if(item?.type!=='page'||!item?.webSocketDebuggerUrl)return false;
    if(!isLocalCdpWebSocketUrl(item.webSocketDebuggerUrl))return false;
    try{return new URL(item.url||'').origin===expectedOrigin;}catch{return false;}
  }):[];
  if(!pages.length)return {kind:'blocked',reason:'work_os_page_not_found'};
  return {kind:'result',pages};
}

async function findWorkOsPageForCdp(workOsUrl,cdpBaseUrl){
  const result=await listWorkOsPagesForCdp(workOsUrl,cdpBaseUrl);
  if(result.kind==='blocked')return result;
  return {kind:'result',page:result.pages[0]};
}

function isLoopbackHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function inviteContextMatches(snapshot, task) {
  const code = whatsappInviteCode(task.expectedTarget?.link || task.link);
  if (!code) return false;
  return String(snapshot.url || '').includes(code) || snapshot.navigatedInviteCode === code;
}

function exactTarget(snapshot, task) {
  const expected = task.expectedTarget?.name || task.name;
  if (!expected) return null;
  if (!isWeakExpectedName(expected)) {
    const normalizedExpected = normalizeTargetLabel(expected);
    const candidates = [...(snapshot.headerNames || []), ...(snapshot.headerTitles || []), ...(snapshot.targetHeadings || []), ...(snapshot.targetTexts || [])];
    const exact = candidates.find((value) => normalizeTargetLabel(value) === normalizedExpected);
    if (exact) return exact;
  }

  if (!inviteContextMatches(snapshot, task)) return null;

  const postInviteText = [snapshot.targetRegionText, snapshot.mainText, snapshot.bodyText].filter(Boolean).join('\n');
  if (joinedViaInvitePattern.test(postInviteText)) {
    const joinedHeader = (snapshot.headerNames || [])
      .map((value) => String(value || '').trim())
      .find(Boolean);
    if (joinedHeader) return joinedHeader;
  }

  const headings = [...(snapshot.targetHeadings || []), ...(snapshot.targetTexts || [])]
    .map((value) => String(value || '').trim())
    .filter((value) => value && !joinPattern.test(value) && !viewPattern.test(value));
  return headings[0] || null;
}

function firstMatchingButton(snapshot, pattern) {
  return (snapshot.buttons || []).find((value) => pattern.test(String(value).trim())) || null;
}

export function classifyWhatsAppSnapshot(task, snapshot) {
  const bodyText = String(snapshot.bodyText || '');
  const expectedInviteContext = inviteContextMatches(snapshot, task);

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

  if (expectedInviteContext && joinRetryLaterPattern.test(bodyText)) {
    return {
      kind:'result',
      result:{ status:'failed', targetVerified:true, reason:'whatsapp_join_retry_later' },
    };
  }

  const observedName = exactTarget(snapshot, task);
  if (!observedName) {
    return { kind: 'blocked', reason: 'target_not_verified' };
  }

  const normalizedObserved = normalizeTargetLabel(observedName);
  const headerMatches = [...(snapshot.headerNames || []), ...(snapshot.headerTitles || [])].some(
    (value) => normalizeTargetLabel(value) === normalizedObserved,
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
        ...deriveWhatsappQualification(snapshot),
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
  if (viewButtonText) {
    return { kind: 'action', action: 'view', buttonText: viewButtonText, observedName };
  }

  if (task.action === 'join_and_inspect' && approvalRequiredPattern.test(targetRegionText)) {
    return {
      kind:'result',
      result:{
        status:'failed',
        targetVerified:true,
        accessible:true,
        membershipState:'not_checked',
        observedName,
        chatType:'group',
        reason:'approval_required',
      },
    };
  }

  const requestButtonText = firstMatchingButton(snapshot, requestJoinPattern);
  if (requestButtonText && task.action === 'join_and_inspect') {
    return {
      kind:'result',
      result:{
        status:'failed',
        targetVerified:true,
        accessible:true,
        membershipState:'not_checked',
        observedName,
        chatType:'group',
        reason:'approval_required',
      },
    };
  }

  const joinButtonText = firstMatchingButton(snapshot, directJoinPattern);
  if (joinButtonText && task.action === 'join_and_inspect') {
    return { kind: 'action', action: 'join', buttonText: joinButtonText, observedName };
  }

  return { kind: 'blocked', reason: 'membership_not_confirmed' };
}

export async function leaveWhatsappTaskViaCdp(
  task,
  { cdpBaseUrl, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  if (task.runtime !== 'whatsapp_web' || task.platform !== 'whatsapp' || task.action !== 'leave') {
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

    const operationDeadline = Date.now() + timeoutMs;
    const remainingBudget = () => Math.max(POLL_MS, operationDeadline - Date.now());
    const navigatedInviteCode = whatsappInviteCode(task.expectedTarget?.link || task.link);
    let opened = await waitForClassification(client, { ...task, action: 'inspect' }, remainingBudget(), null, navigatedInviteCode);
    if (opened.kind === 'action' && opened.action === 'view') {
      const observedTarget = opened.observedName || task.expectedTarget?.name || task.name;
      const clicked = await clickExactButton(client, opened.buttonText, observedTarget);
      if (!clicked) return { kind: 'blocked', reason: 'expected_control_disappeared' };
      const observedTask = opened.observedName
        ? { ...task, name:opened.observedName, expectedTarget:{ ...task.expectedTarget, name:opened.observedName } }
        : { ...task, action:'inspect' };
      opened = await waitForClassification(client, { ...observedTask, action: 'inspect' }, remainingBudget(), 'view', navigatedInviteCode);
    }
    if (opened.kind !== 'result' || opened.result.membershipState !== 'joined' || opened.result.targetVerified !== true) {
      return { kind: 'blocked', reason: opened.reason || 'joined_target_not_verified' };
    }

    const observedTarget = opened.result.observedName || task.expectedTarget?.name || task.name;
    if (!await clickExactHeader(client, observedTarget)) {
      return { kind: 'blocked', reason: 'target_header_disappeared' };
    }
    const leaveControl = await waitForExactControl(client, leavePattern, remainingBudget(), false);
    if (!leaveControl) return { kind: 'blocked', reason: 'leave_control_not_found' };
    if (!await clickDocumentControl(client, leaveControl, observedTarget)) {
      return { kind: 'blocked', reason: 'leave_control_disappeared' };
    }
    const confirmControl = await waitForExactControl(client, confirmLeavePattern, remainingBudget(), true);
    if (!confirmControl) return { kind: 'blocked', reason: 'leave_confirmation_not_found' };
    if (!await clickDialogControl(client, confirmControl)) {
      return { kind: 'blocked', reason: 'leave_confirmation_disappeared' };
    }

    while (Date.now() < operationDeadline) {
      const snapshot = await readSnapshot(client);
      if (leftPattern.test(String(snapshot.bodyText || '')) && !snapshot.composer) {
        return { kind: 'result', result: { targetVerified: true, left: true } };
      }
      await sleep(POLL_MS);
    }
    return { kind: 'blocked', reason: 'leave_not_confirmed' };
  } finally {
    client.close();
  }
}

async function injectWhatsappImage(client, media) {
  const openAttach = `(() => {
    const visible=(node)=>{const r=node.getBoundingClientRect();return r.width>0&&r.height>0;};
    const inputs=[...document.querySelectorAll('input[type="file"]')].filter((node)=>/image|video/i.test(node.getAttribute('accept')||''));
    if(inputs.length)return 'ready';
    const controls=[...document.querySelectorAll('footer button, footer [role="button"], #main footer button, #main footer [role="button"]')].filter(visible);
    const label=(node)=>String(node.getAttribute('aria-label')||node.getAttribute('title')||node.textContent||'').trim();
    const button=controls.find((node)=>/attach|прикріп|прикреп|додати|добавить/i.test(label(node)))
      ||controls.find((node)=>node.querySelector('[data-icon*="plus"], [data-icon*="attach"], [data-testid*="attach"]'));
    if(!button)return 'missing';
    button.click();
    return 'clicked';
  })()`;
  const opened=await client.send('Runtime.evaluate',{expression:openAttach,returnByValue:true});
  if(opened?.result?.value==='missing')return false;
  if(opened?.result?.value==='clicked')await sleep(350);
  const expression=`(() => {
    const inputs=[...document.querySelectorAll('input[type="file"]')];
    const input=inputs.find((node)=>/image|video/i.test(node.getAttribute('accept')||''))||inputs[0];
    if(!input||typeof DataTransfer==='undefined')return false;
    try{
      const raw=atob(${JSON.stringify(String(media.base64||''))});
      const bytes=new Uint8Array(raw.length);
      for(let i=0;i<raw.length;i+=1)bytes[i]=raw.charCodeAt(i);
      const file=new File([bytes],${JSON.stringify(String(media.fileName||'work-os.jpg'))},{type:${JSON.stringify(String(media.contentType||'image/jpeg'))}});
      const transfer=new DataTransfer();
      transfer.items.add(file);
      input.files=transfer.files;
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.dispatchEvent(new Event('change',{bubbles:true}));
      return input.files?.length===1;
    }catch{return false;}
  })()`;
  const response=await client.send('Runtime.evaluate',{expression,returnByValue:true});
  return response?.result?.value===true;
}

async function waitForWhatsappMediaPreview(client,timeoutMs){
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){
    const expression=`(() => {
      const visible=(node)=>{const r=node.getBoundingClientRect();return r.width>0&&r.height>0;};
      const editors=[...document.querySelectorAll('[contenteditable="true"][role="textbox"], [contenteditable="true"]')].filter(visible);
      const caption=editors.find((node)=>!node.closest('footer'));
      const send=[...document.querySelectorAll('button, [role="button"]')].filter(visible).find((node)=>{
        const label=String(node.getAttribute('aria-label')||node.getAttribute('title')||node.textContent||'').trim();
        return /^(send|надіслати|відправити|отправить)$/i.test(label)||Boolean(node.querySelector('[data-icon="send"], [data-testid*="send"]'));
      });
      return Boolean(caption&&send);
    })()`;
    const response=await client.send('Runtime.evaluate',{expression,returnByValue:true});
    if(response?.result?.value===true)return true;
    await sleep(POLL_MS);
  }
  return false;
}

async function focusAndClearWhatsappMediaCaption(client){
  const expression=`(() => {
    const visible=(node)=>{const r=node.getBoundingClientRect();return r.width>0&&r.height>0;};
    const editors=[...document.querySelectorAll('[contenteditable="true"][role="textbox"], [contenteditable="true"]')].filter(visible);
    const node=editors.find((item)=>!item.closest('footer'));
    if(!node)return false;
    node.focus();
    const selection=window.getSelection();
    const range=document.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();selection.addRange(range);
    document.execCommand('delete');
    node.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'deleteContentBackward',data:null}));
    return true;
  })()`;
  const response=await client.send('Runtime.evaluate',{expression,returnByValue:true});
  return response?.result?.value===true;
}

async function waitForWhatsappMediaCaption(client,expectedText,timeoutMs){
  const expected=normalizeMessageText(expectedText);
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){
    const expression=`(() => {
      const visible=(node)=>{const r=node.getBoundingClientRect();return r.width>0&&r.height>0;};
      const editors=[...document.querySelectorAll('[contenteditable="true"][role="textbox"], [contenteditable="true"]')].filter(visible);
      const node=editors.find((item)=>!item.closest('footer'));
      return String(node?.innerText||node?.textContent||'');
    })()`;
    const response=await client.send('Runtime.evaluate',{expression,returnByValue:true});
    if(normalizeMessageText(response?.result?.value||'')===expected)return true;
    await sleep(POLL_MS);
  }
  return false;
}

async function clickWhatsappMediaSend(client){
  const expression=`(() => {
    const visible=(node)=>{const r=node.getBoundingClientRect();return r.width>0&&r.height>0;};
    const controls=[...document.querySelectorAll('button, [role="button"]')].filter(visible);
    const matches=(node)=>{
      const label=String(node.getAttribute('aria-label')||node.getAttribute('title')||node.textContent||'').trim();
      return /^(send|надіслати|відправити|отправить)$/i.test(label)||Boolean(node.querySelector('[data-icon="send"], [data-testid*="send"]'));
    };
    const button=controls.find((node)=>!node.closest('footer')&&matches(node))||controls.find(matches);
    if(!button||button.hasAttribute('disabled'))return false;
    button.click();return true;
  })()`;
  const response=await client.send('Runtime.evaluate',{expression,returnByValue:true});
  return response?.result?.value===true;
}

export async function sendWhatsappAutopostViaCdp(
  task,
  { cdpBaseUrl, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  if (task?.kind !== 'whatsapp_autopost') return { kind:'blocked', reason:'unsupported_runtime' };
  const targetUrl = toWhatsAppWebInviteUrl(task.target?.expectedLink);
  if (!targetUrl) return { kind:'blocked', reason:'invalid_whatsapp_link' };
  if (!cdpBaseUrl) return { kind:'blocked', reason:'cdp_not_configured' };
  const base = normalizeLocalCdpBaseUrl(cdpBaseUrl);
  if (!base) return { kind:'blocked', reason:'cdp_not_local' };
  const text = String(task.material?.text || '');
  if (!text.trim()) return { kind:'blocked', reason:'empty_material' };

  const page = await findOrCreateWhatsappPage(base);
  if (!isLocalCdpWebSocketUrl(page.webSocketDebuggerUrl)) return { kind:'blocked', reason:'cdp_websocket_not_local' };
  const client = await createCdpClient(page.webSocketDebuggerUrl);
  try {
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Page.navigate', { url: targetUrl });
    const inspectTask = {
      runtime:'whatsapp_web', platform:'whatsapp', action:'inspect',
      name:task.target.expectedName,
      link:task.target.expectedLink,
      expectedTarget:{name:task.target.expectedName,link:task.target.expectedLink},
    };
    const navigatedInviteCode = whatsappInviteCode(task.target?.expectedLink);
    let classified = await waitForClassification(client, inspectTask, timeoutMs, null, navigatedInviteCode);
    if (classified.kind === 'action' && classified.action === 'view') {
      const clicked = await clickExactButton(client, classified.buttonText, classified.observedName || task.target.expectedName);
      if (!clicked) return { kind:'blocked', reason:'expected_control_disappeared' };
      const observedTask = classified.observedName
        ? { ...inspectTask, name:classified.observedName, expectedTarget:{...inspectTask.expectedTarget,name:classified.observedName} }
        : inspectTask;
      classified = await waitForClassification(client, observedTask, timeoutMs, 'view', navigatedInviteCode);
    }
    if (classified.kind !== 'result' || classified.result.targetVerified !== true || classified.result.membershipState !== 'joined') {
      return { kind:'blocked', reason:classified.reason || 'joined_target_not_verified' };
    }
    const observedTarget = classified.result.observedName || task.target.expectedName;
    const before = await readSnapshot(client);
    if (!before.composer) return { kind:'blocked', reason:before.adminOnly ? 'admin_only' : 'read_only' };
    const beforeKeys = new Set((before.messageRows || []).map((row) => row.key).filter(Boolean));
    const media=task.material?.media;
    if(media?.base64){
      if(!/^image\/(jpeg|png|webp)$/u.test(String(media.contentType||'')))return {kind:'blocked',reason:'unsupported_media_type'};
      if(!await injectWhatsappImage(client,media))return {kind:'blocked',reason:'media_attach_failed'};
      if(!await waitForWhatsappMediaPreview(client,Math.min(timeoutMs,8_000)))return {kind:'blocked',reason:'media_preview_not_ready'};
      if(!await focusAndClearWhatsappMediaCaption(client))return {kind:'blocked',reason:'media_caption_not_found'};
      await client.send('Input.insertText',{text});
      if(!await waitForWhatsappMediaCaption(client,text,Math.min(timeoutMs,5_000)))return {kind:'blocked',reason:'media_caption_mismatch'};
      if(!await clickWhatsappMediaSend(client))return {kind:'blocked',reason:'media_send_control_not_found'};
      const expected=normalizeMessageText(text);
      const deadline=Date.now()+timeoutMs;
      while(Date.now()<deadline){
        const snapshot=await readSnapshot(client);
        const confirmed=(snapshot.messageRows||[]).some((row)=>
          row.key&&!beforeKeys.has(row.key)&&row.hasMedia===true&&normalizeMessageText(row.text||'').includes(expected)
        );
        if(confirmed)return {kind:'result',result:{status:'sent',observedTarget,targetVerified:true,sendConfirmed:true,mediaConfirmed:true}};
        await sleep(POLL_MS);
      }
      return {kind:'blocked',reason:'media_send_not_confirmed'};
    }
    if (!await focusAndClearComposer(client)) return { kind:'blocked', reason:'composer_not_found' };
    await client.send('Input.insertText', { text });
    const prepared = await waitForComposerText(client, text, Math.min(timeoutMs, 5_000));
    if (!prepared) return { kind:'blocked', reason:'composer_content_mismatch' };

    await client.send('Input.dispatchKeyEvent', { type:'keyDown', key:'Enter', code:'Enter', windowsVirtualKeyCode:13, nativeVirtualKeyCode:13 });
    await client.send('Input.dispatchKeyEvent', { type:'keyUp', key:'Enter', code:'Enter', windowsVirtualKeyCode:13, nativeVirtualKeyCode:13 });

    const expected = normalizeMessageText(text);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const snapshot = await readSnapshot(client);
      const confirmed = (snapshot.messageRows || []).some((row) =>
        row.key && !beforeKeys.has(row.key) && normalizeMessageText(row.text) === expected
      );
      if (confirmed && !normalizeMessageText(snapshot.composerText || '')) {
        return { kind:'result', result:{ status:'sent', observedTarget, targetVerified:true, sendConfirmed:true } };
      }
      await sleep(POLL_MS);
    }
    return { kind:'blocked', reason:'send_not_confirmed' };
  } finally {
    client.close();
  }
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

    const operationDeadline = Date.now() + timeoutMs;
    const remainingBudget = () => Math.max(POLL_MS, operationDeadline - Date.now());
    const navigatedInviteCode = whatsappInviteCode(task.expectedTarget?.link || task.link);
    let currentTask = task;
    let classified = await waitForClassification(client, currentTask, remainingBudget(), null, navigatedInviteCode);
    for (let step = 0; step < 3 && classified.kind === 'action'; step += 1) {
      const observedName = classified.observedName || currentTask.expectedTarget?.name || currentTask.name;
      const clicked = await clickExactButton(client, classified.buttonText, observedName);
      if (!clicked) return { kind: 'blocked', reason: 'expected_control_disappeared' };
      const observedTask = classified.observedName
        ? { ...currentTask, name:classified.observedName, expectedTarget:{ ...currentTask.expectedTarget, name:classified.observedName } }
        : currentTask;
      const action = classified.action;
      classified = await waitForClassification(client, observedTask, remainingBudget(), action, navigatedInviteCode);
      currentTask = observedTask;
    }
    if (classified.kind === 'result' && classified.result.membershipState === 'joined' && classified.result.targetVerified === true) {
      classified = { kind:'result', result:await enrichJoinedQualification(client, currentTask, classified.result) };
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

async function waitForClassification(client, task, timeoutMs, afterAction = null, navigatedInviteCode = null) {
  const deadline = Date.now() + timeoutMs;
  let last = { kind: 'blocked', reason: 'page_not_ready' };
  while (Date.now() < deadline) {
    const snapshot = await readSnapshot(client);
    if (navigatedInviteCode) snapshot.navigatedInviteCode = navigatedInviteCode;
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
      [...root.querySelectorAll(selector)].map((node) =>
        node.getAttribute('title') || node.getAttribute('aria-label') || node.textContent || ''
      )
    ));
    const bodyText = document.body?.innerText || '';
    const headerNames = read(document, [
      '#main header [data-testid="conversation-info-header-chat-title"]',
      '#main header [dir="auto"]',
      '[data-testid="conversation-info-header"] [dir="auto"]',
    ]);
    const headerTitles = read(document, [
      '[data-testid="conversation-info-header"] [title]',
      'header [title]',
      'header h1',
      'header h2',
    ]);
    const dialog = document.querySelector('[role="dialog"], [data-animate-modal-popup="true"]');
    const targetHeadings = dialog ? read(dialog, ['[data-testid="group-join-modal-group-name"]', 'h1', 'h2', 'h3', '[title]']) : [];
    const targetTexts = dialog ? read(dialog, ['[title]', 'h1', 'h2', 'h3', 'span']) : [];
    const buttons = read(document, ['button', '[role="button"]']);
    const main = document.querySelector('#main');
    const mainText = clean(main?.innerText || '').slice(-30000);
    const info = document.querySelector('[data-testid="drawer-right"], [data-testid="chat-info-drawer"]');
    const groupInfoText = clean(info?.innerText || '').slice(0,30000);
    const messageTexts = unique([...document.querySelectorAll('[data-testid="msg-container"], #main [data-pre-plain-text]')]
      .slice(-30).map((node) => clean(node.innerText || node.textContent || '').slice(0,1200)));
    const messageMeta = unique([...document.querySelectorAll('#main [data-pre-plain-text]')]
      .slice(-30).map((node) => node.getAttribute('data-pre-plain-text') || ''));
    const composerNode = document.querySelector(
      'footer [contenteditable="true"][role="textbox"], footer [contenteditable="true"], [data-testid="conversation-compose-box-input"]'
    );
    const composer = Boolean(composerNode);
    const composerText = clean(composerNode?.innerText || composerNode?.textContent || '');
    const messageRows = [...document.querySelectorAll('[data-testid="msg-container"]')].slice(-50).map((node) => {
      const identified = node.getAttribute('data-id') ? node : node.querySelector('[data-id]');
      return {
        key: identified?.getAttribute('data-id') || '',
        text: clean(node.innerText || node.textContent || ''),
        hasMedia: Boolean(node.querySelector('img, video, canvas, [data-testid*="image"], [data-testid*="media"]')),
      };
    }).filter((row) => row.key && (row.text || row.hasMedia));
    const hasQr = Boolean(document.querySelector('canvas[aria-label*="QR" i], [data-ref] canvas'));
    return {
      url: location.href,
      bodyText: bodyText.slice(-50000),
      headerNames,
      headerTitles,
      targetHeadings,
      targetTexts,
      targetRegionText: dialog?.innerText || '',
      buttons,
      dialogButtons: dialog ? read(dialog, ['button', '[role="button"]']) : [],
      mainText,
      groupInfoText,
      messageTexts,
      messageMeta,
      nowMs: Date.now(),
      locale: navigator.language || '',
      composer,
      composerText,
      messageRows,
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

export function deriveWhatsappQualification(snapshot) {
  const infoText = String(snapshot.groupInfoText || snapshot.headerText || '');
  const chatText = String(snapshot.mainText || '');
  const messages = Array.isArray(snapshot.messageTexts) ? snapshot.messageTexts.map(String) : [];
  const meta = Array.isArray(snapshot.messageMeta) ? snapshot.messageMeta.map(String) : [];
  const memberCount = parseMemberCount(infoText);
  const activityState = inferMessageActivity(meta, Number(snapshot.nowMs) || Date.now(), snapshot.locale)
    || (recentActivityPattern.test(chatText) || recentActivityPattern.test(meta.join('\n')) ? 'active' : undefined);
  const identityText = [infoText, ...(snapshot.headerNames || []), ...(snapshot.headerTitles || [])].join('\n');
  const spamMessages = messages.slice(-20).filter((value) => spamPattern.test(value)).length;
  const topicMatch = spamPattern.test(identityText) || spamMessages >= 3
    ? 'mismatch'
    : ukrainianIdentityPattern.test(identityText) ? 'match' : undefined;
  let adsPolicy;
  if (adsForbiddenPattern.test(infoText)) adsPolicy = 'forbidden';
  else if (adsAllowedPattern.test(infoText)) adsPolicy = 'allowed';
  else if (activityState === 'active' && messages.filter((value) => adLikeMessagePattern.test(value)).length >= 2) {
    adsPolicy = 'inferred_allowed';
  }
  return {
    ...(memberCount === undefined ? {} : { memberCount }),
    ...(activityState ? { activityState } : {}),
    ...(topicMatch ? { topicMatch } : {}),
    ...(adsPolicy ? { adsPolicy } : {}),
  };
}

function inferMessageActivity(meta, nowMs, locale) {
  const stamps = meta.map((value) => parseMessageTimestamp(value, nowMs, locale)).filter((value) => Number.isFinite(value));
  if (!stamps.length) return undefined;
  const latest = Math.max(...stamps);
  const ageMs = Math.max(0, nowMs - latest);
  if (ageMs <= 72 * 60 * 60 * 1000) return 'active';
  if (ageMs >= 14 * 24 * 60 * 60 * 1000) return 'dead';
  return undefined;
}

function parseMessageTimestamp(value, nowMs, locale) {
  const text = String(value || '');
  const iso = text.match(/(?:^|[^\d])(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?!\d)/u);
  if (iso) {
    const stamp = validCalendarStamp(Number(iso[1]), Number(iso[2]), Number(iso[3]), nowMs);
    return stamp ?? NaN;
  }

  const match = text.match(/(?:^|[^\d])(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?!\d)/u);
  if (!match) return NaN;
  const a = Number(match[1]);
  const b = Number(match[2]);
  let year = Number(match[3]);
  if (year < 100) year += 2000;

  let day;
  let month;
  if (a > 12 && b <= 12) {
    day = a; month = b;
  } else if (b > 12 && a <= 12) {
    day = b; month = a;
  } else if (a <= 12 && b <= 12) {
    const order = localeDayMonthOrder(locale);
    if (order === 'day-month') { day = a; month = b; }
    else if (order === 'month-day') { day = b; month = a; }
    else return NaN;
  } else {
    return NaN;
  }
  const stamp = validCalendarStamp(year, month, day, nowMs);
  return stamp ?? NaN;
}

function localeDayMonthOrder(locale) {
  if (!String(locale || '').trim()) return null;
  try {
    const sample = new Date(Date.UTC(2026, 10, 22, 12));
    const parts = new Intl.DateTimeFormat(String(locale), {
      day:'numeric', month:'numeric', year:'numeric', timeZone:'UTC',
    }).formatToParts(sample);
    const order = parts.map((part) => part.type).filter((type) => type === 'day' || type === 'month');
    if (order[0] === 'day' && order[1] === 'month') return 'day-month';
    if (order[0] === 'month' && order[1] === 'day') return 'month-day';
  } catch {
    // Unknown locale must remain ambiguous rather than guessing a date order.
  }
  return null;
}

function validCalendarStamp(year, month, day, nowMs) {
  if (!Number.isSafeInteger(year) || !Number.isSafeInteger(month) || !Number.isSafeInteger(day)) return null;
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const stamp = Date.UTC(year, month - 1, day, 12);
  const date = new Date(stamp);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return stamp <= nowMs + 24 * 60 * 60 * 1000 ? stamp : null;
}

function parseMemberCount(value) {
  const text = String(value || '');
  const label = '(?:participants?|members?|учасник(?:ів|и|а)?|участник(?:ов|а|и)?)';
  const compact = text.match(new RegExp('(\\d{1,3}(?:[.,]\\d{1,2})?)\\s*(?:k|тис\\.?|тыс\\.?)\\s*'+label, 'iu'));
  if (compact) {
    const amount = Number(compact[1].replace(',', '.'));
    const count = Math.round(amount * 1000);
    return Number.isFinite(amount) && amount > 0 && Number.isSafeInteger(count) && count <= 10_000_000 ? count : undefined;
  }
  const match = text.match(new RegExp('(\\d[\\d\\s.,\\u00a0]{0,12})\\s*'+label, 'iu'));
  if (!match) return undefined;
  const digits = match[1].replace(/\D/gu, '');
  if (!digits) return undefined;
  const count = Number(digits);
  return Number.isSafeInteger(count) && count >= 0 && count <= 10_000_000 ? count : undefined;
}

async function enrichJoinedQualification(client, task, result) {
  const before = await readSnapshot(client);
  let combined = { ...deriveWhatsappQualification(before) };
  const expectedName = result.observedName || task.expectedTarget?.name || task.name;
  if (expectedName && await clickExactHeader(client, expectedName)) {
    const expected = normalizeTargetLabel(expectedName);
    const deadline = Date.now() + 5_000;
    let infoSnapshot = await readSnapshot(client);
    while (Date.now() < deadline) {
      const infoText = normalizeTargetLabel(infoSnapshot.groupInfoText || '');
      if (infoText && (!expected || infoText.includes(expected))) break;
      await sleep(POLL_MS);
      infoSnapshot = await readSnapshot(client);
    }
    combined = {
      ...combined,
      ...deriveWhatsappQualification({
        ...infoSnapshot,
        mainText: before.mainText,
        messageTexts: before.messageTexts,
        messageMeta: before.messageMeta,
      }),
    };
  }
  return { ...result, ...combined };
}

async function focusAndClearComposer(client) {
  const expression = `(() => {
    const node = document.querySelector(
      'footer [contenteditable="true"][role="textbox"], footer [contenteditable="true"], [data-testid="conversation-compose-box-input"]'
    );
    if (!node) return false;
    node.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand('delete');
    node.dispatchEvent(new InputEvent('input', { bubbles:true, inputType:'deleteContentBackward', data:null }));
    return true;
  })()`;
  const response = await client.send('Runtime.evaluate', { expression, returnByValue:true });
  return response?.result?.value === true;
}

async function waitForComposerText(client, expectedText, timeoutMs) {
  const expected = normalizeMessageText(expectedText);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await readSnapshot(client);
    if (snapshot.composer && normalizeMessageText(snapshot.composerText || '') === expected) return true;
    await sleep(POLL_MS);
  }
  return false;
}

function normalizeMessageText(value) {
  return String(value || '').replace(/\r\n/gu, '\n').replace(/\u00a0/gu, ' ').trim();
}

async function clickExactHeader(client, expectedName) {
  const expression = `(() => {
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim().toLocaleLowerCase('uk-UA');
    const target = ${JSON.stringify(String(expectedName || '').trim().toLocaleLowerCase('uk-UA'))};
    const nodes = [...document.querySelectorAll('#main header [data-testid="conversation-info-header-chat-title"], #main header [dir="auto"], [data-testid="conversation-info-header"] [dir="auto"], [data-testid="conversation-info-header"] [title], header [title], header h1, header h2')];
    const node = nodes.find((item) => normalize(item.getAttribute('title') || item.textContent) === target);
    if (!node) return false;
    (node.closest('button, [role="button"]') || node).click();
    return true;
  })()`;
  const response = await client.send('Runtime.evaluate', { expression, returnByValue: true });
  return response?.result?.value === true;
}
async function waitForExactControl(client, pattern, timeoutMs, dialogOnly) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await readSnapshot(client);
    const values = dialogOnly ? snapshot.dialogButtons || [] : snapshot.buttons || [];
    const found = values.find((value) => pattern.test(String(value).trim()));
    if (found) return found;
    await sleep(POLL_MS);
  }
  return null;
}
async function clickDocumentControl(client, label, expectedName) {
  const expression = `(() => {
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim().toLocaleLowerCase('uk-UA');
    const expected = ${JSON.stringify(String(label || '').trim().toLocaleLowerCase('uk-UA'))};
    const target = ${JSON.stringify(String(expectedName || '').trim().toLocaleLowerCase('uk-UA'))};
    const headerMatches = [...document.querySelectorAll('#main header [data-testid="conversation-info-header-chat-title"], #main header [dir="auto"], [data-testid="conversation-info-header"] [dir="auto"], [data-testid="conversation-info-header"] [title], header [title], header h1, header h2')]
      .some((node) => normalize(node.getAttribute('title') || node.textContent) === target);
    if (!headerMatches) return false;
    const nodes = [...document.querySelectorAll('button, [role="button"]')];
    const labelOf = (item) => item.getAttribute('aria-label') || item.getAttribute('title') || item.textContent || '';
    const node = nodes.find((item) => normalize(labelOf(item)) === expected && !item.hasAttribute('disabled'));
    if (!node) return false;
    node.click();
    return true;
  })()`;
  const response = await client.send('Runtime.evaluate', { expression, returnByValue: true });
  return response?.result?.value === true;
}
async function clickDialogControl(client, label) {
  const expression = `(() => {
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim().toLocaleLowerCase('uk-UA');
    const expected = ${JSON.stringify(String(label || '').trim().toLocaleLowerCase('uk-UA'))};
    const dialog = document.querySelector('[role="dialog"], [data-animate-modal-popup="true"]');
    if (!dialog) return false;
    const nodes = [...dialog.querySelectorAll('button, [role="button"]')];
    const labelOf = (item) => item.getAttribute('aria-label') || item.getAttribute('title') || item.textContent || '';
    const node = nodes.find((item) => normalize(labelOf(item)) === expected && !item.hasAttribute('disabled'));
    if (!node) return false;
    node.click();
    return true;
  })()`;
  const response = await client.send('Runtime.evaluate', { expression, returnByValue: true });
  return response?.result?.value === true;
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
