import { enterBackgroundMode, openBackgroundTab } from './cdp-background.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Real WhatsApp invite resolution can exceed 20s before the factual join/retry modal appears.
const DEFAULT_TIMEOUT_MS = 45_000;
// WhatsApp autopost lease is 90 s (lib/messenger-automation.ts). Target verification and
// payload preparation share one 45 s budget and confirmation gets at most 30 s, so a send can
// never happen or be confirmed after the lease has passed to another claim.
const AUTOPOST_SEND_CONFIRM_MS = 30_000;
// Фото з підписом WhatsApp Web вантажить довше за текст: живий запуск 2026-10-24 показав повідомлення в чаті лише через ≈60 с після кліку,
// тож 30 с давали хибне «не підтверджено» при вже відправленому фото. Після кліку час уже ні на що інше не потрібен.
const AUTOPOST_MEDIA_CONFIRM_MS = 90_000;
// Після кожного натискання «Надіслати» вкладка лишається в чаті ще стільки: страховка поверх очікування галочки, а не замість нього.
const AFTER_SEND_SETTLE_MS = 30_000;
const AUTOPOST_TEXT_PENDING_WAIT_MS = 90_000;
// Фото, що вже «в дорозі» (годинник біля нашого повідомлення), чекаємо до галочки довше: перехід у наступний чат чи перезавантаження вкладки
// вбивають повідомлення, яке ще вантажиться (2026-10-26: у Work OS «відправлено», а в чаті годинник назавжди).
const AUTOPOST_PENDING_WAIT_MS = 180_000;
// Власне невідправлене шукаємо лише після нашої недавньої відправки: старі «застряглі» годинники з минулих збоїв перехід не блокують.
const RECENT_SEND_MS = 10 * 60_000;
// The attached photo's preview overlay. Eight seconds was arbitrary and too tight on a WhatsApp Web that is
// still waking up, which burned a whole queue of jobs at once (live report 2026-10-06).
const AUTOPOST_MEDIA_PREVIEW_MS = 20_000;
const POLL_MS = 400;
// Stays below the server's 120s Waiting-check lease.
const WAITING_CHECK_TIMEOUT_MS = 100_000;

const pendingPattern = /(?:request(?: to join)? sent|request pending|запит (?:на вступ )?надіслано|запит очікує|заявк[ау] (?:на вступление )?отправлен[а]?|заявк[ау] ожидает)/iu;
const approvalRequiredPattern = /(?:admin(?:istrator)? approval (?:is )?(?:required|turned on)|an admin (?:must|needs to) approve|request to join|потрібне схвалення адміністратор|адміністратор має схвалити|потрібно подати запит на вступ|требуется одобрение администратора|администратор должен одобрить|нужно отправить запрос на вступление)/iu;
const adminOnlyPattern = /(?:only (?:community )?admins can send messages|лише адміністратор(?:и|ам)(?: спільноти)? (?:можуть|можна|дозволено) надсилати повідомлення|тільки адміністратор(?:и|ам)(?: спільноти)? (?:можуть|можна|дозволено) надсилати повідомлення|только администратор(?:ы|ам)(?: сообщества)? (?:могут|можно|разрешено) отправлять сообщения)/iu;
const authPattern = /(?:link with phone number|log in to whatsapp|увійти у whatsapp|войти в whatsapp)/iu;
const joinRetryLaterPattern = /(?:could(?:n['’]?t| not) join (?:this )?(?:group|community)|try again later|не вдалося приєднатися до (?:цієї )?(?:групи|спільноти)|повторіть спробу пізніше|не удалось присоединиться к (?:этой )?(?:группе|сообществу)|повторите попытку позже)/iu;
const unavailablePatterns = [
  { pattern: /(?:invite link).*(?:invalid|reset|expired)|(?:недійсне|скинуте|прострочене).*(?:посилання|запрошення)|(?:недействительн|сброшен|истек).*(?:ссылк|приглашен)/iu, reason: 'invalid_whatsapp_link' },
  { pattern: /(?:can['’]?t join this group because you were removed|(?:оскільки|бо) вас (?:було )?вилучено|(?:так как|потому что) вас (?:удалили|исключили))/iu, reason: 'whatsapp_removed_from_group' },
  { pattern: /(?:group).*(?:no longer available|does not exist)|(?:група).*(?:більше недоступна|не існує)|(?:группа).*(?:больше недоступна|не существует)/iu, reason: 'whatsapp_chat_missing' },
];

const requestJoinPattern = /^(?:request(?: to join)?(?: group| chat| community)?|send (?:a )?request(?: to join)?|подати запит(?: на вступ)?|надіслати запит(?: на вступ)?|запит на приєднання|отправить запрос(?: на вступление)?|подать заявку(?: на вступление)?|запрос на (?:вступление|присоединение))$/iu;
const directJoinPattern = /^(?:join(?: group| chat| community)?|приєднатися(?: до групи| до чату| до спільноти)?|присоединиться(?: к группе| к чату| к сообществу)?)$/iu;
const joinPattern = /^(?:join(?: group| chat| community)?|request to join|приєднатися(?: до групи| до чату| до спільноти)?|подати запит на вступ|запит на приєднання|запрос на (?:вступление|присоединение)|присоединиться(?: к группе| к чату| к сообществу)?|отправить запрос на вступление)$/iu;
const viewPattern = /^(?:view(?: group| chat)?|open(?: group| chat)?|continue to chat|переглянути(?: групу| чат)?|відкрити(?: групу| чат)?|продовжити до чату|просмотреть(?: группу| чат)?|открыть(?: группу| чат)?|продолжить в чат)$/iu;
const leavePattern = /^(?:exit group|leave group|вийти з групи|покинути групу|выйти из группы|покинуть группу)$/iu;
const confirmLeavePattern = /^(?:exit(?: group)?|leave(?: group)?|вийти(?: з групи)?|покинути(?: групу)?|выйти(?: из группы)?|покинуть(?: группу)?)$/iu;
const leftPattern = /(?:you (?:left|are no longer a participant)|ви (?:вийшли|більше не (?:є учасником|її учасник|учасник))|вы (?:вышли|больше не (?:являетесь участником|ее участник|участник)))/iu;
const joinedViaInvitePattern = /(?:you (?:joined|were added) (?:via|using|through) (?:an? )?(?:invite|invitation|invite link)|joined (?:via|using) (?:the )?(?:group )?invite|ви приєдналися за (?:посиланням[- ]?)?запрошенням|вы присоединились по (?:ссылке[- ]?)?приглашени[юя])/iu;
// Never a target even with a Ukrainian audience (operator decision 2026-10-02): religious communities and
// prayer groups. Checked against the group's own name/description only. Mirrors NON_TARGET_GROUP_PATTERN.
const nonTargetGroupPattern = /(?:церк|церков|храм|парафі|приход|монастир|монастыр|православн|католиц|греко-?католи|біблі|библи|молит(?:в|ов)|богослуж|єпарх|епарх|проповід|пропове|church|parish|bible|prayer|monaster|orthodox|catholic)/iu;
const spamPattern = /(?:crypto|крипт|bitcoin|forex|casino|казино|betting|ставк[аи]|dating|знакомств|знайомств|escort|ескорт|onlyfans|adult|18\+|nft|airdrop|signals?\b|binary options)/iu;
const ukrainianAudiencePattern = /(?:україн(?:ц|ськ)|украин(?:ц|ск)|ukrainians?|ukraińcy|ukrajinci|ucraineni|oekraïners|🇺🇦|\bвпо\b|біженц|переселенц)/iu;
const foreignAudiencePattern = /(?:\bisrael(?:i|is)?\b|ізраїл|израил|ישרא|\bhebrew\b|іврит|иврит)/iu;
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

function looseTargetLabel(value) {
  return normalizeTargetLabel(value).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
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
  const client=await createWhatsappPageClient(page);
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
    const topicMatch=spamPattern.test(evidence)||nonTargetGroupPattern.test(evidence)||foreignAudiencePattern.test(evidence)
      ?'mismatch'
      :ukrainianAudiencePattern.test(evidence)?'match':'unknown';
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
  const client=await createWhatsappPageClient(page);
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
          const cmd=window.require?.('WAWebCmd')?.Cmd;
          if(!query?.queryGroupInvite||(!${JSON.stringify(task.membershipState==='joined')}&&!invite?.joinGroupViaInvite)||!collections?.Chat||!widFactory?.createWid){
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
           const knownJoinedAt=${JSON.stringify(Number(task.preflightFacts?.joinedAt||task.checkpoint?.result?.joinedAt||0)||0)};
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
          const joinedAt=alreadyJoined?knownJoinedAt:Date.now();
          const wid=widFactory.createWid(gid);
          let chat=collections.Chat.get(wid);
          if(!chat&&collections.Chat.find)chat=await race(collections.Chat.find(wid),'chat_find');
          if(!chat)return {ok:false,reason:'joined_chat_not_found',gid};
          const stepRace=(promise,label,maxMs=2500)=>Promise.race([
            Promise.resolve(promise),
            new Promise((_,reject)=>setTimeout(()=>reject(new Error(label+'_timeout')),
              Math.max(1,Math.min(maxMs,deadline-Date.now())))),
          ]);
          if(alreadyJoined&&cmd?.openChatBottom){
            try{await stepRace(cmd.openChatBottom({chat}),'open_joined_chat',1800);}catch{}
          }
          if(loader?.loadRecentMsgs){
            try{await stepRace(loader.loadRecentMsgs({chat}),'recent_messages',2500);}catch{}
          }
          if(alreadyJoined&&loader?.loadEarlierMsgs){
            for(let historyPage=0;historyPage<2&&Date.now()<deadline-500;historyPage++){
              try{await stepRace(loader.loadEarlierMsgs({chat}),'earlier_messages_'+historyPage,2200);}
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
            joinedAt,
            joinedThisAttempt:!alreadyJoined,
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
    const joinedAt=Number(value.joinedAt)||0;
    const evidenceMessages=joinedAt>0
      ?userMessages.filter(item=>{
        const timestamp=Number(item?.timestamp)||0;
        return timestamp>0&&timestamp*1000>=joinedAt-60_000;
      })
      :userMessages;
    const latestTimestamp=Math.max(0,...evidenceMessages.map(item=>Number(item?.timestamp)||0));
    const nowSeconds=Math.floor(Date.now()/1000);
    let activityState;
    if(isDiscoveryRecentTimestamp(latestTimestamp*1000,nowSeconds*1000))activityState='active';
    else if(latestTimestamp>0)activityState='dead';
    const recentTexts=evidenceMessages.map(item=>String(item?.body||'')).filter(Boolean).slice(-80);
    const evidence=[value.subject,value.desc,value.parentTitle,value.parentDesc,...recentTexts].join('\n');
    const spamMessages=recentTexts.filter(text=>spamPattern.test(text)).length;
    const ukrainianMessages=recentTexts.filter(text=>ukrainianConversationPattern.test(text)).length;
    const identityEvidence=[
      String(value.subject||''),String(value.desc||''),
      String(value.parentTitle||''),String(value.parentDesc||''),
    ].join('\n');
    const topicMatch=spamPattern.test(identityEvidence)||nonTargetGroupPattern.test(identityEvidence)||spamMessages>=3
      ?'mismatch'
      :foreignAudiencePattern.test(identityEvidence)&&ukrainianMessages<2
        ?'mismatch'
        :ukrainianAudiencePattern.test(identityEvidence)||ukrainianMessages>=2?'match':'unknown';
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
        ...(joinedAt>0?{joinedAt}:{}),
        joinedThisAttempt:value.joinedThisAttempt===true,
        joinedDirect:true,
        recentMessageCount:recentTexts.length,
        evidenceScope:joinedAt>0?'post_join_timestamped':'visible_since_join',
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
  const client=await createWhatsappPageClient(page);
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

// When did the operator last use any Work OS tab? Local CDP read only: no network, no D1.
// Returns 0 when no Work OS tab is open, so a closed site means a fully quiet runner.
export async function readWorkOsLastActivityViaCdp(workOsUrl, { cdpBaseUrl } = {}) {
  const base = cdpBaseUrl ? normalizeLocalCdpBaseUrl(cdpBaseUrl) : null;
  if (!base) return { kind:'blocked', reason:'cdp_not_configured' };
  let expectedOrigin;
  try { expectedOrigin = new URL(String(workOsUrl || '')).origin; }
  catch { return { kind:'blocked', reason:'work_os_origin_invalid' }; }
  const response = await fetch(`${base}/json/list`, { signal:AbortSignal.timeout(4_000) });
  if (!response.ok) throw new Error(`CDP list HTTP ${response.status}`);
  const pages = await response.json();
  const workOsPages = Array.isArray(pages) ? pages.filter((item) => {
    if (item?.type !== 'page' || !item?.webSocketDebuggerUrl || !isLocalCdpWebSocketUrl(item.webSocketDebuggerUrl)) return false;
    try { return new URL(item.url || '').origin === expectedOrigin; } catch { return false; }
  }) : [];
  if (!workOsPages.length) return { kind:'result', lastActiveAt:0, pageOpen:false };
  // All Work OS tabs share one localStorage, so the first readable tab is enough.
  const client = await createCdpClient(workOsPages[0].webSocketDebuggerUrl);
  try {
    const result = await client.send('Runtime.evaluate', {
      expression:`Number(localStorage.getItem('work-os:last-active-at:v1'))||0`,
      returnByValue:true,
    });
    const lastActiveAt = Number(result?.result?.value) || 0;
    return { kind:'result', lastActiveAt, pageOpen:true };
  } finally {
    client.close();
  }
}

// The Discovery autonomous run's state no longer lives in the Work OS tab (2026-10-04): the owner Durable
// Object keeps it and talks to the runner over the live channel, so the CDP bridge functions that used to
// read and rewrite the tab's sessionStorage are gone.

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

  // On the exact invite the code already identifies the group, so the name may differ only by
  // emoji, "#" or punctuation that WhatsApp renders as images or the operator left out.
  if (!isWeakExpectedName(expected)) {
    const looseExpected = looseTargetLabel(expected);
    const loose = looseExpected && [...(snapshot.headerNames || []), ...(snapshot.headerTitles || []), ...(snapshot.targetHeadings || []), ...(snapshot.targetTexts || [])]
      .find((value) => looseTargetLabel(value) === looseExpected);
    if (loose) return loose;
  }

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

  const requestButtonText = firstMatchingButton(snapshot, requestJoinPattern);
  // An invite that still offers "Request to join" means no request is pending yet: send it, for
  // join_and_inspect exactly like waiting_check. Operator decision 2026-10-05: a candidate that
  // already cleared the member-count/topic/chat-type checks upstream is worth requesting and letting
  // sit in Waiting for the admin's approval, not discarding outright just because it is not an
  // instant join. The result lands in membershipState 'pending' via the check above once the request
  // shows as sent (identical to how a Waiting recheck sees its own pending request).
  if (requestButtonText) {
    return { kind: 'action', action: 'request', buttonText: requestButtonText, observedName };
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

  const joinButtonText = firstMatchingButton(snapshot, directJoinPattern);
  if (joinButtonText && (task.action === 'join_and_inspect' || task.action === 'waiting_check')) {
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
  const client = await createWhatsappPageClient(page);
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
      const navigation = await openWhatsappInviteWhenSynced(client, page, targetUrl, operationDeadline);
      if (navigation.kind === 'blocked') return { kind:'blocked', reason:navigation.reason };
      opened = await waitForClassification(client, { ...task, action: 'inspect' }, remainingBudget(), null, navigatedInviteCode, true);
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

// Paste the photo into the composer, the way a person presses Ctrl+V — which is exactly what the previous
// Prototype Checker did (clipboard SetImage + Ctrl+V into the composer) and why captions worked there.
// Feeding the hidden input[type=file] instead opens WhatsApp's full media EDITOR (crop/draw/filter), and on
// the operator's build that editor has no caption field at all; the paste route opens the ordinary preview
// that does. Verified against devillionner/Prototype-Checker-Work-OS, autopost-photo-helper.ps1 (2026-10-07).
async function pasteWhatsappImage(client, media) {
  const expression=`(() => {
    const visible=(node)=>{const r=node.getBoundingClientRect();return r.width>0&&r.height>0;};
    const node=[...document.querySelectorAll('[contenteditable="true"]')].filter(visible).find((item)=>item.closest('footer'))
      ||[...document.querySelectorAll('[contenteditable="true"]')].filter(visible)[0];
    if(!node||typeof DataTransfer==='undefined')return false;
    try{
      const raw=atob(${JSON.stringify(String(media.base64||''))});
      const bytes=new Uint8Array(raw.length);
      for(let i=0;i<raw.length;i+=1)bytes[i]=raw.charCodeAt(i);
      const file=new File([bytes],${JSON.stringify(String(media.fileName||'work-os.jpg'))},{type:${JSON.stringify(String(media.contentType||'image/jpeg'))}});
      const transfer=new DataTransfer();
      transfer.items.add(file);
      node.focus();
      node.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));
      return true;
    }catch{return false;}
  })()`;
  const response=await client.send('Runtime.evaluate',{expression,returnByValue:true});
  return response?.result?.value===true;
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

// What the preview actually looked like when the wait ran out. A bare 'media_preview_not_ready' could mean a
// slow WhatsApp or a renamed control, and the log could not tell the two apart (live report 2026-10-06).
async function readWhatsappMediaPreviewDiagnostic(client){
  const expression=`(() => {
    const visible=(node)=>{const r=node.getBoundingClientRect();return r.width>0&&r.height>0;};
    const editors=[...document.querySelectorAll('[contenteditable="true"]')].filter(visible);
    const buttons=[...document.querySelectorAll('button, [role="button"]')].filter(visible);
    return JSON.stringify({
      loading:Boolean(document.querySelector('[data-testid="wa-web-loading-screen"]')),
      editors:editors.length,
      captionEditors:editors.filter((node)=>!node.closest('footer')).length,
      buttons:buttons.length,
      icons:[...new Set(buttons.map((node)=>node.querySelector('[data-icon]')?.getAttribute('data-icon')).filter(Boolean))].slice(0,12),
      labels:[...new Set(buttons.map((node)=>String(node.getAttribute('aria-label')||node.getAttribute('title')||'').trim()).filter(Boolean))].slice(0,12),
      // Every field the caption could possibly be, not just contenteditable ones: this build may use a plain
      // input or textarea, and guessing cost three rounds already (2026-10-07).
      fields:[...document.querySelectorAll('input, textarea, [contenteditable]')].map((node)=>({
        tag:node.tagName.toLowerCase(),
        type:node.getAttribute('type')||'',
        editable:node.getAttribute('contenteditable')||'',
        role:node.getAttribute('role')||'',
        label:String(node.getAttribute('aria-label')||node.getAttribute('placeholder')||node.getAttribute('data-placeholder')||'').slice(0,40),
        visible:visible(node),
        inFooter:Boolean(node.closest('footer')),
      })).slice(0,14),
      // What actually sits in the send control's row — the strip where a caption belongs.
      strip:(()=>{
        const send=[...document.querySelectorAll('button, [role="button"]')].filter(visible).find((node)=>node.querySelector('[data-icon*="send"]'));
        if(!send)return null;
        let box=send.parentElement;
        for(let step=0;step<3&&box&&box.getBoundingClientRect().width<window.innerWidth*0.5;step+=1)box=box.parentElement;
        if(!box)return null;
        return [...box.children].map((node)=>({
          tag:node.tagName.toLowerCase(),
          role:node.getAttribute('role')||'',
          label:String(node.getAttribute('aria-label')||'').slice(0,30),
          text:String(node.innerText||'').replace(/\\s+/g,' ').trim().slice(0,30),
          fields:node.querySelectorAll('input, textarea, [contenteditable]').length,
        })).slice(0,10);
      })(),
    });
  })()`;
  try{
    const response=await client.send('Runtime.evaluate',{expression,returnByValue:true});
    return String(response?.result?.value||'');
  }catch{return '';}
}

// Which editable field is the photo's caption. WhatsApp Web shows the caption inside the media preview, but
// the ordinary chat composer stays in the DOM too, and «any editor outside <footer>» picked the wrong one on
// the operator's build: the text landed in the chat composer, the photo went out with no caption, and the
// send confirmation (which looks for the caption on the sent message) failed with media_send_not_confirmed
// (live report 2026-10-07). So every editable field present BEFORE the photo is attached is marked, and the
// caption is the visible one that appeared WITH the preview — no class names, no footer guessing.
const MARK_EXISTING_EDITORS_JS = `(() => {
  const visible=(node)=>{const r=node.getBoundingClientRect();return r.width>0&&r.height>0;};
  for(const node of document.querySelectorAll('[contenteditable="true"]'))node.removeAttribute('data-work-os-pre');
  for(const node of [...document.querySelectorAll('[contenteditable="true"]')].filter(visible))node.setAttribute('data-work-os-pre','1');
  return true;
})()`;
// The caption node, in the one form all three steps (wait, type, verify) must agree on.
const CAPTION_NODE_JS = `(() => {
  const visible=(node)=>{const r=node.getBoundingClientRect();return r.width>0&&r.height>0;};
  const editors=[...document.querySelectorAll('[contenteditable="true"]')].filter(visible);
  return editors.find((node)=>!node.hasAttribute('data-work-os-pre'))
    ||editors.find((node)=>!node.closest('footer'))
    ||null;
})()`;
// Is this control "send"? A label match without the word-boundary escape: in JavaScript it is ASCII-only, so «\b + надісла» never matched a Cyrillic label
// («Надіслати»), and the check lived on the data-icon alone until WhatsApp dropped data-icon from its buttons — after which every
// media preview looked "not ready" and the whole queue failed with media_preview_not_ready (2026-10-18..24, no icons in the diagnostic).
const SEND_MATCH_JS = `const isSend=(node)=>{
    const label=String(node.getAttribute('aria-label')||node.getAttribute('title')||node.textContent||'').trim();
    return /(^|[^\\p{L}])(send|надісла|відправ|отправ)/iu.test(label)
      ||Boolean(node.querySelector('[data-icon*="send"], [data-testid*="send"], [data-icon*="wds-ic-send"]'));
  };`;
// The media preview's own send control. Besides the label, the shape is checked: a button in the same band as the preview's caption
// editor (not the chat footer), to the right of it, the right-most one — the round send button. A wrong guess cannot post by itself:
// the send is confirmed by the message appearing in the chat, otherwise the job stops as media_send_not_confirmed.
const SEND_CONTROL_JS = `(() => {
  const visible=(node)=>{const r=node.getBoundingClientRect();return r.width>0&&r.height>0;};
  ${SEND_MATCH_JS}
  const buttons=[...document.querySelectorAll('button, [role="button"]')].filter(visible);
  // Живий збір 2026-10-24: кнопка у вікні фото має підпис «Надіслати 1 вибраний файл» (значок ic-send-filled), поруч у меню прикріплення
  // є й інші «Надіслати …» («Надіслати документ»), тож спершу кнопка з числом вибраних файлів.
  const byLabel=buttons.find((node)=>isSend(node)&&/\\d+\\s+(вибран|selected|выбран)/iu.test(String(node.getAttribute('aria-label')||node.title||'')))
    ||buttons.find((node)=>!node.closest('footer')&&isSend(node))||buttons.find(isSend);
  if(byLabel)return byLabel;
  const caption=${CAPTION_NODE_JS};
  if(!caption||caption.closest('footer'))return null;
  const box=caption.getBoundingClientRect();
  const row=buttons.filter((node)=>{
    if(node.closest('footer')||node.contains(caption)||caption.contains(node))return false;
    const r=node.getBoundingClientRect();
    const middle=r.top+r.height/2;
    return middle>=box.top-40&&middle<=box.bottom+40&&r.left>=box.right-4&&r.width<=96&&r.height<=96;
  }).sort((a,b)=>b.getBoundingClientRect().left-a.getBoundingClientRect().left);
  return row[0]||null;
})()`;

async function markWhatsappEditorsBeforeMedia(client){
  try{await client.send('Runtime.evaluate',{expression:MARK_EXISTING_EDITORS_JS,returnByValue:true});}catch{}
}

async function waitForWhatsappMediaPreview(client,timeoutMs){
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){
    const expression=`Boolean(${SEND_CONTROL_JS})`;
    const response=await client.send('Runtime.evaluate',{expression,returnByValue:true});
    if(response?.result?.value===true)return true;
    await sleep(POLL_MS);
  }
  return false;
}

// On the operator's WhatsApp build the media editor opens with NO caption field at all: the diagnostic found
// exactly one contenteditable on the page and it was the chat composer (icons scissors/crop/filter/draw and
// the send control were there, a caption editor was not). The caption input only mounts once that strip at
// the bottom of the editor is clicked, so click it — to the left of the send control, in its row — and wait
// for the field to appear.
async function openWhatsappMediaCaption(client,timeoutMs){
  const deadline=Date.now()+timeoutMs;
  const captionPresent=`Boolean(${CAPTION_NODE_JS})`;
  const already=await client.send('Runtime.evaluate',{expression:captionPresent,returnByValue:true});
  if(already?.result?.value===true)return true;
  const point=`(() => {
    const send=${SEND_CONTROL_JS};
    if(!send)return null;
    const rect=send.getBoundingClientRect();
    // The caption strip shares the send control's row and fills the space to its left.
    const x=Math.max(24,Math.round(rect.left-Math.min(320,rect.left/2)));
    return JSON.stringify({x,y:Math.round(rect.top+rect.height/2)});
  })()`;
  while(Date.now()<deadline){
    const response=await client.send('Runtime.evaluate',{expression:point,returnByValue:true});
    const raw=response?.result?.value;
    if(!raw)return false;
    const {x,y}=JSON.parse(String(raw));
    for(const type of ['mouseMoved','mousePressed','mouseReleased']){
      await client.send('Input.dispatchMouseEvent',{type,x,y,button:'left',clickCount:type==='mouseMoved'?0:1,buttons:type==='mousePressed'?1:0});
    }
    await sleep(POLL_MS);
    const found=await client.send('Runtime.evaluate',{expression:captionPresent,returnByValue:true});
    if(found?.result?.value===true)return true;
  }
  return false;
}

async function focusAndClearWhatsappMediaCaption(client){
  const expression=`(() => {
    const node=${CAPTION_NODE_JS};
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
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){
    const expression=`(() => {
      const node=${CAPTION_NODE_JS};
      if(!node)return '';
      const clone=node.cloneNode(true);
      clone.querySelectorAll('img[alt]').forEach((img)=>{
        const alt=img.getAttribute('alt');
        if(alt)img.replaceWith(document.createTextNode(alt));
      });
      return String(clone.innerText||clone.textContent||'');
    })()`;
    const response=await client.send('Runtime.evaluate',{expression,returnByValue:true});
    const currentVal=response?.result?.value||'';
    if(matchesCaptionOrText(currentVal,expectedText))return true;
    await sleep(POLL_MS);
  }
  return false;
}

async function waitForNoInviteCheckDialog(client,timeoutMs){
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){
    const busy=(await client.send('Runtime.evaluate',{expression:`[...document.querySelectorAll('[role="dialog"]')].some((n)=>/Перевірка запрошення|Checking invitation|Проверка приглашения/i.test(n.innerText||''))`,returnByValue:true}))?.result?.value===true;
    if(!busy)return true;
    await sleep(POLL_MS);
  }
  return false;
}

async function saveFailureShot(client){
  try{
    const shot=await client.send('Page.captureScreenshot',{format:'jpeg',quality:55});
    const dir=join(process.env.XDG_STATE_HOME||join(homedir(),'.local','state'),'work-os');
    mkdirSync(dir,{recursive:true});
    writeFileSync(join(dir,'whatsapp-last-failure.jpg'),Buffer.from(shot.data,'base64'));
  }catch{/* знімок необов'язковий */}
}

async function clickWhatsappMediaSend(client){
  const expression=`(() => {
    const button=${SEND_CONTROL_JS};
    if(!button||button.hasAttribute('disabled'))return false;
    button.click();return true;
  })()`;
  const response=await client.send('Runtime.evaluate',{expression,returnByValue:true});
  if(response?.result?.value===true)return true;
  // No send button recognised: Enter in the preview's caption field sends the media in WhatsApp Web. Same safety as the click — the
  // result is confirmed by the message in the chat, not by this call.
  const focused=await client.send('Runtime.evaluate',{expression:`(() => { const node=${CAPTION_NODE_JS}; if(!node||node.closest('footer'))return false; node.focus(); return true; })()`,returnByValue:true});
  if(focused?.result?.value!==true)return false;
  await client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
  await client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
  return true;
}

// Для дії «Перевірити»: усі рядки повідомлень відкритого чату (без обмеження «останні 50») і прокрутка стрічки вгору на сторінку.
// Стан повідомлення в рядку чату. WhatsApp Web 2026-10 прибрав `data-icon` і `true_` у data-id; знято наживо (2026-10-26, вкладка runner):
//  · вихідне повідомлення: svg `<title>tail-out</title>`, aria-label «Ви:» (ru «Вы:», en «You:»); data-id тепер на кшталт `3EB01E19…`;
//  · годинник (ще не пішло): svg `<title>ic-schedule</title>`;
//  · галочки: svg `<title>wds-ic-delivered</title>` (так само `wds-ic-sent`, `wds-ic-read`), у списку чатів ті самі назви;
//  · помилка: svg `<title>ic-error</title>`, `data-testid="fail-container"`, aria-label «Сталася помилка. Натисніть, щоб дізнатися більше».
// «Відправлено» — лише коли галочка видна; відсутність годинника нічого не доводить. Назви шукаємо за закінченням, щоб пережити префікси `wds-`.
const ROW_STATE_FN = `const rowState = (row, node) => {
  const lower = (value) => String(value || '').toLowerCase();
  const titles = [...row.querySelectorAll('svg title')].map((item) => lower(item.textContent));
  const labels = [...row.querySelectorAll('[aria-label]')].map((item) => lower(item.getAttribute('aria-label')));
  const testIds = [...row.querySelectorAll('[data-testid]')].map((item) => lower(item.getAttribute('data-testid')));
  const any = (list, pattern) => list.some((value) => pattern.test(value));
  const fromMe = Boolean(
    (node.getAttribute('data-id') || '').startsWith('true_') || row.classList?.contains('message-out') || row.querySelector('.message-out')
    || any(titles, /^(?:tail-out|(?:wds-)?ic-.*-out)$/) || any(labels, /^(?:ви|you|вы)\\s*:/) || any(testIds, /^(?:tail-out|fail-container)$/)
  );
  const error = any(titles, /(?:^|-)error$/) || any(testIds, /^(?:fail-container|msg-error)$/) || any(labels, /сталася помилка|не вдалося надіслати|ошибка|не удалось отправить|something went wrong|failed to send/)
    || Boolean(row.querySelector('[data-icon="msg-error"], [data-icon="status-error"]'));
  const pending = any(titles, /(?:^|-)(?:schedule|msg-time|status-time|clock)$/) || any(testIds, /^(?:msg-time|spinner)$/) || any(labels, /^(?:очікування|pending|ожидание|надсилається|sending)/)
    || Boolean(row.querySelector('[data-icon="msg-time"], [data-icon="status-time"], progress'));
  const ack = any(titles, /(?:^|-)(?:sent|delivered|read|check|dblcheck|done|done-all|msg-check|msg-dblcheck)$/) || any(labels, /^(?:надіслано|доставлено|прочитано|sent|delivered|read|отправлено)/)
    || Boolean(row.querySelector('[data-icon="msg-check"], [data-icon="msg-dblcheck"], [data-icon="msg-dblcheck-ack"]'));
  return { fromMe, pending, error, ack: ack && !pending && !error };
};`;

export const READ_ALL_ROWS_JS = `(() => {
  ${ROW_STATE_FN}
  const seen = new Set();
  return [...document.querySelectorAll('#main [data-id]')].map((node) => {
    const key = node.getAttribute('data-id') || '';
    if (!key || seen.has(key)) return null;
    seen.add(key);
    const row = node.closest('div[role="row"]') || node;
    return { key, text: String(row.innerText || '').slice(0, 4000), hasMedia: Boolean(row.querySelector('img, video, canvas')), ...rowState(row, node) };
  }).filter(Boolean);
})()`;
const SCROLL_CHAT_UP_JS = `(() => {
  let el = document.querySelector('#main [data-id]');
  while (el && el !== document.body) {
    if (el.scrollHeight > el.clientHeight + 40 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) break;
    el = el.parentElement;
  }
  if (!el || el === document.body) return { ok: false, atTop: true };
  const before = el.scrollTop;
  el.scrollTop = Math.max(0, el.scrollTop - Math.round(el.clientHeight * 0.85));
  return { ok: true, atTop: before <= 0 };
})()`;

export async function sendWhatsappAutopostViaCdp(
  task,
  { cdpBaseUrl, timeoutMs = DEFAULT_TIMEOUT_MS, shouldAbort = () => false, onStep = () => {}, verifyOnly = false, sinceEpoch = 0 } = {},
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
  const client = await createWhatsappPageClient(page);
  try {
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    const inspectTask = {
      runtime:'whatsapp_web', platform:'whatsapp', action:'inspect',
      name:task.target.expectedName,
      link:task.target.expectedLink,
      expectedTarget:{name:task.target.expectedName,link:task.target.expectedLink},
    };
    const navigatedInviteCode = whatsappInviteCode(task.target?.expectedLink);
    let operationDeadline = Date.now() + timeoutMs;
    const remainingBudget = () => Math.max(POLL_MS, operationDeadline - Date.now());
    const confirmWindowMs = Math.min(timeoutMs, AUTOPOST_SEND_CONFIRM_MS);
    onStep('open', 'відкриваю чат');
    // Не йдемо з чату, поки там є наше невідправлене (годинник): переходи всередині застосунку теж чекають галочку.
    if (!await waitForOwnPendingToClear(client, AUTOPOST_PENDING_WAIT_MS)) return { kind:'blocked', reason:'whatsapp_pending_outgoing' };
    operationDeadline = Date.now() + timeoutMs;
    // Приєднаний чат відкриваємо всередині WhatsApp Web (пошук у списку й клік), без перезавантаження вкладки; посилання-запрошення
    // лишається для чатів, яких у списку немає (не приєднані, інша назва).
    let observedTarget = '';
    // Пошук у фоновій вкладці інколи не відфільтровує список з першого разу: дві спроби, і лише потім посилання-запрошення.
    let openedInApp = false;
    if (task.target.expectedName) {
      for (let attempt = 0; attempt < 2 && !openedInApp; attempt += 1) openedInApp = await openChatInApp(client, task.target.expectedName, 10_000).catch(() => false);
    }
    if (openedInApp) {
      const opened = await readSnapshot(client);
      await sleep(1_200);
      const header = (opened.headerNames || []).map((value) => String(value || '').trim()).find(Boolean) || '';
      if (header && !await openChatMatchesTarget(client, task.target.expectedName, header)) { observedTarget = ''; }
      else if (header && !leftPattern.test(String(opened.bodyText || '')) && !opened.hasQr) observedTarget = header;
    }
    if (!observedTarget) {
      const navigation = await openWhatsappInviteWhenSynced(client, page, targetUrl, operationDeadline);
      if (navigation.kind === 'blocked') return { kind:'blocked', reason:navigation.reason };
      let classified = await waitForClassification(client, inspectTask, remainingBudget(), null, navigatedInviteCode, true);
      if (classified.kind === 'action' && classified.action === 'view') {
        const clicked = await clickExactButton(client, classified.buttonText, classified.observedName || task.target.expectedName);
        if (!clicked) return { kind:'blocked', reason:'expected_control_disappeared' };
        const observedTask = classified.observedName
          ? { ...inspectTask, name:classified.observedName, expectedTarget:{...inspectTask.expectedTarget,name:classified.observedName} }
          : inspectTask;
        classified = await waitForClassification(client, observedTask, remainingBudget(), 'view', navigatedInviteCode);
      }
      if (classified.kind !== 'result' || classified.result.targetVerified !== true || classified.result.membershipState !== 'joined') {
        // Справжній стан членства замість загального «не підтверджено»: вилучено/вийшли, заявка без відповіді, посилання недійсне. Інакше чат
        // безкінечно «пропускався» й не архівувався.
        const result = classified.kind === 'result' ? classified.result : null;
        const real = result?.reason || (result?.membershipState === 'pending' ? 'approval_required' : '') || classified.reason;
        return { kind:'blocked', reason:real || 'joined_target_not_verified' };
      }
      observedTarget = classified.result.observedName || task.target.expectedName;
    }
    const before = await readSnapshot(client);
    if (!before.composer) return { kind:'blocked', reason:before.adminOnly ? 'admin_only' : 'read_only' };
    // Дія «Перевірити»: нічого не надсилаємо, лише шукаємо в чаті своє повідомлення з цим підписом і міткою часу навколо моменту
    // відправки (учорашнє оголошення з тим самим текстом не зараховується).
    if (verifyOnly) {
      onStep('confirm', 'шукаю повідомлення в чаті');
      // Рядки чату підтягуються не миттєво: чекаємо до 8 с, поки вони з'являться. Далі гортаємо чат вгору сторінка за сторінкою, поки
      // не знайдемо повідомлення, не дійдемо до початку чату або не вичерпаємо ліміт: у жвавій групі за годину свого повідомлення
      // нижче вже немає (раніше дивились лише останні 50 рядків і давали хибне «не знайдено»).
      const readRows = async () => (await client.send('Runtime.evaluate', { expression:READ_ALL_ROWS_JS, returnByValue:true }))?.result?.value || [];
      let rows = await readRows();
      for (let attempt = 0; attempt < 8 && !rows.length; attempt += 1) { await sleep(1000); rows = await readRows(); }
      const sent = sinceEpoch > 0 ? sinceEpoch * 1000 : Date.now();
      const labels = [-4, -3, -2, -1, 0, 1, 2].flatMap((shift) => {
        const at = new Date(sent + shift * 60_000);
        const hh = String(at.getHours()).padStart(2, '0'); const mm = String(at.getMinutes()).padStart(2, '0');
        const h12 = ((at.getHours() + 11) % 12) + 1;
        return [`${hh}:${mm}`, `${h12}:${mm}`];
      });
      // Момент відправки невідомий (давня перевірка без нього): мітку часу не звіряємо, шукаємо лише за підписом.
      // fromMe не вимагаємо: у деяких збірках WhatsApp Web ознака вихідного повідомлення не читається.
      const findHit = (list) => list.find((row) => matchesCaptionOrText(row.text, text) && (sinceEpoch <= 0 || labels.some((label) => String(row.text || '').includes(label))));
      let hit = findHit(rows);
      let pages = 0;
      for (; !hit && pages < 16; pages += 1) {
        const moved = (await client.send('Runtime.evaluate', { expression:SCROLL_CHAT_UP_JS, returnByValue:true }))?.result?.value;
        await sleep(800);
        rows = await readRows();
        hit = findHit(rows);
        if (!moved?.ok || moved.atTop) break;
      }
      if (hit) return { kind:'result', result:{ status:'sent', observedTarget, targetVerified:true, sendConfirmed:true, mediaConfirmed:true } };
      console.warn('WhatsApp verify diagnostic: ' + JSON.stringify({ pages, rows: rows.length, labels: labels.slice(0, 4), tail: rows.slice(-2).map((row) => String(row.text || '').slice(-36)) }));
      return { kind:'blocked', reason:'message_not_found' };
    }
    const beforeKeys = new Set((before.messageRows || []).map((row) => row.key).filter(Boolean));
    const media=task.material?.media;
    if(media?.base64){
      if(!/^image\/(jpeg|png|webp)$/u.test(String(media.contentType||'')))return {kind:'blocked',reason:'unsupported_media_type'};
      // The caption goes into the CHAT COMPOSER first, before the photo is attached: WhatsApp carries whatever
      // the composer holds into the media preview as the caption. The preview's own caption field does not
      // exist at all on the operator's build — the diagnostic found only the sidebar search and the composer
      // while the editor was open, and clicking the strip under the photo mounted nothing (2026-10-07).
      onStep('photo','додаю фото');
      // Після відкриття за запрошенням WhatsApp ще показує «Перевірка запрошення»: поки це вікно висить, чат не готовий і кнопка «Надіслати» не діє.
      if(!await waitForNoInviteCheckDialog(client,20_000))return {kind:'blocked',reason:'page_not_ready'};
      if(!await discardOpenMediaEditor(client))return {kind:'blocked',reason:'page_not_ready'};
      if(!await focusAndClearComposer(client))return {kind:'blocked',reason:'composer_not_found'};
      await markWhatsappEditorsBeforeMedia(client);
      // Paste first (the Prototype Checker's route, which yields a preview WITH a caption box); the hidden
      // file input stays as the fallback for a build where the paste handler does not take the file.
      let pasted=await pasteWhatsappImage(client,media);
      if(pasted)pasted=await waitForWhatsappMediaPreview(client,Math.min(remainingBudget(),6_000));
      if(!pasted&&!await injectWhatsappImage(client,media))return {kind:'blocked',reason:'media_attach_failed'};
      if(!await waitForWhatsappMediaPreview(client,Math.min(remainingBudget(),AUTOPOST_MEDIA_PREVIEW_MS))){
        const diagnostic=await readWhatsappMediaPreviewDiagnostic(client);
        if(diagnostic)console.warn('WhatsApp autopost media preview diagnostic: '+diagnostic);
        return {kind:'blocked',reason:'media_preview_not_ready'};
      }
      // The preview that the paste opens has its own caption box; type the text into it. A build that showed no
      // caption box at all (the file-input editor) still sends — the text then has to be in the composer, which
      // is the fallback path's own problem, not this one's.
      onStep('text','вводжу текст');
      if(await openWhatsappMediaCaption(client,Math.min(remainingBudget(),6_000))){
        if(!await focusAndClearWhatsappMediaCaption(client))return {kind:'blocked',reason:'media_caption_not_found'};
        await client.send('Input.insertText',{text});
        if(!await waitForWhatsappMediaCaption(client,text,Math.min(remainingBudget(),5_000)))return {kind:'blocked',reason:'media_caption_mismatch'};
      }else{
        const diagnostic=await readWhatsappMediaPreviewDiagnostic(client);
        if(diagnostic)console.warn('WhatsApp autopost caption diagnostic: '+diagnostic);
        return {kind:'blocked',reason:'media_caption_not_found'};
      }
      if(Date.now()>=operationDeadline)return {kind:'blocked',reason:'autopost_budget_exhausted'};
      // Оператор натиснув «Зупинити»: до кнопки відправки ще можна відмовитись, після неї ні.
      if(shouldAbort())return {kind:'blocked',reason:'cancelled'};
      // Остання перевірка перед кнопкою: відкритий чат має бути саме цим.
      if(!await openChatMatchesTarget(client,task.target.expectedName,observedTarget)){
        const wrong=await readOpenChatHeader(client);
        await discardOpenMediaEditor(client);
        return {kind:'blocked',reason:'target_unconfirmed',observedTarget:wrong};
      }
      onStep('send','надсилаю');
      if(!await clickWhatsappMediaSend(client))return {kind:'blocked',reason:'media_send_control_not_found'};
      recentSend.at=Date.now();
      onStep('confirm','чекаю галочку біля повідомлення');
      // «Відправлено» лише коли наш новий рядок (з нашим підписом) має галочку; годинник, що висить довше за вікно, — не підтвердження.
      const ackState=await waitForOwnAck(client,{beforeKeys,text,maxMs:Math.max(confirmWindowMs,AUTOPOST_PENDING_WAIT_MS),requireText:true});
      if(ackState.state==='sent'){
        return settleAfterSend(onStep,{kind:'result',result:{status:'sent',observedTarget,targetVerified:true,sendConfirmed:true,mediaConfirmed:true}});
      }
      if(ackState.state==='failed')return settleAfterSend(onStep,{kind:'blocked',reason:'media_send_failed'});
      // Живий збір 2026-10-24: після кліку повідомлення не з'явилось. Зберігаємо знімок і стан екрана, щоб бачити, що саме лишилось.
      const afterSend=await client.send('Runtime.evaluate',{expression:`JSON.stringify({previewOpen:[...document.querySelectorAll('button,[role="button"]')].some((n)=>/вибраний файл|selected file/i.test(n.getAttribute('aria-label')||'')),rows:document.querySelectorAll('#main [data-id]').length,outRows:[...document.querySelectorAll('#main [data-id]')].filter((n)=>/^true_/.test(n.getAttribute('data-id')||'')).length,dialogs:[...document.querySelectorAll('[role="dialog"]')].map((n)=>(n.innerText||'').replace(/\\s+/g,' ').slice(0,100))})`,returnByValue:true}).catch(()=>null);
      await saveFailureShot(client);
      return settleAfterSend(onStep,{kind:'blocked',reason:'media_send_not_confirmed',detail:`${ackState.state};${String(afterSend?.result?.value||'')}`});
    }
    if (!await focusAndClearComposer(client)) return { kind:'blocked', reason:'composer_not_found' };
    await client.send('Input.insertText', { text });
    const prepared = await waitForComposerText(client, text, Math.min(remainingBudget(), 5_000));
    if (!prepared) return { kind:'blocked', reason:'composer_content_mismatch' };
    if (Date.now() >= operationDeadline) return { kind:'blocked', reason:'autopost_budget_exhausted' };
    if (shouldAbort()) return { kind:'blocked', reason:'cancelled' };

    if (!await openChatMatchesTarget(client, task.target.expectedName, observedTarget)) {
      return { kind:'blocked', reason:'target_unconfirmed', observedTarget:await readOpenChatHeader(client) };
    }
    await client.send('Input.dispatchKeyEvent', { type:'keyDown', key:'Enter', code:'Enter', windowsVirtualKeyCode:13, nativeVirtualKeyCode:13 });
    await client.send('Input.dispatchKeyEvent', { type:'keyUp', key:'Enter', code:'Enter', windowsVirtualKeyCode:13, nativeVirtualKeyCode:13 });

    recentSend.at = Date.now();
    onStep('confirm', 'чекаю галочку біля повідомлення');
    const ackState = await waitForOwnAck(client, { beforeKeys, text, maxMs:Math.max(confirmWindowMs, AUTOPOST_TEXT_PENDING_WAIT_MS), requireText:true });
    if (ackState.state === 'sent') return settleAfterSend(onStep, { kind:'result', result:{ status:'sent', observedTarget, targetVerified:true, sendConfirmed:true } });
    if (ackState.state === 'failed') return settleAfterSend(onStep, { kind:'blocked', reason:'send_failed' });
    return settleAfterSend(onStep, { kind:'blocked', reason:'send_not_confirmed' });
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
  const client=await createWhatsappPageClient(page);
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
  const client=await createWhatsappPageClient(page);
  try{
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    if(!await waitForOwnPendingToClear(client,AUTOPOST_PENDING_WAIT_MS))return {kind:'blocked',reason:'whatsapp_pending_outgoing'};
    await client.send('Page.navigate',{url:'https://web.whatsapp.com/'});
    return {kind:'result'};
  }finally{client.close();}
}

/** Назва відкритого чату з шапки (перший рядок). */
async function readOpenChatHeader(client) {
  const response = await client.send('Runtime.evaluate', { expression:`String((document.querySelector('#main header') || {}).innerText || '').split('\\n')[0] || ''`, returnByValue:true }).catch(() => null);
  return String(response?.result?.value || '');
}

/**
 * Живі дані 2026-10-26: фото з підписом може лишитись непереданим у вікні перегляду (редактор висить відкритим годинами), а наступний
 * запуск тоді працює поверх нього. Відкрите вікно фото перед новою відправкою закриваємо: Escape й «Відхилити» (непереслане фото нікуди
 * не йде). true — вікна немає (було закрите чи його не було).
 */
const MEDIA_EDITOR_OPEN_JS = `(() => [...document.querySelectorAll('button, [role="button"]')].some((node) => {
  const r = node.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && /\\d+\\s+(вибран|selected|выбран)/iu.test(String(node.getAttribute('aria-label') || node.title || ''));
}))()`;
async function discardOpenMediaEditor(client) {
  const open = async () => (await client.send('Runtime.evaluate', { expression:MEDIA_EDITOR_OPEN_JS, returnByValue:true }).catch(() => null))?.result?.value === true;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!await open()) return true;
    await client.send('Input.dispatchKeyEvent', { type:'keyDown', key:'Escape', code:'Escape', windowsVirtualKeyCode:27, nativeVirtualKeyCode:27 });
    await client.send('Input.dispatchKeyEvent', { type:'keyUp', key:'Escape', code:'Escape', windowsVirtualKeyCode:27, nativeVirtualKeyCode:27 });
    await sleep(800);
    const point = (await client.send('Runtime.evaluate', { expression:`(() => {
      const button = [...document.querySelectorAll('button, [role="button"]')].find((node) => /^(відхилити|discard|отклонить)$/iu.test(String(node.innerText || '').trim()));
      if (!button) return null;
      const r = button.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`, returnByValue:true }).catch(() => null))?.result?.value;
    if (point) for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await client.send('Input.dispatchMouseEvent', { type, x:point.x, y:point.y, button:'left', clickCount:1 });
    await sleep(800);
  }
  return !await open();
}

/** Перед самою відправкою шапка відкритого чату має збігатися з ціллю: інакше повідомлення пішло б не туди. */
async function openChatMatchesTarget(client, ...names) {
  const header = looseTargetLabel(await readOpenChatHeader(client));
  return Boolean(header) && names.some((name) => looseTargetLabel(name) === header);
}

// Остання наша відправка в цій вкладці: після неї вкладку не можна перезавантажувати, поки повідомлення не отримало галочку.
const recentSend = { at: 0 };

/** Пауза в чаті після «Надіслати» (і при sent, і при непідтвердженні): наступний чат відкривається лише після неї. */
async function settleAfterSend(onStep, outcome) {
  recentSend.at = Date.now();
  onStep('settle', 'чекаю 30 с, щоб повідомлення точно пішло');
  await sleep(AFTER_SEND_SETTLE_MS);
  recentSend.at = Date.now();
  return outcome;
}

/**
 * Чекає, поки наш новий рядок (не було до відправки; наше, з нашим підписом) отримає галочку. Годинник — чекаємо; помилка — `failed`;
 * рядка немає або годинник/порожній стан пережили вікно — `missing`/`pending`, і це не «відправлено».
 */
async function waitForOwnAck(client, { beforeKeys, text, maxMs, requireText = true }) {
  const deadline = Date.now() + maxMs;
  let last = 'missing';
  while (Date.now() < deadline) {
    const snapshot = await readSnapshot(client);
    const rows = (snapshot.messageRows || []).filter((row) => row.key && !beforeKeys.has(row.key) && row.fromMe
      && (!requireText || matchesCaptionOrText(row.text, text) || row.hasMedia === true));
    const own = rows.find((row) => row.error === true) || rows.find((row) => row.ack === true) || rows[0];
    if (!own) last = 'missing';
    else if (own.error === true) return { state:'failed' };
    else if (own.ack === true) return { state:'sent' };
    else last = 'pending';
    await sleep(POLL_MS);
  }
  return { state:last };
}

/** Власні рядки відкритого чату: скільки з годинником, скільки з помилкою. */
async function readOwnRowStates(client) {
  const rows = (await client.send('Runtime.evaluate', { expression:READ_ALL_ROWS_JS, returnByValue:true }).catch(() => null))?.result?.value || [];
  const own = rows.filter((row) => row.fromMe);
  return { own: own.length, pending: own.filter((row) => row.pending).length, error: own.filter((row) => row.error).length };
}

/**
 * Не йдемо з чату, поки там є наше невідправлене: годинник біля власного повідомлення означає, що воно ще вантажиться, а перехід
 * (особливо `Page.navigate`) його вбиває. Чекаємо до галочки, не довше за `maxMs`. true — можна йти; false — повідомлення так і не пішло.
 */
export async function waitForOwnPendingToClear(client, maxMs, signal = null) {
  if (Date.now() - recentSend.at > RECENT_SEND_MS) return true;
  const deadline = Date.now() + maxMs;
  for (;;) {
    const state = await readOwnRowStates(client);
    if (state.pending === 0) return true;
    if (signal?.aborted || Date.now() >= deadline) return false;
    await sleep(1_000);
  }
}

/**
 * Відкриває вже приєднаний чат усередині WhatsApp Web (пошук у списку чатів і клік), без `Page.navigate`: перезавантаження вкладки
 * зайве для чату, де акаунт уже учасник, і воно вбиває невідправлені повідомлення. Клік по найвищому рядку з цією назвою; якщо такого немає,
 * повертає false, і виклик іде через посилання-запрошення. Ціль підтверджує далі звірка назви в шапці.
 */
export async function openChatInApp(client, expectedName, timeoutMs = 12_000) {
  const wanted = looseTargetLabel(expectedName);
  if (!wanted) return false;
  const deadline = Date.now() + timeoutMs;
  const evaluate = async (expression) => (await client.send('Runtime.evaluate', { expression, returnByValue:true, awaitPromise:true }).catch(() => null))?.result?.value;
  // Вкладка у фоні (`visibilityState: hidden`): список результатів пошуку не домальовується, рядки лишаються порожніми. Емуляція фокусу
  // (enterBackgroundMode при створенні клієнта) тримає вкладку «видимою» без перемикання вікна оператора; `bringToFront` ніде не викликається.
  await enterBackgroundMode(client);
  const press = async (type, key, code, vk, modifiers = 0) => client.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode:vk, nativeVirtualKeyCode:vk, modifiers });
  // Пошук: поле зліва над списком чатів (contenteditable або input), у ньому ще може лишитись попередній запит.
  const searchBox = await evaluate(`(() => {
    const node = document.querySelector('#side [contenteditable="true"], #side input[type="text"], [data-testid="chat-list-search"]');
    if (!node) return null;
    node.focus();
    const b = node.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  })()`);
  if (!searchBox) return false;
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await client.send('Input.dispatchMouseEvent', { type, x:searchBox.x, y:searchBox.y, button:'left', clickCount:1 });
  await press('keyDown', 'a', 'KeyA', 65, 2); await press('keyUp', 'a', 'KeyA', 65, 2);
  await press('keyDown', 'Backspace', 'Backspace', 8); await press('keyUp', 'Backspace', 'Backspace', 8);
  await client.send('Input.insertText', { text:String(expectedName).slice(0, 60) });
  // Назва чату — у першому елементі з атрибутом title: перший рядок innerText у чатів із непрочитаними — це «N непрочитане повідомлення».
  const readResultRows = async () => await evaluate(`(() => [...document.querySelectorAll('#pane-side [role="row"], #pane-side [role="listitem"]')].map((row) => {
    const b = row.getBoundingClientRect();
    const titled = row.querySelector('span[title]');
    const first = (titled && titled.getAttribute('title')) || String(row.innerText || '').split('\\n').map((line) => line.trim()).filter(Boolean)[0] || '';
    return { first, x: b.x + b.width / 2, y: b.y + b.height / 2, visible: b.width > 0 && b.height > 0 && b.y >= 0 && b.y + b.height <= window.innerHeight };
  }).filter((row) => row.visible))()`) || [];
  // Поки пошук не відфільтрував список, у ньому лежить весь список чатів (потрібний рядок за межами екрана або ще їде): чекаємо, коли
  // збіг стоїть у видимій частині й не зсувається між двома зчитуваннями.
  let clickAt = null;
  while (Date.now() < deadline) {
    await sleep(400);
    const rows = await readResultRows();
    // Рядки без тексту — список не домальований (вкладка у фоні): знімок найменшого розміру змушує браузер намалювати кадр.
    if (rows.length > 1 && rows.filter((row) => !row.first).length > 1) {
      await client.send('Page.captureScreenshot', { format:'jpeg', quality:1, clip:{ x:0, y:0, width:8, height:8, scale:0.1 } }).catch(() => {});
    }
    const first = rows.find((row) => looseTargetLabel(row.first) === wanted);
    if (!first) continue;
    await sleep(500);
    const again = (await readResultRows()).find((row) => looseTargetLabel(row.first) === wanted);
    if (again && Math.abs(again.y - first.y) < 2) { clickAt = again; break; }
  }
  // Запит із пошуку прибираємо виділенням і Backspace у самому полі: Escape поза полем закрив би відкритий чат.
  const finish = async () => {
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await client.send('Input.dispatchMouseEvent', { type, x:searchBox.x, y:searchBox.y, button:'left', clickCount:1 });
    await press('keyDown', 'a', 'KeyA', 65, 2); await press('keyUp', 'a', 'KeyA', 65, 2);
    await press('keyDown', 'Backspace', 'Backspace', 8); await press('keyUp', 'Backspace', 'Backspace', 8);
    await sleep(300);
  };
  if (!clickAt) { await finish(); return false; }
  // Клік могли «з'їсти» під час перемальовування списку: друга спроба бере свіжі координати рядка.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) {
      clickAt = (await readResultRows()).find((row) => looseTargetLabel(row.first) === wanted) || clickAt;
    }
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await client.send('Input.dispatchMouseEvent', { type, x:clickAt.x, y:clickAt.y, button:'left', clickCount:1 });
    // Шапка відкритого чату має показати саме цю назву.
    const until = Date.now() + 3_000;
    while (Date.now() < until) {
      await sleep(400);
      const header = await evaluate(`String((document.querySelector('#main header') || {}).innerText || '').split('\\n')[0] || ''`);
      if (looseTargetLabel(header) === wanted) { await finish(); return true; }
    }
  }
  await finish();
  return false;
}

// Opening an invite reloads WhatsApp Web, and on a large account the reload re-syncs messages for
// 30–60 s. Navigating again during that sync restarts it, so every operation that opens an invite goes
// through here: it skips navigation when the tab already shows this invite and waits a running sync out.
// WhatsApp rewrites the address back to "/" after opening an invite, so the URL alone cannot tell that
// this tab already shows it; a retry within a few minutes therefore reuses the earlier navigation.
const INVITE_NAVIGATION_REUSE_MS = 180_000;
const lastInviteNavigation = { url:'', at:0 };

async function openWhatsappInviteWhenSynced(client, page, targetUrl, deadline, signal = null) {
  if (lastInviteNavigation.url === targetUrl && Date.now() - lastInviteNavigation.at < INVITE_NAVIGATION_REUSE_MS) {
    return { kind:'ok', navigated:false };
  }
  try {
    const current = new URL(String(page.url || ''));
    const target = new URL(targetUrl);
    if (current.origin === target.origin && current.pathname === target.pathname
      && current.searchParams.get('code') === target.searchParams.get('code')) return { kind:'ok', navigated:false };
  } catch {}
  while (shouldDeferForGlobalWhatsAppLoading(await readSnapshot(client).catch(() => null))) {
    if (signal?.aborted) return { kind:'blocked', reason:'cancelled' };
    if (Date.now() + POLL_MS >= deadline) return { kind:'blocked', reason:'whatsapp_messages_loading' };
    await sleep(POLL_MS);
  }
  // Перезавантаження вбиває повідомлення, яке ще вантажиться (годинник біля нашого рядка): чекаємо галочку, а `onbeforeunload` (захист самого
  // WhatsApp від виходу з невідправленим) не чіпаємо, поки таке є.
  if (!await waitForOwnPendingToClear(client, AUTOPOST_PENDING_WAIT_MS, signal)) return { kind:'blocked', reason:'whatsapp_pending_outgoing' };
  try {
    await client.send('Runtime.evaluate', { expression: `window.onbeforeunload = null;` });
  } catch {}
  if (signal?.aborted) return { kind:'blocked', reason:'cancelled' };
  await client.send('Page.navigate', { url: targetUrl });
  lastInviteNavigation.url = targetUrl;
  lastInviteNavigation.at = Date.now();
  return { kind:'ok', navigated:true };
}

export async function inspectWhatsappTaskViaCdp(
  task,
  { cdpBaseUrl, timeoutMs = DEFAULT_TIMEOUT_MS, enrich = true, waitThroughLoading = true, signal = null } = {},
) {
  // `signal` (optional) lets the operator's Stop reach a check already in progress: it is checked
  // before navigating, on every wait poll and — the guarantee that matters — right before any click,
  // so nothing is pressed in WhatsApp after Stop. A CDP call already in flight still finishes first.
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
  const client = await createWhatsappPageClient(page);
  try {
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    const operationDeadline = Date.now() + timeoutMs;
    const opened = await openWhatsappInviteWhenSynced(client, page, targetUrl, operationDeadline, signal);
    if (opened.kind === 'blocked' && opened.reason === 'cancelled') return { kind:'blocked', reason:'cancelled' };
    if (opened.kind === 'blocked') return { kind:'blocked', reason:opened.reason, diagnostic:{ url:String(page.url||''), globalLoading:true, beforeNavigate:true } };

    const remainingBudget = () => Math.max(POLL_MS, operationDeadline - Date.now());
    const navigatedInviteCode = whatsappInviteCode(task.expectedTarget?.link || task.link);
    let currentTask = task;
    const actions = [];
    let classified = await waitForClassification(client, currentTask, remainingBudget(), null, navigatedInviteCode, waitThroughLoading, signal);
    for (let step = 0; step < 3 && classified.kind === 'action'; step += 1) {
      if (signal?.aborted) return { kind:'blocked', reason:'cancelled', actions };
      const observedName = classified.observedName || currentTask.expectedTarget?.name || currentTask.name;
      const clicked = await clickExactButton(client, classified.buttonText, observedName);
      if (!clicked) return { kind: 'blocked', reason: 'expected_control_disappeared' };
      const observedTask = classified.observedName
        ? { ...currentTask, name:classified.observedName, expectedTarget:{ ...currentTask.expectedTarget, name:classified.observedName } }
        : currentTask;
      const action = classified.action;
      actions.push(action);
      classified = await waitForClassification(client, observedTask, remainingBudget(), action, navigatedInviteCode, false, signal);
      currentTask = observedTask;
    }
    if (enrich && classified.kind === 'result' && classified.result.membershipState === 'joined' && classified.result.targetVerified === true) {
      classified = { kind:'result', result:await enrichJoinedQualification(client, currentTask, classified.result) };
    }
    return { ...classified, actions };
  } finally {
    client.close();
  }
}

// Problems of the local WhatsApp Web runtime, not of the checked chat: the chat goes back to the
// queue and the runner backs off instead of reporting a chat failure.
export const WAITING_CHECK_RUNTIME_REASONS = new Set([
  'cdp_not_configured', 'cdp_not_local', 'cdp_websocket_not_local', 'unsupported_runtime',
  'whatsapp_not_authenticated', 'page_not_ready', 'whatsapp_messages_loading', 'cancelled',
]);

export function toWaitingCheckOutcome(outcome) {
  if (outcome?.kind === 'blocked') {
    const reason = String(outcome.reason || 'unknown');
    return WAITING_CHECK_RUNTIME_REASONS.has(reason)
      ? { kind: 'blocked', reason }
      : { kind: 'result', status: 'failed', reason, diagnostic: outcome.diagnostic };
  }
  if (outcome?.kind !== 'result') return { kind: 'result', status: 'failed', reason: 'action_unconfirmed' };
  const result = outcome.result || {};
  const observedName = typeof result.observedName === 'string' ? result.observedName : undefined;
  const actions = Array.isArray(outcome.actions) ? outcome.actions : [];
  if (result.targetVerified === true && result.membershipState === 'joined') {
    return { kind: 'result', status: 'joined', observedName };
  }
  if (result.targetVerified === true && result.membershipState === 'pending') {
    return { kind: 'result', status: actions.length ? 'requested' : 'pending', observedName };
  }
  return { kind: 'result', status: 'failed', reason: String(result.reason || 'membership_not_confirmed'), observedName };
}

// One Waiting-tab chat, checked like Prototype Checker did: joined → approved, pending → +3 days,
// "Join"/"Request to join" is pressed once and the factual state after the click is reported.
// Opening an invite reloads WhatsApp Web, which then re-syncs messages for tens of seconds on a large
// account; the check waits that sync out instead of giving up and reloading again on every retry.
export async function checkWhatsappWaitingInviteViaCdp(task, { cdpBaseUrl, timeoutMs = WAITING_CHECK_TIMEOUT_MS, signal = null } = {}) {
  const outcome = await inspectWhatsappTaskViaCdp({
    platform: 'whatsapp',
    runtime: 'whatsapp_web',
    action: 'waiting_check',
    name: task.name,
    link: task.link,
    expectedTarget: { name: task.name, link: task.link },
  }, { cdpBaseUrl, timeoutMs, enrich: false, waitThroughLoading: true, signal });
  return toWaitingCheckOutcome(outcome);
}

async function findOrCreateWhatsappPage(base) {
  const response = await fetch(`${base}/json/list`, {
    signal: AbortSignal.timeout(4_000),
  });
  if (!response.ok) throw new Error(`CDP list HTTP ${response.status}`);
  const pages = await response.json();
  const whatsappPages = Array.isArray(pages)
    ? pages.filter((page) => page?.type === 'page' && String(page.url || '').startsWith('https://web.whatsapp.com/') && page.webSocketDebuggerUrl)
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

  const page = await openBackgroundTab(base, 'https://web.whatsapp.com/');
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

async function waitForClassification(client, task, timeoutMs, afterAction = null, navigatedInviteCode = null, waitThroughLoading = false, signal = null) {
  const deadline = Date.now() + timeoutMs;
  let last = { kind: 'blocked', reason: 'page_not_ready' };
  let diagnostic = null;
  let loadingSince = 0;
  while (Date.now() < deadline) {
    if (signal?.aborted) return { kind: 'blocked', reason: 'cancelled' };
    const snapshot = await readSnapshot(client);
    if(shouldDeferForGlobalWhatsAppLoading(snapshot)){
      if(!loadingSince)loadingSince=Date.now();
      if(waitThroughLoading&&Date.now()+POLL_MS<deadline){
        last={kind:'blocked',reason:'whatsapp_messages_loading'};
        await sleep(POLL_MS);
        continue;
      }
      if(waitThroughLoading||Date.now()-loadingSince>=1_200){
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
      buttons:(snapshot.buttons||[]).slice(0,12),
      targetHeadings:(snapshot.targetHeadings||[]).slice(0,6),
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
  if(last?.kind==='blocked'&&['target_not_verified','membership_not_confirmed'].includes(last.reason)&&diagnostic){
    return {...last,diagnostic};
  }
  return last;
}

async function readSnapshot(client) {
  const expression = `(() => {
    ${ROW_STATE_FN}
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
    const extractNodeText = (element) => {
      if (!element) return '';
      const clone = element.cloneNode(true);
      clone.querySelectorAll('img[alt]').forEach((img) => {
        const alt = img.getAttribute('alt');
        if (alt) img.replaceWith(document.createTextNode(alt));
      });
      return clean(clone.innerText || clone.textContent || '');
    };
    const composerNode = document.querySelector(
      '#main footer [contenteditable="true"][role="textbox"], #main [contenteditable="true"][role="textbox"], footer [contenteditable="true"], [data-testid="conversation-compose-box-input"], [aria-label*="message" i][contenteditable="true"], [aria-label*="повідом" i][contenteditable="true"], [aria-label*="сообщ" i][contenteditable="true"]'
    );
    const composer = Boolean(composerNode);
    const composerText = extractNodeText(composerNode);
    // Messages are found by their data-id, not by data-testid: the operator's WhatsApp build carries almost no
    // data-testid attributes at all (the diagnostic found exactly one on the whole page), so the old
    // '[data-testid="msg-container"]' selector matched nothing and every send came back unconfirmed even
    // though the message had actually gone out — media_send_not_confirmed on a visibly posted photo
    // (operator report 2026-10-07). data-id is WhatsApp's own message key and has been stable across builds.
    const seenKeys = new Set();
    const messageRows = [...document.querySelectorAll('#main [data-id], [data-testid="msg-container"], div[role="row"]')]
      .map((node) => (node.getAttribute('data-id') ? node : node.querySelector('[data-id]')))
      .filter((node) => {
        const key = node?.getAttribute('data-id') || '';
        if (!key || seenKeys.has(key)) return false;
        seenKeys.add(key);
        return true;
      })
      .slice(-50)
      .map((node) => {
        const row = node.closest('div[role="row"]') || node;
        const { fromMe, pending, error, ack } = rowState(row, node);
        return {
          key: node.getAttribute('data-id') || '',
          text: extractNodeText(row),
          hasMedia: Boolean(row.querySelector('img, video, canvas, [data-testid*="image"], [data-testid*="media"], [data-testid*="thumb"], [style*="background-image"]')),
          fromMe,
          pending,
          error,
          ack,
        };
      })
      .filter((row) => row.key && (row.text || row.hasMedia || row.fromMe));
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
  const topicMatch = spamPattern.test(identityText) || nonTargetGroupPattern.test(identityText) || spamMessages >= 3
    ? 'mismatch'
    : foreignAudiencePattern.test(identityText) && ukrainianMessages < 2
      ? 'mismatch'
      : ukrainianAudiencePattern.test(identityText) || ukrainianMessages >= 2 ? 'match' : undefined;
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
    if(!messagesLoadingPattern.test(body)&&(latest.composer===true||latest.adminOnly===true)&&hasHeader)return latest;
    await sleep(POLL_MS);
    latest=await readSnapshot(client);
  }
  return latest;
}

async function enrichJoinedQualification(client, task, result) {
  const before=await waitForJoinedChatReady(client);
  const preflightFacts=task.preflightFacts&&typeof task.preflightFacts==='object'?task.preflightFacts:{};
  const liveCanWrite=before.adminOnly===true?false:before.composer===true?true:undefined;
  let combined={
    ...preflightFacts,
    ...deriveWhatsappQualification(before),
    ...(liveCanWrite===undefined?{}:{canWrite:liveCanWrite}),
  };
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
    const infoCanWrite=infoSnapshot.adminOnly===true?false:before.composer===true?true:undefined;
    combined={
      ...combined,
      ...deriveWhatsappQualification({
        ...infoSnapshot,
        mainText:before.mainText,
        messageTexts:before.messageTexts,
        messageMeta:before.messageMeta,
      }),
      ...(infoCanWrite===undefined?{}:{canWrite:infoCanWrite}),
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
  const expected = looseMessageText(expectedText);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await readSnapshot(client);
    if (snapshot.composer && looseMessageText(snapshot.composerText || '') === expected) return true;
    await sleep(POLL_MS);
  }
  return false;
}

function normalizeMessageText(value) {
  return String(value || '').replace(/\r\n/gu, '\n').replace(/\u00a0/gu, ' ').trim();
}

// How much of the text has to match to call it ours. WhatsApp caps a photo caption (and reflows what it
// shows back), so demanding the whole string fails on a long advertisement — media_caption_mismatch on the
// operator's text, 2026-10-07. The Prototype Checker compared a 100-character probe for exactly this reason
// (autopost-photo-helper.ps1, Test-WhatsAppMessageVisible); this is the same rule.
const TEXT_MATCH_PROBE = 100;
function textProbe(value) {
  const normalized = looseMessageText(value);
  return normalized.length > TEXT_MATCH_PROBE ? normalized.slice(0, TEXT_MATCH_PROBE) : normalized;
}

// For comparing what WE typed with what the page shows back. WhatsApp's composer renders each line as its own
// block, so a long caption with blank lines between sections comes back with a different number of newlines
// than it went in with — an exact match then fails even though every word is there (composer_content_mismatch
// on the operator's caption, 2026-10-07). Collapsing whitespace keeps the words and their order as the test.
function looseMessageText(value) {
  return normalizeMessageText(value).replace(/\s+/gu, ' ');
}

export function matchesCaptionOrText(rowText, expectedText) {
  if (!expectedText) return true;
  const looseRow = looseMessageText(rowText || '');
  const looseExpected = looseMessageText(expectedText);
  if (!looseRow) return false;
  if (looseRow.includes(looseExpected) || looseExpected.includes(looseRow)) return true;

  const alphaRow = looseRow.replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase();
  const alphaExpected = looseExpected.replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase();
  if (alphaExpected && (alphaRow.includes(alphaExpected) || alphaExpected.includes(alphaRow))) return true;

  const probe = alphaExpected.slice(0, 40);
  if (probe && alphaRow.includes(probe)) return true;

  const expectedWords = alphaExpected.split(/\s+/).filter((w) => w.length >= 3);
  if (expectedWords.length > 0) {
    const matchedCount = expectedWords.slice(0, 6).filter((w) => alphaRow.includes(w)).length;
    if (matchedCount >= Math.min(2, expectedWords.length)) return true;
  }
  return false;
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

/** Клієнт вкладки WhatsApp Web: у фоні, без фокусу, без звуку (див. cdp-background.mjs). */
async function createWhatsappPageClient(page) {
  const client = await createCdpClient(page.webSocketDebuggerUrl);
  try { await enterBackgroundMode(client); } catch (error) { client.close(); throw error; }
  return client;
}

export async function createCdpClient(url) {
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
    if (message.method === 'Page.javascriptDialogOpening') {
      try {
        socket.send(JSON.stringify({
          id: ++nextId,
          method: 'Page.handleJavaScriptDialog',
          params: { accept: true },
        }));
      } catch {}
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
