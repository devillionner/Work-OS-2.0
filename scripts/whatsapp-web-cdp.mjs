// Real WhatsApp invite resolution can exceed 20s before the factual join/retry modal appears.
const DEFAULT_TIMEOUT_MS = 45_000;
// WhatsApp autopost lease is 90 s (lib/messenger-automation.ts). Target verification and
// payload preparation share one 45 s budget and confirmation gets at most 30 s, so a send can
// never happen or be confirmed after the lease has passed to another claim.
const AUTOPOST_SEND_CONFIRM_MS = 30_000;
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
const SEND_CONTROL_JS = `(() => {
  const visible=(node)=>{const r=node.getBoundingClientRect();return r.width>0&&r.height>0;};
  return [...document.querySelectorAll('button, [role="button"]')].filter(visible).find((node)=>{
    const label=String(node.getAttribute('aria-label')||node.getAttribute('title')||node.textContent||'').trim();
    // Substring, not an exact label: WhatsApp renames these controls between builds (wds-ic-send-filled and
    // «Надіслати (Enter)» both have to count as the send control).
    return /\\b(send|надісла|відправ|отправ)/i.test(label)||Boolean(node.querySelector('[data-icon*="send"], [data-testid*="send"]'));
  })||null;
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
  const expected=normalizeMessageText(expectedText);
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){
    const expression=`(() => {
      const node=${CAPTION_NODE_JS};
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
      return /\\b(send|надісла|відправ|отправ)/i.test(label)||Boolean(node.querySelector('[data-icon*="send"], [data-testid*="send"]'));
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
    const inspectTask = {
      runtime:'whatsapp_web', platform:'whatsapp', action:'inspect',
      name:task.target.expectedName,
      link:task.target.expectedLink,
      expectedTarget:{name:task.target.expectedName,link:task.target.expectedLink},
    };
    const navigatedInviteCode = whatsappInviteCode(task.target?.expectedLink);
    const operationDeadline = Date.now() + timeoutMs;
    const remainingBudget = () => Math.max(POLL_MS, operationDeadline - Date.now());
    const confirmWindowMs = Math.min(timeoutMs, AUTOPOST_SEND_CONFIRM_MS);
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
      return { kind:'blocked', reason:classified.reason || 'joined_target_not_verified' };
    }
    const observedTarget = classified.result.observedName || task.target.expectedName;
    const before = await readSnapshot(client);
    if (!before.composer) return { kind:'blocked', reason:before.adminOnly ? 'admin_only' : 'read_only' };
    const beforeKeys = new Set((before.messageRows || []).map((row) => row.key).filter(Boolean));
    const media=task.material?.media;
    if(media?.base64){
      if(!/^image\/(jpeg|png|webp)$/u.test(String(media.contentType||'')))return {kind:'blocked',reason:'unsupported_media_type'};
      await markWhatsappEditorsBeforeMedia(client);
      if(!await injectWhatsappImage(client,media))return {kind:'blocked',reason:'media_attach_failed'};
      if(!await waitForWhatsappMediaPreview(client,Math.min(remainingBudget(),AUTOPOST_MEDIA_PREVIEW_MS))){
        const diagnostic=await readWhatsappMediaPreviewDiagnostic(client);
        if(diagnostic)console.warn('WhatsApp autopost media preview diagnostic: '+diagnostic);
        return {kind:'blocked',reason:'media_preview_not_ready'};
      }
      if(!await openWhatsappMediaCaption(client,Math.min(remainingBudget(),8_000))
        ||!await focusAndClearWhatsappMediaCaption(client)){
        const diagnostic=await readWhatsappMediaPreviewDiagnostic(client);
        if(diagnostic)console.warn('WhatsApp autopost caption diagnostic: '+diagnostic);
        return {kind:'blocked',reason:'media_caption_not_found'};
      }
      await client.send('Input.insertText',{text});
      if(!await waitForWhatsappMediaCaption(client,text,Math.min(remainingBudget(),5_000)))return {kind:'blocked',reason:'media_caption_mismatch'};
      if(Date.now()>=operationDeadline)return {kind:'blocked',reason:'autopost_budget_exhausted'};
      if(!await clickWhatsappMediaSend(client))return {kind:'blocked',reason:'media_send_control_not_found'};
      const expected=normalizeMessageText(text);
      const deadline=Date.now()+confirmWindowMs;
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
    const prepared = await waitForComposerText(client, text, Math.min(remainingBudget(), 5_000));
    if (!prepared) return { kind:'blocked', reason:'composer_content_mismatch' };
    if (Date.now() >= operationDeadline) return { kind:'blocked', reason:'autopost_budget_exhausted' };

    await client.send('Input.dispatchKeyEvent', { type:'keyDown', key:'Enter', code:'Enter', windowsVirtualKeyCode:13, nativeVirtualKeyCode:13 });
    await client.send('Input.dispatchKeyEvent', { type:'keyUp', key:'Enter', code:'Enter', windowsVirtualKeyCode:13, nativeVirtualKeyCode:13 });

    const expected = normalizeMessageText(text);
    const deadline = Date.now() + confirmWindowMs;
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
  const client = await createCdpClient(page.webSocketDebuggerUrl);
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
