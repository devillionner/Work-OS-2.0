import { cleanChatName, normalizeGroupLink, suggestedChatName } from '../chats/bulk-input.ts';
import {
  DiscoveryError,
  evaluateDiscoveryCandidate,
  handoffDiscoveryCandidate,
  inferDiscoveryTopicMatch,
  type DiscoveryCandidate,
  type DiscoveryDecision,
} from './domain.ts';
import { applyDiscoveryInspection } from './inspection.ts';
import {
  buildPublicSearchTasks,
  buildTelegramSearchPlan,
  discoverPublicWeb,
  discoverTelegramPublic,
  extractInviteRecords,
  type DiscoveryPlatform,
  type DiscoveryRecord,
  type DiscoverySource,
  type DiscoverySourceKind,
} from './public-web.ts';

type FetchLike=(input:string,init?:RequestInit)=>Promise<Response>;
type KnownRow={platform:string;normalized_link:string};
type CandidateState={id:string;version:number;imported_chat_id:string|null;decision:string};
const SOURCE_KINDS=new Set<DiscoverySourceKind>(['public_web','curated','manual','telegram_global']);

export type LocalDiscoveryPreview=DiscoveryCandidate&{
  localOnly:true;
  preflightState?:'queued'|'review'|'target'|'rejected'|'skipped'|'unavailable';
  preflightReasonCodes?:string[];
  leftAfterCheck?:boolean;
  leaveReason?:string|null;
  groupId?:string;
};

export async function searchLocalDiscoveryPreview(
  db:D1Database,
  userId:string,
  input:{platforms?:unknown;telegramCursor?:unknown;sourceCursor?:unknown;knownLinks?:unknown;minMembers?:unknown},
  now:number,
  fetcher:FetchLike=fetch,
) {
  const platforms=cleanPlatforms(input.platforms);
  const telegramCursor=boundedInteger(input.telegramCursor,0,1_000_000,0);
  const sourceCursor=boundedInteger(input.sourceCursor,0,1_000_000,0);
  const minMembers=boundedInteger(input.minMembers,700,18_000,700);
  const knownLinks=cleanKnownLinks(input.knownLinks);

  const batchSize=1;
  const telegramPlan=buildTelegramSearchPlan(telegramCursor,batchSize);
  const totalPublicTasks=buildPublicSearchTasks(platforms).length;
  const telegramDone=telegramPlan.done;
  const publicDone=sourceCursor>=totalPublicTasks;
  if(telegramDone&&publicDone){
    return {source:'idle' as const,telegramCursor,sourceCursor,done:true,previews:[],batch:{searched:0,added:0,duplicates:0,errors:0}};
  }

  const completedBatches=Math.floor(telegramCursor/batchSize)+Math.floor(sourceCursor/batchSize);
  const usePublic=!publicDone&&(telegramDone||completedBatches%3===2);
  if(!usePublic&&!telegramDone){
    const found=await discoverTelegramPublic({cursor:telegramCursor,maxQueries:batchSize,pageLimit:1},fetcher);
    const preview=await prepareLocalPreviews(db,userId,found.records,{knownLinks,minMembers,now});
    return {
      source:'telegram' as const,
      telegramCursor:found.nextCursor,
      sourceCursor,
      done:false,
      previews:preview.previews,
      batch:{searched:found.searched,added:preview.previews.length,duplicates:preview.duplicates,errors:found.errors},
    };
  }

  const found=await discoverPublicWeb({platforms,cursor:sourceCursor,maxQueries:batchSize,pageLimit:1,includeCurated:false},fetcher);
  const preview=await prepareLocalPreviews(db,userId,found.records,{knownLinks,minMembers,now});
  return {
    source:'public_web' as const,
    telegramCursor,
    sourceCursor:found.nextCursor,
    done:telegramDone&&found.done,
    previews:preview.previews,
    batch:{searched:found.searched,added:preview.previews.length,duplicates:preview.duplicates,errors:found.errors},
  };
}

export async function previewTelegramDiscoveryText(
  db:D1Database,
  userId:string,
  input:{text?:unknown;sourceUrl?:unknown;sourceTitle?:unknown;query?:unknown;seedLabel?:unknown;context?:unknown;knownLinks?:unknown;minMembers?:unknown},
  now:number,
){
  const text=boundedText(input.text,48_000);
  if(!text)throw new DiscoveryError('Telegram-скан порожній.');
  const sourceUrl=boundedText(input.sourceUrl,1000);
  const sourceTitle=boundedText(input.sourceTitle,180);
  const query=boundedText(input.query,500);
  const seedLabel=boundedText(input.seedLabel,180)||sourceTitle||query||'Telegram';
  const context=boundedText(input.context,700);
  const normalized=text.replaceAll('\\/','/');
  const containsInvite=/(?:https?:\/\/)?chat\.whatsapp\.com\//iu.test(normalized);
  if(containsInvite&&(!sourceTitle||!isTelegramUrl(sourceUrl))){
    throw new DiscoveryError('Для Telegram-скану з WhatsApp invite потрібні назва чату та коректне посилання на Telegram-джерело.');
  }
  const records=containsInvite?extractInviteRecords(normalized,['whatsapp'],{
    kind:'telegram_global',sourceUrl,sourceTitle,query,seedLabel,seedKind:'telegram_chat',context,
  }):[];
  const preview=await prepareLocalPreviews(db,userId,records,{
    knownLinks:cleanKnownLinks(input.knownLinks),
    minMembers:boundedInteger(input.minMembers,700,18_000,700),
    now,
  });
  return {previews:preview.previews,batch:{extracted:records.length,added:preview.previews.length,duplicates:preview.duplicates}};
}

export async function persistLocalDiscoveryOutcome(
  db:D1Database,
  userId:string,
  input:{platform?:unknown;link?:unknown;name?:unknown;sources?:unknown;minMembers?:unknown;outcome?:unknown},
  now:number,
){
  const platform=input.platform==='whatsapp'||input.platform==='viber'?input.platform:null;
  const rawLink=typeof input.link==='string'?input.link.trim():'';
  const parsed=normalizeGroupLink(rawLink);
  if(!platform||!parsed||parsed.platform!==platform||!['whatsapp','viber'].includes(parsed.platform)){
    throw new DiscoveryError('Некоректний локальний outcome.');
  }
  if(!input.outcome||typeof input.outcome!=='object'||Array.isArray(input.outcome)){
    throw new DiscoveryError('Результат локальної перевірки не вказаний.');
  }
  const outcome=input.outcome as Record<string,unknown>;
  const localDecision=String(outcome.decision||'');
  if(!['review','target','rejected','skipped','unavailable'].includes(localDecision)){
    throw new DiscoveryError('Некоректний локальний статус перевірки.');
  }
  const rawResult=outcome.result&&typeof outcome.result==='object'&&!Array.isArray(outcome.result)
    ? outcome.result as Record<string,unknown>:{};
  const reasonCodes=Array.isArray(outcome.reasonCodes)
    ? [...new Set(outcome.reasonCodes.filter((item):item is string=>typeof item==='string'&&item.trim()!=='').map(item=>item.trim().slice(0,100)))].slice(0,20)
    : [];
  const minMembers=boundedInteger(input.minMembers,700,18_000,700);
  const count=rawResult.memberCount===null||rawResult.memberCount===undefined?NaN:Number(rawResult.memberCount);
  const memberCount=Number.isSafeInteger(count)&&count>=0?count:null;
  const chatType=['group','community','channel','contact','bot'].includes(String(rawResult.chatType))
    ? rawResult.chatType as DiscoveryCandidate['chatType']:'unknown';
  const activityState=rawResult.activityState==='active'?'active':rawResult.activityState==='dead'?'dead':'unknown';
  const topicMatch=rawResult.topicMatch==='match'?'match':rawResult.topicMatch==='mismatch'?'mismatch':'unknown';
  const canWrite=typeof rawResult.canWrite==='boolean'?rawResult.canWrite:null;
  const adsPolicy=['allowed','inferred_allowed','operator_confirmed','forbidden'].includes(String(rawResult.adsPolicy))
    ? rawResult.adsPolicy as DiscoveryCandidate['adsPolicy']:'unknown';
  const membershipState:DiscoveryCandidate['membershipState']=outcome.leftAfterCheck===true
    ?'left'
    :['joined','pending','left','not_checked'].includes(String(rawResult.membershipState))
      ?rawResult.membershipState as DiscoveryCandidate['membershipState']:'not_checked';
  const accessible=typeof rawResult.accessible==='boolean'?rawResult.accessible:null;
  const targetVerified=rawResult.targetVerified===true;
  const status=String(rawResult.status||'');
  const rawReason=String(rawResult.reason||'');
  const invalid=reasonCodes.some(code=>/(?:invalid|expired|missing|gone)/iu.test(code))
    ||/(?:invalid|expired|not-found|gone|missing)/iu.test(rawReason);
  const accessState:DiscoveryCandidate['accessState']=accessible===true?'available':accessible===false?'unavailable':'unknown';
  const linkState:DiscoveryCandidate['linkState']=invalid?'invalid':'valid';
  const inspectionState:DiscoveryCandidate['inspectionState']=status==='inspected'||status==='manual_review'?'inspected'
    :status==='failed'||localDecision==='unavailable'?'failed'
    :localDecision==='target'?'inspected':'not_checked';

  let decision:DiscoveryDecision=localDecision==='review'?'review':localDecision==='unavailable'?'unavailable':'rejected';
  let finalReasons=reasonCodes.length?reasonCodes:[
    localDecision==='review'?'fresh_join_history_unavailable'
      :localDecision==='skipped'?'skipped_by_automation':'automation_rejected'
  ];
  if(localDecision==='review'){
    const safeManualReview=targetVerified
      &&membershipState==='joined'
      &&accessible===true
      &&linkState==='valid'
      &&chatType==='group'
      &&memberCount!==null&&memberCount>=minMembers&&memberCount<=18_000
      &&canWrite===true
      &&topicMatch!=='mismatch';
    if(!safeManualReview||!reasonCodes.includes('fresh_join_history_unavailable')){
      throw new DiscoveryError('Ручна перевірка дозволена лише для щойно приєднаного чату без видимої історії.',409);
    }
    decision='review';
  }else if(localDecision==='target'){
    const evaluated=evaluateDiscoveryCandidate({
      chatType,memberCount,topicMatch,canWrite,adsPolicy,activityState,membershipState,
      inspectionState,accessState,linkState,
    },minMembers);
    if(!targetVerified||evaluated.decision!=='target'){
      throw new DiscoveryError('Автопошук може зберегти target лише після повної фактичної перевірки.',409);
    }
    decision='target';
    finalReasons=evaluated.reasonCodes;
  }else if(localDecision==='unavailable'||accessState==='unavailable'||linkState==='invalid'){
    decision='unavailable';
  }

  const sources=cleanSources(input.sources);
  const observedName=cleanChatName(typeof rawResult.observedName==='string'?rawResult.observedName:'');
  const name=observedName||cleanChatName(typeof input.name==='string'?input.name:'')||suggestedChatName(parsed);
  const candidateId=await stableId('candidate',`${userId}:${platform}:${parsed.link}`);
  await db.prepare(`INSERT INTO chat_discovery_candidates
    (id,user_id,platform,name,link,normalized_link,discovered_at,checked_at,member_count,chat_type,activity_state,topic_match,
     can_write,ads_policy,membership_state,access_state,link_state,inspection_state,decision,reason_codes_json,
     imported_chat_id,discovery_run_id,created_at,updated_at,version)
    VALUES (?1,?2,?3,?4,?5,?5,?6,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,NULL,NULL,?6,?6,1)
    ON CONFLICT(user_id,platform,normalized_link) DO UPDATE SET
      name=CASE WHEN excluded.name<>'' THEN excluded.name ELSE chat_discovery_candidates.name END,
      checked_at=excluded.checked_at,
      member_count=excluded.member_count,
      chat_type=excluded.chat_type,
      activity_state=excluded.activity_state,
      topic_match=excluded.topic_match,
      can_write=excluded.can_write,
      ads_policy=excluded.ads_policy,
      membership_state=excluded.membership_state,
      access_state=excluded.access_state,
      link_state=excluded.link_state,
      inspection_state=excluded.inspection_state,
      decision=excluded.decision,
      reason_codes_json=excluded.reason_codes_json,
      updated_at=excluded.updated_at,
      version=chat_discovery_candidates.version+1`)
    .bind(candidateId,userId,platform,name,parsed.link,now,memberCount,chatType,activityState,topicMatch,
      canWrite===null?null:Number(canWrite),adsPolicy,membershipState,accessState,linkState,inspectionState,decision,JSON.stringify(finalReasons))
    .run();

  if(sources.length){
    const statements:D1PreparedStatement[]=[];
    for(const source of sources.slice(0,8)){
      const identity=sourceIdentity(source);
      const sourceId=await stableId('source',`${candidateId}:${identity}`);
      statements.push(db.prepare(`INSERT INTO chat_discovery_sources
        (id,candidate_id,user_id,source_key,source_kind,source_url,source_title,query_text,seed_label,seed_kind,context,discovered_at)
        VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
        ON CONFLICT(candidate_id,source_key) DO NOTHING`)
        .bind(sourceId,candidateId,userId,identity,source.kind,source.sourceUrl,source.sourceTitle,source.query,source.seedLabel,source.seedKind,source.context,now));
    }
    await db.batch(statements);
  }
  const stored=await db.prepare(`SELECT id,decision,version,imported_chat_id FROM chat_discovery_candidates
    WHERE user_id=?1 AND platform=?2 AND normalized_link=?3 LIMIT 1`)
    .bind(userId,platform,parsed.link)
    .first<{id:string;decision:DiscoveryDecision;version:number;imported_chat_id:string|null}>();
  if(!stored)throw new DiscoveryError('Не вдалося зберегти результат автопошуку.',500);
  return {persisted:true,candidateId:stored.id,decision:stored.decision,version:Number(stored.version),importedChatId:stored.imported_chat_id};
}

export async function confirmLocalDiscoveryPreview(
  db:D1Database,
  userId:string,
  input:{platform?:unknown;link?:unknown;name?:unknown;sources?:unknown;minMembers?:unknown;runId?:unknown;preflight?:unknown},
  now:number,
){
  const platform=input.platform==='whatsapp'||input.platform==='viber'?input.platform:null;
  const rawLink=typeof input.link==='string'?input.link.trim():'';
  const parsed=normalizeGroupLink(rawLink);
  if(!platform||!parsed||parsed.platform!==platform||!['whatsapp','viber'].includes(parsed.platform)){
    throw new DiscoveryError('Некоректний локальний кандидат.');
  }
  const requestedRunId=typeof input.runId==='string'?input.runId.trim():'';
  const activeRun=requestedRunId
    ? await db.prepare(`SELECT id,min_members FROM chat_discovery_runs WHERE id=?1 AND user_id=?2 AND status='running' LIMIT 1`)
      .bind(requestedRunId,userId).first<{id:string;min_members:number}>()
    : null;
  if(requestedRunId&&!activeRun)throw new DiscoveryError('Автопошук уже завершився або змінився. Запусти його ще раз.',409);
  const runId=activeRun?.id||null;
  const existingChat=await db.prepare(`SELECT id,workflow_status FROM chats
    WHERE user_id=?1 AND platform=?2 AND normalized_link=?3 LIMIT 1`)
    .bind(userId,platform,parsed.link).first<{id:string;workflow_status:string}>();
  if(existingChat)return {chatId:existingChat.id,existing:true,workflowStatus:existingChat.workflow_status};

  const existingCandidate=await db.prepare(`SELECT id,version,imported_chat_id,decision FROM chat_discovery_candidates
    WHERE user_id=?1 AND platform=?2 AND normalized_link=?3 LIMIT 1`)
    .bind(userId,platform,parsed.link).first<CandidateState>();
  if(existingCandidate){
    if(existingCandidate.imported_chat_id){
      const chat=await db.prepare('SELECT id,workflow_status FROM chats WHERE id=?1 AND user_id=?2 LIMIT 1')
        .bind(existingCandidate.imported_chat_id,userId).first<{id:string;workflow_status:string}>();
      if(chat)return {chatId:chat.id,existing:true,workflowStatus:chat.workflow_status};
    }
    if(existingCandidate.decision==='rejected'||existingCandidate.decision==='unavailable'){
      throw new DiscoveryError('Цей чат уже був відхилений або позначений недоступним. Перегляньте його історію перед повторним додаванням.',409);
    }
    if(runId){
      const attached=await db.prepare(`UPDATE chat_discovery_candidates
        SET discovery_run_id=?1,updated_at=?2,version=version+1
        WHERE id=?3 AND user_id=?4 AND imported_chat_id IS NULL AND decision IN ('review','target')
        RETURNING version`).bind(runId,now,existingCandidate.id,userId).first<{version:number}>();
      if(attached)existingCandidate.version=Number(attached.version);
    }
    return handoffConfirmedLocalCandidate(db,userId,existingCandidate.id,Number(existingCandidate.version),now,input.preflight,activeRun?.min_members??boundedInteger(input.minMembers,700,18_000,700));
  }

  const sources=cleanSources(input.sources);
  const name=cleanChatName(typeof input.name==='string'?input.name:'')||suggestedChatName(parsed);
  const topicMatch='match' as const;
  const minMembers=boundedInteger(input.minMembers,700,18_000,700);
  const evaluated=evaluateDiscoveryCandidate({
    chatType:'unknown',memberCount:null,topicMatch,canWrite:null,adsPolicy:'unknown',
    activityState:'unknown',membershipState:'not_checked',inspectionState:'not_checked',
    accessState:'unknown',linkState:'valid',
  },minMembers);
  const candidateId=await stableId('candidate',`${userId}:${platform}:${parsed.link}`);
  const statements:D1PreparedStatement[]=[
    db.prepare(`INSERT INTO chat_discovery_candidates
      (id,user_id,platform,name,link,normalized_link,discovered_at,checked_at,member_count,chat_type,activity_state,topic_match,
       can_write,ads_policy,membership_state,access_state,link_state,inspection_state,decision,reason_codes_json,
       imported_chat_id,discovery_run_id,created_at,updated_at,version)
      VALUES (?1,?2,?3,?4,?5,?5,?6,NULL,NULL,'unknown','unknown','match',NULL,'unknown','not_checked','unknown','valid',
        'not_checked',?7,?8,NULL,?9,?6,?6,1)
      ON CONFLICT(user_id,platform,normalized_link) DO NOTHING`)
      .bind(candidateId,userId,platform,name,parsed.link,now,evaluated.decision,JSON.stringify(evaluated.reasonCodes),runId),
  ];
  for(const source of sources.slice(0,8)){
    const identity=sourceIdentity(source);
    const sourceId=await stableId('source',`${candidateId}:${identity}`);
    statements.push(db.prepare(`INSERT INTO chat_discovery_sources
      (id,candidate_id,user_id,source_key,source_kind,source_url,source_title,query_text,seed_label,seed_kind,context,discovered_at)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
      ON CONFLICT(candidate_id,source_key) DO NOTHING`)
      .bind(sourceId,candidateId,userId,identity,source.kind,source.sourceUrl,source.sourceTitle,source.query,source.seedLabel,source.seedKind,source.context,now));
  }
  await db.batch(statements);
  const candidate=await db.prepare(`SELECT id,version,imported_chat_id,decision FROM chat_discovery_candidates
    WHERE user_id=?1 AND platform=?2 AND normalized_link=?3 LIMIT 1`)
    .bind(userId,platform,parsed.link).first<CandidateState>();
  if(!candidate)throw new DiscoveryError('Не вдалося зберегти підтверджений чат.',500);
  if(candidate.imported_chat_id){
    const chat=await db.prepare('SELECT id,workflow_status FROM chats WHERE id=?1 AND user_id=?2 LIMIT 1')
      .bind(candidate.imported_chat_id,userId).first<{id:string;workflow_status:string}>();
    if(chat)return {chatId:chat.id,existing:true,workflowStatus:chat.workflow_status};
  }
  return handoffConfirmedLocalCandidate(db,userId,candidate.id,Number(candidate.version),now,input.preflight,minMembers);
}

async function handoffConfirmedLocalCandidate(
  db:D1Database,userId:string,candidateId:string,expectedVersion:number,now:number,preflightInput:unknown,minMembers:number,
){
  const preflight=validateTargetPreflight(preflightInput,minMembers);
  const handed=await handoffDiscoveryCandidate(db,userId,candidateId,expectedVersion,now);
  if(!preflight)return handed;
  const current=await db.prepare('SELECT version FROM chat_discovery_candidates WHERE id=?1 AND user_id=?2 LIMIT 1')
    .bind(candidateId,userId).first<{version:number}>();
  if(!current)throw new DiscoveryError('Підтверджений кандидат зник перед збереженням preflight.',409);
  const outcome=await applyDiscoveryInspection(db,userId,{
    candidateId,
    expectedVersion:Number(current.version),
    result:preflight,
    minMembers,
    requireTargetVerification:true,
  },now);
  if(outcome.decision!=='target'){
    throw new DiscoveryError('Preflight більше не підтверджує всі цільові критерії. Чат не зараховано.',409);
  }
  return {...handed,workflowStatus:outcome.workflowStatus,decision:outcome.decision};
}

function validateTargetPreflight(value:unknown,minMembers:number){
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const raw=value as Record<string,unknown>;
  const memberCount=Number(raw.memberCount);
  const result={
    status:'inspected',
    accessible:raw.accessible===true,
    targetVerified:raw.targetVerified===true,
    membershipState:raw.membershipState==='joined'?'joined' as const:'not_checked' as const,
    observedName:typeof raw.observedName==='string'?cleanChatName(raw.observedName):'',
    chatType:raw.chatType==='community'?'community' as const:raw.chatType==='group'?'group' as const:'unknown' as const,
    memberCount:Number.isSafeInteger(memberCount)?memberCount:null,
    topicMatch:raw.topicMatch==='match'?'match' as const:raw.topicMatch==='mismatch'?'mismatch' as const:'unknown' as const,
    canWrite:typeof raw.canWrite==='boolean'?raw.canWrite:null,
    adsPolicy:['allowed','operator_confirmed','inferred_allowed','forbidden'].includes(String(raw.adsPolicy))
      ? String(raw.adsPolicy) as DiscoveryCandidate['adsPolicy']:'unknown',
    activityState:raw.activityState==='active'?'active' as const:raw.activityState==='dead'?'dead' as const:'unknown' as const,
  };
  const evaluated=evaluateDiscoveryCandidate({
    chatType:result.chatType,
    memberCount:result.memberCount,
    topicMatch:result.topicMatch,
    canWrite:result.canWrite,
    adsPolicy:result.adsPolicy,
    activityState:result.activityState,
    membershipState:result.membershipState,
    inspectionState:'inspected',
    accessState:result.accessible?'available':'unavailable',
    linkState:result.accessible?'valid':'invalid',
  },minMembers);
  if(result.targetVerified!==true||evaluated.decision!=='target'){
    throw new DiscoveryError('До D1 можна підтвердити лише фактично перевірений цільовий чат.',409);
  }
  return result;
}

async function prepareLocalPreviews(
  db:D1Database,
  userId:string,
  records:DiscoveryRecord[],
  input:{knownLinks:Set<string>;minMembers:number;now:number},
):Promise<{previews:LocalDiscoveryPreview[];duplicates:number}>{
  const canonical=new Map<string,{platform:DiscoveryPlatform;link:string;name:string;sources:DiscoverySource[]}>();
  let duplicates=0;
  for(const record of records){
    const parsed=normalizeGroupLink(record.link);
    if(!parsed||(parsed.platform!=='whatsapp'&&parsed.platform!=='viber'))continue;
    const key=`${parsed.platform}|${parsed.link}`;
    if(input.knownLinks.has(key)){duplicates++;continue;}
    const current=canonical.get(key)||{platform:parsed.platform,link:parsed.link,name:'',sources:[]};
    const hint=safeDiscoveryNameHint(record.nameHint||'');
    if(!current.name&&hint)current.name=hint;
    const identity=sourceIdentity(record.source);
    if(!current.sources.some(source=>sourceIdentity(source)===identity))current.sources.push(record.source);
    canonical.set(key,current);
  }
  if(!canonical.size)return {previews:[],duplicates};
  const links=[...canonical.values()].map(item=>item.link);
  const [chatResult,candidateResult]=await db.batch([
    db.prepare(`SELECT platform,normalized_link FROM chats WHERE user_id=?1
      AND normalized_link IN (SELECT value FROM json_each(?2))`).bind(userId,JSON.stringify(links)),
    db.prepare(`SELECT platform,normalized_link FROM chat_discovery_candidates WHERE user_id=?1
      AND normalized_link IN (SELECT value FROM json_each(?2))`).bind(userId,JSON.stringify(links)),
  ]);
  const known=new Set<string>();
  for(const row of [...chatResult.results,...candidateResult.results] as KnownRow[])known.add(`${row.platform}|${row.normalized_link}`);

  const previews:LocalDiscoveryPreview[]=[];
  for(const item of canonical.values()){
    const key=`${item.platform}|${item.link}`;
    if(known.has(key)){duplicates++;continue;}
    const sourceName=item.sources.map(source=>safeDiscoveryNameHint(source.sourceTitle||source.seedLabel||'')).find(Boolean)||'';
    const name=preferLocalPreviewName(item.name,sourceName)||suggestedChatName(normalizeGroupLink(item.link)!);
    const topicMatch=inferLocalPreviewTopicMatch(name,item.sources);
    const evaluated=evaluateDiscoveryCandidate({
      chatType:'unknown',memberCount:null,topicMatch,canWrite:null,adsPolicy:'unknown',activityState:'unknown',
      membershipState:'not_checked',inspectionState:'not_checked',accessState:'unknown',linkState:'valid',
    },input.minMembers);
    previews.push({
      id:await stableId('preview',`${userId}:${key}`),platform:item.platform,name,link:item.link,
      discoveredAt:input.now,checkedAt:null,memberCount:null,chatType:'unknown',activityState:'unknown',
      topicMatch,canWrite:null,adsPolicy:'unknown',membershipState:'not_checked',accessState:'unknown',
      linkState:'valid',inspectionState:'not_checked',decision:evaluated.decision,reasonCodes:evaluated.reasonCodes,
      importedChatId:null,updatedAt:input.now,version:0,sources:item.sources.slice(0,8),localOnly:true,
    });
  }
  return {previews,duplicates};
}

export function inferLocalPreviewTopicMatch(name:string,sources:DiscoverySource[]):DiscoveryCandidate['topicMatch']{
  const sanitized=sources.map(source=>({
    ...source,
    context:stripSourceQueryContext(source),
  }));
  return inferDiscoveryTopicMatch(name,sanitized);
}

function stripSourceQueryContext(source:DiscoverySource){
  let context=String(source.context||'');
  for(const value of [source.query,source.seedLabel,source.seedKind,'Telegram']){
    const token=String(value||'').trim();
    if(token)context=context.split(token).join(' ');
  }
  return context.replace(/\s+/g,' ').trim();
}

function preferLocalPreviewName(hint:string,sourceName:string){
  const value=safeDiscoveryNameHint(hint);
  if(value&&value.length>=6&&!/^(?:e|ngen|ch|p|rселона|о |нка |ерия )/iu.test(value))return value;
  return safeDiscoveryNameHint(sourceName);
}

function safeDiscoveryNameHint(value:string){
  const cleaned=cleanChatName(value);
  if(!cleaned)return '';
  if(/<\/?[a-z][^>]*>|(?:src|href|class|id)\s*=\s*["']|https?:\/\/|chat\.whatsapp\.com/iu.test(cleaned))return '';
  if(/(?:notion-|svelte|data-testid|aria-label)/iu.test(cleaned))return '';
  return /\p{L}/u.test(cleaned)?cleaned:'';
}

function cleanPlatforms(value:unknown):DiscoveryPlatform[]{
  const values=Array.isArray(value)?value:[];
  const result=[...new Set(values.filter((item):item is DiscoveryPlatform=>item==='whatsapp'||item==='viber'))];
  return result.length?result:['whatsapp'];
}
function cleanKnownLinks(value:unknown):Set<string>{
  const result=new Set<string>();
  if(!Array.isArray(value))return result;
  for(const item of value.slice(0,250)){
    if(typeof item!=='string')continue;
    const parsed=normalizeGroupLink(item);
    if(parsed&&(parsed.platform==='whatsapp'||parsed.platform==='viber'))result.add(`${parsed.platform}|${parsed.link}`);
  }
  return result;
}
function cleanSources(value:unknown):DiscoverySource[]{
  if(!Array.isArray(value))return [];
  const result:DiscoverySource[]=[];
  for(const raw of value.slice(0,8)){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))continue;
    const item=raw as Record<string,unknown>;
    const kind=typeof item.kind==='string'&&SOURCE_KINDS.has(item.kind as DiscoverySourceKind)?item.kind as DiscoverySourceKind:'manual';
    result.push({
      kind,
      sourceUrl:boundedText(item.sourceUrl,1000),
      sourceTitle:boundedText(item.sourceTitle,180),
      query:boundedText(item.query,500),
      seedLabel:boundedText(item.seedLabel,180),
      seedKind:boundedText(item.seedKind,80),
      context:boundedText(item.context,700),
    });
  }
  return result;
}
function sourceIdentity(source:DiscoverySource){
  return [source.kind,source.sourceUrl,source.query,source.seedLabel,source.seedKind].join('|').slice(0,1800);
}
function boundedText(value:unknown,max:number){return typeof value==='string'?value.trim().slice(0,max):'';}
function boundedInteger(value:unknown,min:number,max:number,fallback:number){
  const number=Number(value);return Number.isSafeInteger(number)&&number>=min&&number<=max?number:fallback;
}
function isTelegramUrl(value:string){
  try{const url=new URL(value);return url.protocol==='https:'&&['t.me','telegram.me','telegram.dog'].includes(url.hostname.toLowerCase().replace(/^www\./,''));}
  catch{return false;}
}
async function stableId(prefix:string,value:string){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  const hex=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
  return `${prefix}-${hex.slice(0,32)}`;
}
