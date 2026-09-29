// Real WhatsApp invite resolution can exceed 20s before the factual join/retry modal appears.
const DEFAULT_TIMEOUT_MS = 45_000;
const POLL_MS = 400;

const pendingPattern = /(?:request(?: to join)? sent|request pending|запит (?:на вступ )?надіслано|запит очікує|заявк[ау] (?:на вступление )?отправлен[а]?|заявк[ау] ожидает)/iu;
const approvalRequiredPattern = /(?:admin(?:istrator)? approval (?:is )?(?:required|turned on)|an admin (?:must|needs to) approve|request to join|потрібне схвалення адміністратор|адміністратор має схвалити|потрібно подати запит на вступ|требуется одобрение администратора|администратор должен одобрить|нужно отправить запрос на вступление)/iu;
const adminOnlyPattern = /(?:only (?:community )?admins can send messages|лише адміністратори(?: спільноти)? можуть надсилати повідомлення|только администраторы(?: сообщества)? могут отправлять сообщения)/iu;
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
const leftPattern = /(?:you (?:left|are no longer a participant)|ви (?:вийшли|більше не (?:є учасником|її учасник|учасник))|вы (?:вышли|больше не (?:являетесь участником|ее участник|участник)))/iu;
const joinedViaInvitePattern = /(?:you (?:joined|were added) (?:via|using|through) (?:an? )?(?:invite|invitation|invite link)|joined (?:via|using) (?:the )?(?:group )?invite|ви приєдналися за (?:посиланням[- ]?)?запрошенням|вы присоединились по (?:ссылке[- ]?)?приглашени[юя])/iu;
const spamPattern = /(?:crypto|крипт|bitcoin|forex|casino|казино|betting|ставк[аи]|dating|знакомств|знайомств|escort|ескорт|onlyfans|adult|18\+|nft|airdrop|signals?\b|binary options)/iu;
const ukrainianIdentityPattern = /(?:україн|украин|ukrain|ukraiń|ukrajin|ucrain|ucran|oekra|🇺🇦)/iu;
const adsForbiddenPattern = /(?:no\s+(?:ads?|advertis(?:ing|ements?))|advertis(?:ing|ements?)\s+(?:is\s+)?(?:forbidden|prohibited)|(?:реклам[ауи]|оголошення)\s+(?:суворо\s+)?заборонен|без\s+реклами|(?:реклам[ауы]|объявления)\s+(?:строго\s+)?запрещен|без\s+рекламы)/iu;
const adsAllowedPattern = /(?:ads?\s+allowed|advertis(?:ing|ements?)\s+allowed|оголошення\s+дозволен|реклам[ауи]\s+дозволен|объявления\s+разрешен|реклам[ауы]\s+разрешен)/iu;
const adLikeMessagePattern = /(?:продам|продаю|продаж|куплю|купую|віддам|отдам|обмін|обмен|шукаю|ищу|послуг|услуг|урок|репетитор|оренд|аренд|здам|сдам|робот[ауи]|работ[ауи]|ваканс|доставк|перевез|advert|for\s+sale|give\s+away|exchange|looking\s+for|services?|rent|job|vacanc)/iu;
const recentActivityPattern = /(?:^|\s)(?:today|yesterday|сьогодні|вчора|сегодня|вчера)(?:\s|$)/iu;
const messagesLoadingPattern = /(?:messages are loading|повідомлення завантажуються|сообщения загружаются|не закривайте це вікно|keep this window open)/iu;
const ukrainianConversationPattern = /(?:україн|украин|ukraiń|ukrajin|ucrain|ucran|oekra|🇺🇦|\bвпо\b|біжен|переселен|\bгрн\b|доброго дня|будь ласка|оголошення|послуг[аи]|репетитор)/iu;

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
  if(text.length>140) return true;
  if(/<\/?[a-z][^>]*>|(?:src|href|class|id)\s*=\s*["']|https?:\/\/|chat\.whatsapp\.com/iu.test(text)) return true;
  if(/(?:notion-|svelte|data-testid|aria-label|\/groups\/|ref=share|\bviews?\b|[_-]{5,})/iu.test(text)) return true;
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

export async function queryWhatsappInviteViaCdp(
  task,
  { cdpBaseUrl, timeoutMs = 6_000 } = {},
) {
  if (task.runtime !== 'whatsapp_web' || task.platform !== 'whatsapp') {
    return { kind:'blocked', reason:'unsupported_runtime' };
  }
  const inviteCode=whatsappInviteCode(task.expectedTarget?.link || task.link);
  if(!inviteCode)return { kind:'blocked', reason:'invalid_whatsapp_link' };
  if(!cdpBaseUrl)return { kind:'blocked', reason:'cdp_not_configured' };
  const base=normalizeLocalCdpBaseUrl(cdpBaseUrl);
  if(!base)return { kind:'blocked', reason:'cdp_not_local' };
  const page=await findOrCreateWhatsappPage(base);
  if(!isLocalCdpWebSocketUrl(page.webSocketDebuggerUrl)){
    return { kind:'blocked', reason:'cdp_websocket_not_local' };
  }
  const client=await createCdpClient(page.webSocketDebuggerUrl);
  try{
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    const response=await client.send('Runtime.evaluate',{
      expression:`(async()=>{
        try{
          const module=window.require?.('WAWebGroupQueryJob');
          if(!module?.queryGroupInvite)return {ok:false,reason:'invite_query_unavailable'};
          const timeout=new Promise((_,reject)=>setTimeout(()=>reject(new Error('invite_query_timeout')),${Math.max(1_000,Math.min(10_000,Number(timeoutMs)||6_000))}));
          const info=await Promise.race([module.queryGroupInvite(${JSON.stringify(inviteCode)}),timeout]);
          return {
            ok:true,
            subject:String(info?.subject||''),
            size:Number.isFinite(Number(info?.size))?Number(info.size):null,
            desc:String(info?.desc||''),
            announce:typeof info?.announce==='boolean'?info.announce:null,
            membershipApprovalMode:typeof info?.membershipApprovalMode==='boolean'?info.membershipApprovalMode:null,
            isParentGroup:info?.isParentGroup===true,
            id:String(info?.id?._serialized||info?.id||''),
          };
        }catch(error){
          return {ok:false,name:String(error?.name||''),message:String(error?.message||error||'')};
        }
      })()`,
      returnByValue:true,
      awaitPromise:true,
    });
    const value=response?.result?.value||{};
    if(value.ok!==true){
      const message=String(value.message||value.reason||'');
      if(/sendIq called before startComms|invite_query_timeout|invite_query_unavailable/iu.test(message)){
        return {kind:'blocked',reason:'page_not_ready'};
      }
      if(/not-found|invalid|expired|bad[- ]request|gone/iu.test(message)){
        return {kind:'result',result:{status:'failed',reason:'invalid_whatsapp_link',targetVerified:true,accessible:false}};
      }
      return {kind:'blocked',reason:'invite_query_failed',diagnostic:{name:value.name||'',message}};
    }
    const observedName=String(value.subject||'').trim()||task.name;
    const description=String(value.desc||'').trim();
    const evidence=`${observedName}\n${description}`;
    const memberCount=Number.isFinite(Number(value.size))&&Number(value.size)>0?Number(value.size):undefined;
    const topicMatch=spamPattern.test(evidence)?'mismatch':ukrainianIdentityPattern.test(evidence)?'match':'unknown';
    let adsPolicy;
    if(adsForbiddenPattern.test(description))adsPolicy='forbidden';
    else if(adsAllowedPattern.test(description))adsPolicy='allowed';
    const canWrite=value.announce===true?false:value.announce===false?true:undefined;
    return {
      kind:'result',
      result:{
        status:'invite_queried',
        targetVerified:true,
        accessible:true,
        observedName,
        chatType:value.isParentGroup===true?'community':'group',
        ...(memberCount===undefined?{}:{memberCount}),
        topicMatch,
        ...(canWrite===undefined?{}:{canWrite}),
        ...(adsPolicy?{adsPolicy}:{}),
        approvalRequired:value.membershipApprovalMode===true,
        description,
        groupId:String(value.id||''),
        inviteCode,
      },
    };
  }finally{
    client.close();
  }
}


export async function joinWhatsappInviteViaRuntime(
  task,
  { cdpBaseUrl, timeoutMs = 10_000 } = {},
) {
  if (task.runtime !== 'whatsapp_web' || task.platform !== 'whatsapp') {
    return { kind:'blocked', reason:'unsupported_runtime' };
  }
  const inviteCode=whatsappInviteCode(task.expectedTarget?.link || task.link);
  if(!inviteCode)return {kind:'blocked',reason:'invalid_whatsapp_link'};
  const base=normalizeLocalCdpBaseUrl(cdpBaseUrl);
  if(!base)return {kind:'blocked',reason:cdpBaseUrl?'cdp_not_local':'cdp_not_configured'};
  const page=await findOrCreateWhatsappPage(base);
  if(!isLocalCdpWebSocketUrl(page.webSocketDebuggerUrl))return {kind:'blocked',reason:'cdp_websocket_not_local'};
  const client=await createCdpClient(page.webSocketDebuggerUrl);
  try{
    await client.send('Runtime.enable');
    const response=await client.send('Runtime.evaluate',{
      expression:`(async()=>{
        const timeoutMs=${Math.max(2_000,Math.min(15_000,Number(timeoutMs)||10_000))};
        let joinedGroupId='';
        const deadline=Date.now()+timeoutMs;
        const race=(promise,label)=>Promise.race([
          promise,
          new Promise((_,reject)=>setTimeout(()=>reject(new Error(label+'_timeout')),Math.max(1,deadline-Date.now()))),
        ]);
        try{
          const query=window.require?.('WAWebGroupQueryJob');
          const invite=window.require?.('WAWebGroupInviteJob');
          const collections=window.require?.('WAWebCollections');
          const widFactory=window.require?.('WAWebWidFactory');
          const loader=window.require?.('WAWebChatLoadMessages');
          if(!query?.queryGroupInvite||!invite?.joinGroupViaInvite||!collections?.Chat||!widFactory?.createWid){
            return {ok:false,reason:'direct_join_unavailable'};
          }
          const facts=${JSON.stringify(task.preflightFacts||null)};
           const pre=facts?{
             id:facts.groupId,subject:facts.observedName,desc:facts.description,
             size:facts.memberCount,announce:typeof facts.canWrite==='boolean'?!facts.canWrite:undefined,
             membershipApprovalMode:facts.approvalRequired,isParentGroup:facts.chatType==='community',
           }:await race(query.queryGroupInvite(${JSON.stringify(inviteCode)}),'invite_query');
          if(pre?.membershipApprovalMode===true){
            return {ok:false,reason:'approval_required',approvalRequired:true};
          }
          const alreadyJoined=${JSON.stringify(task.membershipState==='joined')};
           const knownGroupId=${JSON.stringify(String(task.groupId||''))}||String(pre?.id?._serialized||pre?.id||'');
           if(alreadyJoined&&!knownGroupId)return {ok:false,reason:'joined_identity_missing'};
           const joins=window.__workOsDiscoveryJoins||(window.__workOsDiscoveryJoins=new Map());
           const code=${JSON.stringify(inviteCode)};
           let joining=joins.get(code);
           if(!alreadyJoined&&!joining){
             joining=invite.joinGroupViaInvite(code);
             joins.set(code,joining);
             joining.catch(()=>{if(joins.get(code)===joining)joins.delete(code);});
           }
           const joined=alreadyJoined?{gid:knownGroupId}:await race(joining,'direct_join');
          const gid=String(joined?.gid?._serialized||joined?.gid||pre?.id?._serialized||pre?.id||'');
          if(!gid)return {ok:false,reason:'join_not_confirmed'};
           joinedGroupId=gid;
          const wid=widFactory.createWid(gid);
          let chat=collections.Chat.get(wid);
          if(!chat&&collections.Chat.find)chat=await race(collections.Chat.find(wid),'chat_find');
          if(!chat)return {ok:false,reason:'joined_chat_not_found',gid};
          if(loader?.loadRecentMsgs){
            try{await race(loader.loadRecentMsgs(chat),'recent_messages');}catch{}
          }
          if(loader?.loadEarlierMsgs){
            for(let historyPage=0;historyPage<2&&Date.now()<deadline-500;historyPage++){
              try{await race(loader.loadEarlierMsgs(chat),'earlier_messages_'+historyPage);}
              catch{break;}
            }
          }
          await new Promise(resolve=>setTimeout(resolve,250));
          const metadata=chat.groupMetadata||{};
          const models=Array.isArray(chat.msgs?._models)
            ? chat.msgs._models
            : Array.isArray(chat.msgs?.models)?chat.msgs.models:[];
          const messages=models.slice(-100).map(msg=>({
            body:String(msg?.body||msg?.caption||msg?.__x_body||'').slice(0,1600),
            timestamp:Number(msg?.t||msg?.timestamp||msg?.__x_t||0)||0,
            type:String(msg?.type||msg?.__x_type||''),
          }));
          const sizeCandidates=[
            Number(metadata?.participants?.size),
            Number(metadata?.participants?.length),
            Number(metadata?.__x_size),
            Number(metadata?.size),
            Number(pre?.size),
          ].filter(value=>Number.isFinite(value)&&value>0);
          const parentId=String(
            metadata?.parentGroup?._serialized||metadata?.parentGroup||
            metadata?.parentGroupId?._serialized||metadata?.parentGroupId||''
          );
          let parentTitle='';
          let parentDesc='';
          if(parentId){
            try{
              const parentWid=widFactory.createWid(parentId);
              const parent=collections.Chat.get(parentWid)||(collections.Chat.find?await race(collections.Chat.find(parentWid),'parent_find'):null);
              const parentMetadata=parent?.groupMetadata||{};
              parentTitle=String(parent?.formattedTitle||parent?.name||parentMetadata?.subject||'');
              parentDesc=String(parentMetadata?.desc||parentMetadata?.__x_desc||'');
            }catch{}
          }
          return {
            ok:true,
            gid,
            subject:String(chat.formattedTitle||chat.name||metadata?.subject||pre?.subject||''),
            desc:String(metadata?.desc||metadata?.__x_desc||pre?.desc||''),
            parentId,
            parentTitle,
            parentDesc,
            size:sizeCandidates.length?Math.max(...sizeCandidates):null,
            announce:typeof metadata?.announce==='boolean'?metadata.announce:
              typeof metadata?.__x_announce==='boolean'?metadata.__x_announce:
              typeof pre?.announce==='boolean'?pre.announce:null,
            isParentGroup:metadata?.isParentGroup===true||metadata?.__x_isParentGroup===true,
            preIsParentGroup:pre?.isParentGroup===true,
            messages,
          };
        }catch(error){
          return {ok:false,gid:joinedGroupId,name:String(error?.name||''),message:String(error?.message||error||'')};
        }
      })()`,
      returnByValue:true,
      awaitPromise:true,
    });
    const value=response?.result?.value||{};
    if(value.ok!==true){
      const message=String(value.message||value.reason||'');
      if(value.reason==='approval_required')return {kind:'blocked',reason:'approval_required'};
      if(/invalid|expired|not-found|gone/iu.test(message))return {kind:'blocked',reason:'invalid_whatsapp_link'};
      if(/retry|rate|too many|temporar|timeout/iu.test(message))return {kind:'blocked',reason:'whatsapp_join_retry_later',groupId:String(value.gid||'')};
      return {kind:'blocked',reason:String(value.reason||'direct_join_failed'),groupId:String(value.gid||''),diagnostic:{name:value.name||'',message}};
    }
    const messages=Array.isArray(value.messages)?value.messages:[];
    const userMessages=messages.filter(item=>{
      const body=String(item?.body||'').trim();
      const type=String(item?.type||'').toLowerCase();
      return body&&!/^(?:gp2|e2e_notification|notification|protocol|ciphertext)$/u.test(type);
    });
    const latestTimestamp=Math.max(0,...userMessages.map(item=>Number(item?.timestamp)||0));
    const nowSeconds=Math.floor(Date.now()/1000);
    let activityState;
    if(isDiscoveryRecentTimestamp(latestTimestamp*1000,nowSeconds*1000))activityState='active';
    else if(latestTimestamp>0&&nowSeconds-latestTimestamp>=14*24*60*60)activityState='dead';
    const recentTexts=userMessages.map(item=>String(item?.body||'')).filter(Boolean).slice(-80);
    const evidence=[value.subject,value.desc,value.parentTitle,value.parentDesc,...recentTexts].join('\n');
    const spamMessages=recentTexts.filter(text=>spamPattern.test(text)).length;
    const ukrainianMessages=recentTexts.filter(text=>ukrainianConversationPattern.test(text)).length;
    const identityEvidence=[
      String(value.subject||''),String(value.desc||''),
      String(value.parentTitle||''),String(value.parentDesc||''),
    ].join('\n');
    const topicMatch=spamPattern.test(identityEvidence)||spamMessages>=3
      ?'mismatch'
      :ukrainianIdentityPattern.test(identityEvidence)||ukrainianMessages>=2?'match':'unknown';
    let adsPolicy;
    if(adsForbiddenPattern.test(String(value.desc||'')))adsPolicy='forbidden';
    else if(adsAllowedPattern.test(String(value.desc||'')))adsPolicy='allowed';
    else if(activityState==='active'&&recentTexts.filter(text=>adLikeMessagePattern.test(text)).length>=2)adsPolicy='inferred_allowed';
    const memberCount=Number.isFinite(Number(value.size))&&Number(value.size)>0?Number(value.size):undefined;
    const canWrite=value.announce===true?false:value.announce===false?true:undefined;
    return {
      kind:'result',
      result:{
        status:'inspected',
        targetVerified:true,
        accessible:true,
        membershipState:'joined',
        observedName:String(value.subject||task.name),
        chatType:value.isParentGroup===true?'community':'group',
        ...(memberCount===undefined?{}:{memberCount}),
        topicMatch,
        ...(canWrite===undefined?{}:{canWrite}),
        ...(adsPolicy?{adsPolicy}:{}),
        ...(activityState?{activityState}:{}),
        description:String(value.desc||''),
        parentCommunityTitle:String(value.parentTitle||''),
        parentCommunityDescription:String(value.parentDesc||''),
        groupId:String(value.gid||''),
        joinedDirect:true,
        recentMessageCount:recentTexts.length,
        sourceWasCommunity:value.preIsParentGroup===true||Boolean(value.parentId),
      },
    };
  }finally{client.close();}
}

export async function leaveWhatsappGroupViaRuntime(
  groupId,
  { cdpBaseUrl } = {},
) {
  const id=String(groupId||'').trim();
  if(!id)return {kind:'blocked',reason:'group_id_missing'};
  const base=normalizeLocalCdpBaseUrl(cdpBaseUrl);
  if(!base)return {kind:'blocked',reason:cdpBaseUrl?'cdp_not_local':'cdp_not_configured'};
  const page=await findOrCreateWhatsappPage(base);
  if(!isLocalCdpWebSocketUrl(page.webSocketDebuggerUrl))return {kind:'blocked',reason:'cdp_websocket_not_local'};
  const client=await createCdpClient(page.webSocketDebuggerUrl);
  try{
    await client.send('Runtime.enable');
    const response=await client.send('Runtime.evaluate',{
      expression:`(async()=>{try{
        const wid=window.require('WAWebWidFactory').createWid(${JSON.stringify(id)});
        const chats=window.require('WAWebCollections').Chat;
        const chat=chats.get(wid)||(chats.find?await chats.find(wid):null);
        if(!chat)return {ok:false,reason:'chat_not_found'};
        const result=await window.require('WAWebExitGroupAction').sendExitGroup(chat);
        return {ok:result!==false};
      }catch(error){return {ok:false,name:String(error?.name||''),message:String(error?.message||error||'')}}})()`,
      returnByValue:true,
      awaitPromise:true,
    });
    const value=response?.result?.value||{};
    if(value.ok===true)return {kind:'result',result:{left:true,groupId:id}};
    return {kind:'blocked',reason:String(value.reason||'direct_leave_failed'),diagnostic:{name:value.name||'',message:value.message||''}};
  }finally{client.close();}
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
        const stored=localStorage.getItem('work-os:executor-token:v1')?.trim()||'';
        if(stored.startsWith('wos_exec_')&&stored.length>=32&&stored.length<=200)return stored;
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
const WORK_OS_LOCAL_SOURCE_FEEDBACK_KEY='work-os:chat-discovery-source-feedback:v1';

export async function startWorkOsLocalDiscoveryRunViaCdp(
  workOsUrl,
  { cdpBaseUrl, goal=50 } = {},
) {
  const pagesResult=await listWorkOsPagesForCdp(workOsUrl,cdpBaseUrl);
  if(pagesResult.kind==='blocked')return pagesResult;
  const safeGoal=Math.max(1,Math.min(100,Number(goal)||50));
  for(const page of pagesResult.pages){
    const client=await createCdpClient(page.webSocketDebuggerUrl);
    try{
      const response=await client.send('Runtime.evaluate',{
        expression:`(()=>{
          const seedRaw=sessionStorage.getItem('work-os:chat-discovery-source-seeds:v1');
          if(!seedRaw)return {started:false,reason:'source_plan_missing'};
          try{
            const seed=JSON.parse(seedRaw);
            if(!Array.isArray(seed?.keywords)||!seed.keywords.length||!Array.isArray(seed?.cities)||!seed.cities.length){
              return {started:false,reason:'source_plan_invalid'};
            }
          }catch{return {started:false,reason:'source_plan_invalid'};}
          const runId=crypto.randomUUID();
          sessionStorage.removeItem('work-os:chat-discovery-local-preflight-results:v1');
          const state={
            runId,sourceTotal:0,sourceErrors:0,sourceFailures:0,sourceIssues:[],
            telegramCursor:15,sourceCursor:15,searched:0,processed:0,duplicates:0,rejected:0,emptySourceBatches:0,
            done:false,running:true,sourceExhausted:false,goal:${JSON.stringify(safeGoal)},
            lastActivityAt:Date.now(),completionReason:null,candidates:[],
          };
          sessionStorage.setItem('work-os:chat-discovery-local-preview:v3',JSON.stringify(state));
          window.dispatchEvent(new CustomEvent('work-os:chat-discovery-local-update'));
          return {started:true,runId,goal:state.goal};
        })()`,
        returnByValue:true,
      });
      const value=response?.result?.value||{};
      if(value.started===true)return {kind:'result',...value};
      if(value.reason)return {kind:'blocked',reason:String(value.reason)};
    }finally{client.close();}
  }
  return {kind:'blocked',reason:'work_os_page_not_found'};
}

export async function readWorkOsLocalDiscoveryTaskViaCdp(
  workOsUrl,
  { cdpBaseUrl, skipCandidateIds=[] } = {},
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
          const recoverableLegacySearchStop=state?.running!==true
            &&state?.done!==true
            &&state?.sourceExhausted!==true
            &&state?.completionReason==='source_error'
            &&Array.isArray(state?.sourceIssues)
            &&state.sourceIssues.length>0
            &&state.sourceIssues.every((item)=>/(?:search\.brave\.com|search_rate_limited|source_http_429|curl.*(?:22|429))/iu.test(String(item?.reason||'')));
          if(recoverableLegacySearchStop){
            state={...state,running:true,completionReason:null,sourceFailures:0,lastActivityAt:Date.now()};
            sessionStorage.setItem(${JSON.stringify(WORK_OS_LOCAL_PREVIEW_KEY)},JSON.stringify(state));
            window.dispatchEvent(new CustomEvent('work-os:chat-discovery-local-update'));
          }
          const resultRaw=sessionStorage.getItem(${JSON.stringify(WORK_OS_LOCAL_PREFLIGHT_RESULTS_KEY)});
          let results={};try{results=resultRaw?JSON.parse(resultRaw):{};}catch{}
          const candidates=Array.isArray(state?.candidates)?state.candidates:[];
          let stateChanged=false;
          const hardNoise=(item)=>{
            const label=String(item?.name||'').trim().toLocaleLowerCase('uk-UA');
            const hasDigit=[...label].some((char)=>char>='0'&&char<='9');
            return ['tiktok','facebook','instagram'].includes(label)
              ||label.includes('eventbrite')
              ||label.includes('майстер-клас')
              ||label.includes('майстер клас')
              ||(label.includes('реєстрац')&&hasDigit);
          };
          let resultsChanged=false;
          for(const item of candidates){
            if(item?.preflightState==='queued'&&hardNoise(item)){
              item.preflightState='rejected';
              item.preflightReasonCodes=['source_event_specific'];
              item.reasonCodes=['source_event_specific'];
              item.decision='rejected';
              item.leftAfterCheck=false;
              stateChanged=true;
            }
            const legacyReasons=Array.isArray(item?.preflightReasonCodes)?item.preflightReasonCodes:[];
            const legacyTargetNotVerified=item?.preflightState==='unavailable'
              &&legacyReasons.length===1
              &&legacyReasons[0]==='target_not_verified'
              &&!Number.isFinite(item?.memberCount)
              &&item?.revalidationVersion!=='target-verification-v2';
            if(legacyTargetNotVerified){
              item.preflightState='queued';
              item.preflightReasonCodes=[];
              item.reasonCodes=[];
              item.decision='review';
              item.revalidationVersion='target-verification-v2';
              item.leftAfterCheck=false;
              if(item.id&&results[item.id]){delete results[item.id];resultsChanged=true;}
              stateChanged=true;
            }
          }
          if(resultsChanged){
            sessionStorage.setItem("work-os:chat-discovery-local-preflight-results:v1",JSON.stringify(results));
          }
          if(stateChanged){
            state.candidates=candidates;
            sessionStorage.setItem('work-os:chat-discovery-local-preview:v3',JSON.stringify(state));
            window.dispatchEvent(new CustomEvent('work-os:chat-discovery-local-update'));
          }
          const skipped=new Set(${JSON.stringify(Array.isArray(skipCandidateIds)?skipCandidateIds.map(String).slice(0,250):[])});
          const priority=(item)=>{
            const name=String(item?.name||'');
            const source=Array.isArray(item?.sources)?item.sources[0]:null;
            const sourceTitle=String(source?.sourceTitle||'');
            const evidence=name+' '+sourceTitle;
            let score=0;
            if(/(?:україн|украин|ukrain|🇺🇦)/iu.test(sourceTitle))score+=12;
            if(/(?:україн|украин|ukrain|🇺🇦)/iu.test(name))score+=8;
            if(/(?:впо|біжен|refuge|допомог|help|diaspora|community|громад)/iu.test(evidence))score+=4;
            if(/(?:оголош|объявлен|куп(?:и|лю|ів)|прод(?:ай|ам|аж)|перевез|transport|батьк|родител|family|famil|чат\b|chat\b)/iu.test(evidence))score+=8;
            if(/(?:bremen|berlin|rotterdam|london|toronto|slovak|нідерланд|німеч|австр|куопіо|карінт|швельм)/iu.test(evidence))score+=2;
            if(/(?:дитяч(?:ий|ого) табір|медичн(?:і|ые) питання|книжков(?:ий|ый) клуб|паспорт|document|документ|it\s*&\s*business|майстер-клас|майстер клас|кафе\b|café\b)/iu.test(evidence))score-=8;
            if(/^(?:tiktok|facebook|instagram|whatsapp|telegram)$/iu.test(name.trim()))score-=14;
            if(/(?:eventbrite|реєстрац|майстер-клас|майстер клас|\\bviews?\\b|ref=share|\\/groups\\/|<span|https?:\\/\\/|href=|style=)/iu.test(name))score-=10;
            if(name.length>140)score-=6;
            if(source?.kind==='telegram_global')score+=2;
            else if(source?.kind==='curated')score+=1;
            return score;
          };
          const candidate=candidates
            .filter((item)=>item&&item.localOnly===true&&item.preflightState==='queued'&&typeof item.id==='string'
              &&typeof item.link==='string'&&!results[item.id]&&!skipped.has(item.id))
            .sort((a,b)=>priority(b)-priority(a))[0]||null;
          return {
            active:state?.running===true,
            runId:String(state?.runId||''),
            goal:Number(state?.goal)||0,
            sourceCursor:Number(state?.telegramCursor)||0,
            sourceExhausted:state?.sourceExhausted===true,
            queuedCount:candidates.filter(item=>item?.preflightState==='queued'&&!results[item?.id]&&!skipped.has(item?.id)).length,
            task:candidate?{
              candidateId:candidate.id,
              runId:String(state?.runId||''),
              membershipState:candidate.membershipState,
              groupId:candidate.groupId,
              checkpoint:candidate.discoveryCheckpoint||null,
              sources:Array.isArray(candidate.sources)?candidate.sources:[],
              runtime:'whatsapp_web',
              platform:'whatsapp',
              action:'join_and_inspect',
              name:String(candidate.name||'WhatsApp candidate'),
              link:String(candidate.link||''),
              topicMatch:candidate.topicMatch||'unknown',
              minMembers:700,
              expectedTarget:{
                name:'WhatsApp · '+String(candidate.link||'').split('/').filter(Boolean).at(-1)?.split('?')[0],
                link:String(candidate.link||''),
              },
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

export async function readWorkOsLocalDiscoverySeedDataViaCdp(
  workOsUrl,
  { cdpBaseUrl } = {},
) {
  const pagesResult=await listWorkOsPagesForCdp(workOsUrl,cdpBaseUrl);
  if(pagesResult.kind==='blocked')return pagesResult;
  let fallback={kind:'blocked',reason:'source_plan_not_found'};
  for(const page of pagesResult.pages){
    const client=await createCdpClient(page.webSocketDebuggerUrl);
    try{
      const response=await client.send('Runtime.evaluate',{
        expression:`(()=>{
          try{
            const raw=sessionStorage.getItem('work-os:chat-discovery-source-seeds:v1');
            if(!raw)return {ok:false,reason:'source_plan_missing'};
            const seedData=JSON.parse(raw);
            if(!seedData||!Array.isArray(seedData.keywords)||!seedData.keywords.length||!Array.isArray(seedData.cities)||!seedData.cities.length){
              return {ok:false,reason:'source_plan_invalid'};
            }
            return {ok:true,version:Number(seedData.version)||0,seedData};
          }catch{
            return {ok:false,reason:'source_plan_invalid'};
          }
        })()`,
        returnByValue:true,
      });
      const value=response?.result?.value||{};
      if(value.ok===true)return {kind:'result',version:Number(value.version)||0,seedData:value.seedData};
      fallback={kind:'blocked',reason:String(value.reason||'source_plan_invalid')};
    }finally{client.close();}
  }
  return fallback;
}

export async function readWorkOsLocalDiscoverySourceFeedbackViaCdp(
  workOsUrl,
  { cdpBaseUrl } = {},
) {
  const pagesResult=await listWorkOsPagesForCdp(workOsUrl,cdpBaseUrl);
  if(pagesResult.kind==='blocked')return pagesResult;
  for(const page of pagesResult.pages){
    const client=await createCdpClient(page.webSocketDebuggerUrl);
    try{
      const response=await client.send('Runtime.evaluate',{
        expression:`(()=>{try{
          const raw=localStorage.getItem(${JSON.stringify(WORK_OS_LOCAL_SOURCE_FEEDBACK_KEY)})||'{}';
          const value=JSON.parse(raw);
          const entries=Object.entries(value&&typeof value==='object'?value:{})
            .sort((a,b)=>Number(a[1]?.lastCrawledAt||a[1]?.lastOutcomeAt||0)-Number(b[1]?.lastCrawledAt||b[1]?.lastOutcomeAt||0))
            .slice(-500);
          return {ok:true,feedback:Object.fromEntries(entries)};
        }catch{return {ok:false};}})()`,
        returnByValue:true,
      });
      const value=response?.result?.value||{};
      if(value.ok===true)return {kind:'result',feedback:value.feedback||{}};
    }finally{client.close();}
  }
  return {kind:'result',feedback:{}};
}

export async function updateWorkOsLocalDiscoverySourceFeedbackViaCdp(
  workOsUrl,
  events,
  { cdpBaseUrl } = {},
) {
  const pagesResult=await listWorkOsPagesForCdp(workOsUrl,cdpBaseUrl);
  if(pagesResult.kind==='blocked')return pagesResult;
  const safeEvents=(Array.isArray(events)?events:[]).slice(0,80).map(event=>({
    sourceUrl:String(event?.sourceUrl||'').slice(0,1000),
    added:Math.max(0,Number(event?.added)||0),
    duplicates:Math.max(0,Number(event?.duplicates)||0),
    decision:String(event?.decision||''),
    reasonCodes:Array.isArray(event?.reasonCodes)?event.reasonCodes.slice(0,12).map(String):[],
    memberCount:Number.isFinite(Number(event?.memberCount))?Number(event.memberCount):null,
    canWrite:typeof event?.canWrite==='boolean'?event.canWrite:null,
  })).filter(event=>event.sourceUrl);
  if(!safeEvents.length)return {kind:'result',updated:0};
  for(const page of pagesResult.pages){
    const client=await createCdpClient(page.webSocketDebuggerUrl);
    try{
      const response=await client.send('Runtime.evaluate',{
        expression:`(()=>{
          const key=${JSON.stringify(WORK_OS_LOCAL_SOURCE_FEEDBACK_KEY)};
          const events=${JSON.stringify(safeEvents)};
          let feedback={};try{feedback=JSON.parse(localStorage.getItem(key)||'{}')||{};}catch{}
          const normalize=(value)=>{try{
            const url=new URL(value);const parts=url.pathname.split('/').filter(Boolean);
            const channel=(parts[0]==='s'?parts[1]:parts[0])||'';
            return channel?'https://t.me/s/'+channel:'';
          }catch{return '';}};
          const now=Date.now();
          for(const event of events){
            const source=normalize(event.sourceUrl);if(!source)continue;
            const current=feedback[source]||{};
            let delta=0,saturatedUntil=Number(current.saturatedUntil)||0;
            if(event.decision){
              const reasons=event.reasonCodes||[];
              const viable=Number.isFinite(event.memberCount)&&event.memberCount>=700&&event.memberCount<=18000&&event.canWrite!==false;
              delta=event.decision==='target'?80
                :reasons.includes('too_few_members')||reasons.includes('cannot_write')?-20
                :reasons.includes('invalid_whatsapp_link')?-12
                :viable?24
                :event.decision==='rejected'?-8:0;
              if(delta>0)saturatedUntil=0;
            }else{
              delta=event.added>0?Math.min(24,8+event.added*4):event.duplicates>0?-10:-2;
              if(event.added>0)saturatedUntil=0;
              else if(event.duplicates>0)saturatedUntil=Math.max(saturatedUntil,now+6*60*60*1000);
            }
            feedback[source]={
              ...current,
              score:Math.max(-120,Math.min(240,(Number(current.score)||0)+delta)),
              lastCrawledAt:event.decision?(Number(current.lastCrawledAt)||0):now,
              lastOutcomeAt:event.decision?now:(Number(current.lastOutcomeAt)||0),
              added:(Number(current.added)||0)+(event.added||0),
              duplicates:(Number(current.duplicates)||0)+(event.duplicates||0),
              targets:(Number(current.targets)||0)+(event.decision==='target'?1:0),
              saturatedUntil,
            };
          }
          const compact=Object.fromEntries(Object.entries(feedback)
            .sort((a,b)=>Number(a[1]?.lastCrawledAt||a[1]?.lastOutcomeAt||0)-Number(b[1]?.lastCrawledAt||b[1]?.lastOutcomeAt||0))
            .slice(-500));
          localStorage.setItem(key,JSON.stringify(compact));
          return {ok:true,updated:events.length};
        })()`,
        returnByValue:true,
      });
      const value=response?.result?.value||{};
      if(value.ok===true)return {kind:'result',updated:Number(value.updated)||0};
    }finally{client.close();}
  }
  return {kind:'blocked',reason:'work_os_source_feedback_target_not_found'};
}

export async function applyWorkOsLocalDiscoverySourceBatchViaCdp(
  workOsUrl,
  batch,
  { cdpBaseUrl, expectedRunId='' } = {},
) {
  const pagesResult=await listWorkOsPagesForCdp(workOsUrl,cdpBaseUrl);
  if(pagesResult.kind==='blocked')return pagesResult;
  const safeBatch={
    nextCursor:Math.max(0,Number(batch?.nextCursor)||0),
    searched:Math.max(0,Number(batch?.searched)||0),
    done:batch?.done===true,
    totalTasks:Math.max(0,Number(batch?.totalTasks)||0),
    errors:Array.isArray(batch?.errors)?batch.errors.slice(0,8).map(item=>({reason:String(item.reason||'source_failed').slice(0,300),query:String(item.query||'').slice(0,500)})):[],
    sources:Array.isArray(batch?.sources)?batch.sources.map(item=>({
      sourceUrl:String(item?.sourceUrl||'').slice(0,1000),
      sourceTitle:String(item?.sourceTitle||'').slice(0,180),
      query:String(item?.query||'').slice(0,500),
      seedLabel:String(item?.seedLabel||'').slice(0,180),
      context:String(item?.context||'').slice(0,700),
      text:String(item?.text||'').slice(0,45000),
    })):[],
  };
  for(const page of pagesResult.pages){
    const client=await createCdpClient(page.webSocketDebuggerUrl);
    try{
      const response=await client.send('Runtime.evaluate',{
        expression:`(async()=>{
          const stateKey=${JSON.stringify(WORK_OS_LOCAL_PREVIEW_KEY)};
          const raw=sessionStorage.getItem(stateKey);
          if(!raw)return {applied:false,reason:'state_missing'};
          let state;try{state=JSON.parse(raw);}catch{return {applied:false,reason:'state_invalid'};}
          if(state?.running!==true)return {applied:false,reason:'not_running'};
          const expectedRunId=${JSON.stringify(String(expectedRunId||''))};
          if(expectedRunId&&String(state?.runId||'')!==expectedRunId)return {applied:false,reason:'run_changed'};
          const batch=${JSON.stringify(safeBatch)};
          const byKey=new Map((Array.isArray(state.candidates)?state.candidates:[]).map(item=>[String(item.platform)+'|'+String(item.link),item]));
          let added=0,duplicates=0,rejected=0,errors=batch.errors.length;
          const sourceStats=[];
          const issues=[...batch.errors];
          for(const source of batch.sources){
            if(!source.text||!source.sourceUrl)continue;
            try{
              const knownLinks=[...byKey.values()].map(item=>item.link).filter(Boolean);
              const res=await fetch('/api/chat-discovery/preview',{
                method:'POST',
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify({
                  action:'telegram',text:source.text,sourceUrl:source.sourceUrl,sourceTitle:source.sourceTitle,
                  query:source.query,seedLabel:source.seedLabel,context:source.context,knownLinks,minMembers:700,
                }),
              });
              const payload=await res.json().catch(()=>null);
              if(!res.ok||!payload){errors+=1;issues.push({reason:'preview_http_'+res.status,query:source.query});continue;}
              const sourceAdded=Number(payload.batch?.added)||0;
              const sourceDuplicates=Number(payload.batch?.duplicates)||0;
              added+=sourceAdded;
              duplicates+=sourceDuplicates;
              sourceStats.push({sourceUrl:source.sourceUrl,added:sourceAdded,duplicates:sourceDuplicates});
              for(const candidate of Array.isArray(payload.previews)?payload.previews:[]){
                const key=String(candidate.platform)+'|'+String(candidate.link);
                const label=String(candidate.name||'').trim().toLocaleLowerCase('uk-UA');
                const hasDigit=[...label].some((char)=>char>='0'&&char<='9');
                const hardNoise=['tiktok','facebook','instagram'].includes(label)
                  ||label.includes('eventbrite')
                  ||label.includes('майстер-клас')
                  ||label.includes('майстер клас')
                  ||(label.includes('реєстрац')&&hasDigit);
                if(!hardNoise){
                  byKey.set(key,{...candidate,preflightState:'queued',preflightReasonCodes:[],leftAfterCheck:false});
                }else{
                  rejected+=1;
                  byKey.set(key,{...candidate,decision:'rejected',reasonCodes:['source_event_specific'],preflightState:'rejected',preflightReasonCodes:['source_event_specific'],leftAfterCheck:false});
                }
              }
            }catch{errors+=1;issues.push({reason:'preview_network_error',query:source.query});}
          }
          const latest=JSON.parse(sessionStorage.getItem(stateKey)||'null');
          if(!latest||!latest.running||latest.runId!==state.runId)return {applied:false,reason:'run_changed'};
          for(const item of Array.isArray(latest.candidates)?latest.candidates:[]){
            const key=String(item.platform)+'|'+String(item.link);
            if(!byKey.has(key)||item.preflightState!=='queued')byKey.set(key,item);
          }
          state={
            ...latest,
            telegramCursor:errors?latest.telegramCursor:batch.nextCursor,
            sourceTotal:batch.totalTasks||state.sourceTotal||0,
            sourceErrors:(Number(state.sourceErrors)||0)+errors,
            sourceFailures:errors?(Number(state.sourceFailures)||0)+1:0,
            sourceIssues:errors?issues.slice(0,8):[],
            running:errors&&Number(state.sourceFailures||0)>=2?false:state.running,
            completionReason:errors&&Number(state.sourceFailures||0)>=2?'source_error':state.completionReason,
            searched:(Number(state.searched)||0)+batch.searched,
            processed:(Number(state.processed)||0)+added+duplicates,
            duplicates:(Number(state.duplicates)||0)+duplicates,
            rejected:(Number(state.rejected)||0)+rejected,
            candidates:[...byKey.values()],
            sourceExhausted:state.sourceExhausted===true||(errors===0&&batch.done),
            lastActivityAt:Date.now(),
          };
          sessionStorage.setItem(stateKey,JSON.stringify(state));
          window.dispatchEvent(new CustomEvent('work-os:chat-discovery-local-update'));
          return {applied:true,added,duplicates,rejected,errors,candidateCount:state.candidates.length,sourceStats};
        })()`,
        returnByValue:true,
        awaitPromise:true,
      });
      const value=response?.result?.value;
      if(value?.applied===true)return {kind:'result',...value};
    }finally{client.close();}
  }
  return {kind:'blocked',reason:'work_os_source_state_not_found'};
}

export async function markWorkOsLocalDiscoveryCandidateViaCdp(
  workOsUrl,
  task,
  { cdpBaseUrl } = {},
) {
  const pagesResult=await listWorkOsPagesForCdp(workOsUrl,cdpBaseUrl);
  if(pagesResult.kind==='blocked')return pagesResult;
  for(const page of pagesResult.pages){
    const client=await createCdpClient(page.webSocketDebuggerUrl);
    try{
      const active=task?{
        id:String(task.candidateId||''),
        name:String(task.name||task.expectedTarget?.name||'WhatsApp chat'),
        link:String(task.link||task.expectedTarget?.link||''),
        startedAt:Date.now(),
        runId:task.runId,
        checkpoint:task.checkpoint||null,
      }:null;
      const response=await client.send('Runtime.evaluate',{
        expression:`(()=>{
          const key=${JSON.stringify(WORK_OS_LOCAL_PREVIEW_KEY)};
          const raw=sessionStorage.getItem(key);
          if(!raw)return {ok:false,reason:'state_missing'};
          let state;try{state=JSON.parse(raw);}catch{return {ok:false,reason:'state_invalid'};}
          const active=${JSON.stringify(active)};
          if(active){
            if(active.runId&&String(state.runId||'')!==active.runId)return {ok:false,reason:'run_replaced'};
            if(!Array.isArray(state.candidates)||!state.candidates.some(item=>item?.id===active.id)){
              return {ok:false,reason:'candidate_missing'};
            }
            if(active.checkpoint){
              const candidate=state.candidates.find(item=>item?.id===active.id);
              candidate.discoveryCheckpoint=active.checkpoint;
              if(active.checkpoint.result?.membershipState==='joined'){
                candidate.membershipState='joined';
                candidate.groupId=active.checkpoint.result.groupId||candidate.groupId;
              }
            }
            state.activeCandidateId=active.id;
            state.activeCandidateName=active.name;
            state.activeCandidateLink=active.link;
            state.activeCandidateStartedAt=active.startedAt;
          }else{
            state.activeCandidateId=null;
            state.activeCandidateName=null;
            state.activeCandidateLink=null;
            state.activeCandidateStartedAt=null;
          }
          sessionStorage.setItem(key,JSON.stringify(state));
          window.dispatchEvent(new CustomEvent('work-os:chat-discovery-local-update'));
          return {ok:true};
        })()`,
        returnByValue:true,
      });
      const value=response?.result?.value||{};
      if(value.ok===true)return {kind:'result'};
      return {kind:'blocked',reason:String(value.reason||'active_candidate_update_failed')};
    }finally{client.close();}
  }
  return {kind:'blocked',reason:'work_os_active_candidate_target_not_found'};
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
        expression:`(async()=>{
          const raw=sessionStorage.getItem(${JSON.stringify(WORK_OS_LOCAL_PREVIEW_KEY)});
          if(!raw)return {ok:false,reason:'state_missing'};
          let state;try{state=JSON.parse(raw);}catch{return {ok:false,reason:'state_invalid'};}
          const candidates=Array.isArray(state?.candidates)?state.candidates:[];
          const candidate=candidates.find((item)=>item&&item.id===${JSON.stringify(String(candidateId||''))});
          if(!candidate)return {ok:false,reason:'candidate_missing'};
          const expectedRunId=${JSON.stringify(String(payload?.runId||''))};
          if(expectedRunId&&String(state.runId||'')!==expectedRunId)return {ok:false,reason:'run_replaced'};
          let persisted;
          try{
            const res=await fetch('/api/chat-discovery/preview',{
              method:'POST',
              headers:{'Content-Type':'application/json'},
              body:JSON.stringify({
                action:'persist-outcome',
                platform:candidate.platform,
                link:candidate.link,
                name:candidate.name,
                sources:Array.isArray(candidate.sources)?candidate.sources:[],
                minMembers:700,
                outcome:${JSON.stringify(payload)},
              }),
            });
            persisted=await res.json().catch(()=>null);
            if(!res.ok||!persisted?.persisted){
              return {ok:false,reason:String(persisted?.error||('persist_http_'+res.status))};
            }
          }catch{
            return {ok:false,reason:'persist_network_error'};
          }
          let latest;try{latest=JSON.parse(sessionStorage.getItem(${JSON.stringify(WORK_OS_LOCAL_PREVIEW_KEY)})||'null');}catch{}
          if(!latest||String(latest.runId||'')!==String(state.runId||''))return {ok:true,persisted,detached:true};
          state=latest;
          const key=${JSON.stringify(WORK_OS_LOCAL_PREFLIGHT_RESULTS_KEY)};
          let results={};try{results=JSON.parse(sessionStorage.getItem(key)||'{}');}catch{}
          results[${JSON.stringify(String(candidateId||''))}]=${JSON.stringify(payload)};
          const entries=Object.entries(results).slice(-300);
          sessionStorage.setItem(key,JSON.stringify(Object.fromEntries(entries)));
          state.activeCandidateId=null;
          state.activeCandidateName=null;
          state.activeCandidateLink=null;
          state.activeCandidateStartedAt=null;
          const payload=${JSON.stringify(payload)};
          state.discoveryMetrics=state.discoveryMetrics||{completed:0,targets:0,totalCheckMs:0,reasons:{}};
          state.discoveryMetrics.completed+=1;
          state.discoveryMetrics.targets+=payload.decision==='target'?1:0;
          state.discoveryMetrics.totalCheckMs+=Number(payload.durationMs)||0;
          for(const reason of payload.reasonCodes||[])state.discoveryMetrics.reasons[reason]=(state.discoveryMetrics.reasons[reason]||0)+1;
          state.lastCheckedName=String(candidate.name||'WhatsApp chat');
          state.lastCheckedDecision=${JSON.stringify(String(payload?.decision||''))};
          state.lastCheckedAt=${JSON.stringify(Number(payload?.completedAt)||0)}||Date.now();
          state.lastCheckedReasonCodes=${JSON.stringify(Array.isArray(payload?.reasonCodes)?payload.reasonCodes:[])};
          sessionStorage.setItem(${JSON.stringify(WORK_OS_LOCAL_PREVIEW_KEY)},JSON.stringify(state));
          window.dispatchEvent(new CustomEvent('work-os:chat-discovery-local-update'));
          return {ok:true,persisted};
        })()`,
        returnByValue:true,
        awaitPromise:true,
      });
      const value=response?.result?.value||{};
      if(value.ok===true)return {kind:'result',persisted:value.persisted};
      return {kind:'blocked',reason:String(value.reason||'persist_outcome_failed')};
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
  if (snapshot.joinConfirmedAfterExactInvite === true || joinedViaInvitePattern.test(postInviteText) || leftPattern.test(postInviteText)) {
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

  if (headerMatches && expectedInviteContext && leftPattern.test(bodyText)) {
    return {
      kind:'result',
      result:{
        status:'failed',
        targetVerified:true,
        accessible:true,
        membershipState:'left',
        observedName,
        chatType:'group',
        reason:'membership_left',
      },
    };
  }

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
  { cdpBaseUrl, timeoutMs = DEFAULT_TIMEOUT_MS, reuseCurrentVerified = false } = {},
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

    const operationDeadline = Date.now() + timeoutMs;
    const remainingBudget = () => Math.max(POLL_MS, operationDeadline - Date.now());
    const navigatedInviteCode = whatsappInviteCode(task.expectedTarget?.link || task.link);
    let opened;
    if (reuseCurrentVerified) {
      const snapshot = await readSnapshot(client);
      const expectedName = task.expectedTarget?.name || task.name;
      const expected = normalizeTargetLabel(expectedName);
      const exact = [...(snapshot.headerNames || []), ...(snapshot.headerTitles || [])]
        .map((value) => String(value || '').trim())
        .find((value) => normalizeTargetLabel(value) === expected);
      if (!exact || snapshot.composer !== true) return { kind:'blocked', reason:'current_joined_target_not_verified' };
      opened = { kind:'result', result:{ membershipState:'joined', targetVerified:true, observedName:exact } };
    } else {
      await client.send('Page.navigate', { url: targetUrl });
      opened = await waitForClassification(client, { ...task, action: 'inspect' }, remainingBudget(), null, navigatedInviteCode);
    }
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

export async function readWhatsappHomeHealthViaCdp({cdpBaseUrl}={}) {
  if(!cdpBaseUrl)return {kind:'blocked',reason:'cdp_not_configured'};
  const base=normalizeLocalCdpBaseUrl(cdpBaseUrl);
  if(!base)return {kind:'blocked',reason:'cdp_not_local'};
  const page=await findOrCreateWhatsappPage(base);
  if(!isLocalCdpWebSocketUrl(page.webSocketDebuggerUrl))return {kind:'blocked',reason:'cdp_websocket_not_local'};
  const client=await createCdpClient(page.webSocketDebuggerUrl);
  try{
    await client.send('Runtime.enable');
    const snapshot=await readSnapshot(client);
    const bodyText=String(snapshot?.bodyText||'');
    const homeUrl=String(snapshot?.url||'');
    const home=homeUrl==='https://web.whatsapp.com/'||homeUrl==='https://web.whatsapp.com';
    const loading=messagesLoadingPattern.test(bodyText);
    const authenticated=snapshot?.hasQr!==true&&!authPattern.test(bodyText);
    return {kind:'result',home,loading,authenticated,ready:home&&authenticated&&!loading};
  }finally{client.close();}
}

export async function resetWhatsappPageViaCdp({cdpBaseUrl}={}) {
  if(!cdpBaseUrl)return {kind:'blocked',reason:'cdp_not_configured'};
  const base=normalizeLocalCdpBaseUrl(cdpBaseUrl);
  if(!base)return {kind:'blocked',reason:'cdp_not_local'};
  const page=await findOrCreateWhatsappPage(base);
  if(!isLocalCdpWebSocketUrl(page.webSocketDebuggerUrl))return {kind:'blocked',reason:'cdp_websocket_not_local'};
  const client=await createCdpClient(page.webSocketDebuggerUrl);
  try{
    await client.send('Page.enable');
    await client.send('Page.navigate',{url:'https://web.whatsapp.com/'});
    return {kind:'result'};
  }finally{client.close();}
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
    let alreadyOnExactInvite=false;
    try{
      const currentUrl=new URL(String(page.url||''));
      const targetParsed=new URL(targetUrl);
      alreadyOnExactInvite=currentUrl.origin===targetParsed.origin
        &&currentUrl.pathname===targetParsed.pathname
        &&currentUrl.searchParams.get('code')===targetParsed.searchParams.get('code');
    }catch{}
    if(!alreadyOnExactInvite)await client.send('Page.navigate',{url:targetUrl});

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
  const whatsappPages = Array.isArray(pages)
    ? pages.filter((page) => page?.type === 'page' && /^https:\/\/web\.whatsapp\.com\//u.test(page.url || '') && page.webSocketDebuggerUrl)
    : [];
  if(whatsappPages.length){
    const existing=whatsappPages.find((page)=>page.url==='https://web.whatsapp.com/')||whatsappPages[0];
    const extras=whatsappPages.filter((page)=>page.id&&page.id!==existing.id);
    if(extras.length){
      await Promise.allSettled(extras.map((page)=>fetch(
        `${base}/json/close/${encodeURIComponent(page.id)}`,
        {signal:AbortSignal.timeout(4_000)},
      )));
    }
    return existing;
  }

  const created = await fetch(
    `${base}/json/new?${encodeURIComponent('https://web.whatsapp.com/')}`,
    { method: 'PUT', signal: AbortSignal.timeout(4_000) },
  );
  if (!created.ok) throw new Error(`CDP new page HTTP ${created.status}`);
  const page = await created.json();
  if (!page?.webSocketDebuggerUrl) throw new Error('CDP did not return a page websocket.');
  return page;
}

export function shouldDeferForGlobalWhatsAppLoading(snapshot) {
  const bodyText=String(snapshot?.bodyText||'');
  return messagesLoadingPattern.test(bodyText)
    && snapshot?.composer!==true
    && (!Array.isArray(snapshot?.headerNames)||snapshot.headerNames.length===0)
    && (!Array.isArray(snapshot?.targetHeadings)||snapshot.targetHeadings.length===0);
}

async function waitForClassification(client, task, timeoutMs, afterAction = null, navigatedInviteCode = null) {
  const deadline = Date.now() + timeoutMs;
  let last = { kind: 'blocked', reason: 'page_not_ready' };
  let diagnostic = null;
  let loadingSince = 0;
  while (Date.now() < deadline) {
    const snapshot = await readSnapshot(client);
    if(shouldDeferForGlobalWhatsAppLoading(snapshot)){
      if(!loadingSince)loadingSince=Date.now();
      if(Date.now()-loadingSince>=1_200){
        return {
          kind:'blocked',
          reason:'whatsapp_messages_loading',
          diagnostic:{url:String(snapshot.url||''),globalLoading:true},
        };
      }
    }else{
      loadingSince=0;
    }
    diagnostic = {
      url:String(snapshot.url||''),
      headerNames:(snapshot.headerNames||[]).slice(0,6),
      headerTitles:(snapshot.headerTitles||[]).slice(0,6),
      left:leftPattern.test(String(snapshot.bodyText||'')),
      joined:joinedViaInvitePattern.test(String(snapshot.bodyText||'')),
      composer:snapshot.composer===true,
    };
    if (navigatedInviteCode) snapshot.navigatedInviteCode = navigatedInviteCode;
    if (afterAction === 'join' && navigatedInviteCode && snapshot.composer === true && (snapshot.headerNames || []).length > 0) {
      snapshot.joinConfirmedAfterExactInvite = true;
    }
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
  if(last?.kind==='blocked'&&last.reason==='target_not_verified'&&diagnostic){
    return {...last,diagnostic};
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
    const profileButton = [...document.querySelectorAll('[role="button"][aria-label]')]
      .find((node) => /(?:деталі профілю|profile details|данные профиля|сведения о профиле)/iu.test(node.getAttribute('aria-label') || ''));
    const modernHeaderRegion = profileButton?.parentElement || document.querySelector('#main header');
    const modernRegionFirstLine = modernHeaderRegion
      ? String(modernHeaderRegion.innerText || modernHeaderRegion.textContent || '').trim().split(String.fromCharCode(10))[0] || ''
      : '';
    const modernHeaderNames = modernHeaderRegion ? unique([
      modernRegionFirstLine,
      ...[...modernHeaderRegion.querySelectorAll('[role="button"], [title], [dir="auto"], h1, h2')]
        .flatMap((node) => {
          const raw = String(node.innerText || node.textContent || '').trim();
          const firstLine = raw.split(String.fromCharCode(10))[0] || '';
          return [firstLine, node.getAttribute('title') || ''];
        })
        .filter((value) => value && !/^(?:пошук|меню|search|menu)$/iu.test(clean(value))),
    ]) : [];
    const headerNames = unique([
      ...read(document, [
        '#main header [data-testid="conversation-info-header-chat-title"]',
        '#main header [dir="auto"]',
        '[data-testid="conversation-info-header"] [dir="auto"]',
      ]),
      ...modernHeaderNames,
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
    const headerText = clean(main?.querySelector('header')?.innerText || '').slice(0,5000);
    const info = document.querySelector('[data-testid="drawer-right"], [data-testid="chat-info-drawer"], [role="complementary"]');
    const groupInfoText = clean(info?.innerText || '').slice(0,30000);
    const messageTexts = unique([...document.querySelectorAll('[data-testid="msg-container"], #main [data-pre-plain-text]')]
      .slice(-30).map((node) => clean(node.innerText || node.textContent || '').slice(0,1200)));
    const messageMeta = unique([...document.querySelectorAll('#main [data-pre-plain-text]')]
      .slice(-30).map((node) => node.getAttribute('data-pre-plain-text') || ''));
    const composerNode = document.querySelector(
      '#main footer [contenteditable="true"][role="textbox"], #main [contenteditable="true"][role="textbox"], footer [contenteditable="true"], [data-testid="conversation-compose-box-input"], [aria-label*="message" i][contenteditable="true"], [aria-label*="повідом" i][contenteditable="true"], [aria-label*="сообщ" i][contenteditable="true"]'
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
      headerText,
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
  const memberCount = parseMemberCount(String(snapshot.groupInfoText || ''))
    ?? parseMemberCount(String(snapshot.mainText || ''))
    ?? parseMemberCount(String(snapshot.headerText || ''));
  const activityState = inferMessageActivity(meta, Number(snapshot.nowMs) || Date.now(), snapshot.locale)
    || (recentActivityPattern.test(chatText) || recentActivityPattern.test(meta.join('\n')) ? 'active' : undefined);
  const identityText = [infoText, snapshot.headerText || '', ...(snapshot.headerNames || []), ...(snapshot.headerTitles || [])].join('\n');
  const recentMessages = messages.slice(-20);
  const spamMessages = recentMessages.filter((value) => spamPattern.test(value)).length;
  const ukrainianMessages = recentMessages.filter((value) => ukrainianConversationPattern.test(value)).length;
  const topicMatch = spamPattern.test(identityText) || spamMessages >= 3
    ? 'mismatch'
    : ukrainianIdentityPattern.test(identityText) || ukrainianMessages >= 2 ? 'match' : undefined;
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

export function isDiscoveryRecentTimestamp(timestampMs,nowMs=Date.now()){
  if(!Number.isFinite(timestampMs)||timestampMs<=0||timestampMs>nowMs+300000)return false;
  const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Kyiv',year:'numeric',month:'2-digit',day:'2-digit'});
  const day=value=>formatter.format(new Date(value));
  const parts=formatter.formatToParts(new Date(nowMs));
  const n=type=>Number(parts.find(p=>p.type===type)?.value);
  const yesterday=day(Date.UTC(n('year'),n('month')-1,n('day')-1,12));
  return day(timestampMs)===day(nowMs)||day(timestampMs)===yesterday;
}

function inferMessageActivity(meta, nowMs, locale) {
  const stamps = meta.map((value) => parseMessageTimestamp(value, nowMs, locale)).filter((value) => Number.isFinite(value));
  if (!stamps.length) return undefined;
  const latest = Math.max(...stamps);
  const ageMs = Math.max(0, nowMs - latest);
  if (isDiscoveryRecentTimestamp(latest,nowMs)) return 'active';
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

async function waitForJoinedChatReady(client, timeoutMs=8_000) {
  const deadline=Date.now()+timeoutMs;
  let latest=await readSnapshot(client);
  while(Date.now()<deadline){
    const body=String(latest.bodyText||'');
    const hasHeader=(latest.headerNames||[]).length>0||Boolean(String(latest.headerText||'').trim());
    if(!messagesLoadingPattern.test(body)&&latest.composer===true&&hasHeader)return latest;
    await sleep(POLL_MS);
    latest=await readSnapshot(client);
  }
  return latest;
}

async function enrichJoinedQualification(client, task, result) {
  const before=await waitForJoinedChatReady(client);
  const preflightFacts=task.preflightFacts&&typeof task.preflightFacts==='object'?task.preflightFacts:{};
  let combined={...preflightFacts,...deriveWhatsappQualification(before)};
  const minMembers=Math.max(700,Number(task.minMembers)||700);
  const maxMembers=18000;
  if(Number.isFinite(combined.memberCount)&&(combined.memberCount<minMembers||combined.memberCount>maxMembers)){
    return {...result,...combined};
  }
  // The invite metadata and the open chat already cover the normal path. Opening
  // group info is a fallback only when facts that the drawer can actually add
  // are still missing; activity is intentionally derived from real messages.
  const needsInfo=!Number.isFinite(combined.memberCount)||!combined.adsPolicy||!combined.topicMatch;
  if(!needsInfo)return {...result,...combined};
  const expectedName=result.observedName||task.expectedTarget?.name||task.name;
  if(expectedName&&await clickExactHeader(client,expectedName)){
    const expected=normalizeTargetLabel(expectedName);
    const deadline=Date.now()+3_000;
    let infoSnapshot=await readSnapshot(client);
    while(Date.now()<deadline){
      const infoText=normalizeTargetLabel(infoSnapshot.groupInfoText||'');
      if(infoText&&(!expected||infoText.includes(expected)))break;
      await sleep(POLL_MS);
      infoSnapshot=await readSnapshot(client);
    }
    combined={
      ...combined,
      ...deriveWhatsappQualification({
        ...infoSnapshot,
        mainText:before.mainText,
        messageTexts:before.messageTexts,
        messageMeta:before.messageMeta,
      }),
    };
  }
  return {...result,...combined};
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
    const profileButton = [...document.querySelectorAll('[role="button"][aria-label]')]
      .find((node) => /(?:деталі профілю|profile details|данные профиля|сведения о профиле)/iu.test(node.getAttribute('aria-label') || ''));
    if (profileButton && !profileButton.hasAttribute('disabled')) {
      profileButton.click();
      return true;
    }
    const modernRegion = document.querySelector('#main header');
    const nodes = [
      ...document.querySelectorAll('#main header [data-testid="conversation-info-header-chat-title"], #main header [dir="auto"], [data-testid="conversation-info-header"] [dir="auto"], [data-testid="conversation-info-header"] [title], header [title], header h1, header h2'),
      ...(modernRegion ? modernRegion.querySelectorAll('[role="button"], [title], [dir="auto"], h1, h2') : []),
    ];
    const node = nodes.find((item) => {
      const raw = String(item.innerText || item.textContent || '').trim();
      const firstLine = raw.split(String.fromCharCode(10))[0] || '';
      const values = [item.getAttribute('title') || '', firstLine, raw].map(normalize).filter(Boolean);
      return values.some((value) => value === target || value.startsWith(target + ' '));
    });
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
        const timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP command timeout: '+method));},60000);
        pending.set(id, { resolve:value=>{clearTimeout(timer);resolve(value);}, reject:error=>{clearTimeout(timer);reject(error);} });
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
