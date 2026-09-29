import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
const execFile = promisify(execFileCallback);
const SEARCH_URL = 'https://search.brave.com/search';
const TELEGRAM_DIRECTORY_URL = 'https://tg.me/search';
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
const BOOTSTRAP_SOURCES = [
  ['Українці · Швейцарія','https://t.me/s/UkrainianSwitzerland?q=WhatsApp','Швейцарія'],
  ['UA-DE HELP · Німеччина','https://t.me/s/ua_de_help?q=WhatsApp','Німеччина'],
  ['Українці · Нідерланди','https://t.me/s/ukrainians_nl?q=WhatsApp','Нідерланди'],
  ['ДП Документ · Прага','https://t.me/s/prahaPD?q=WhatsApp','Прага'],
  ['Ukrainians Abroad','https://t.me/s/uaabroad?q=WhatsApp','Європа'],
  ['Українці · Карінтія','https://t.me/s/ukrainer_in_kaernten?q=WhatsApp','Карінтія'],
  ['Український Дім · Роттердам','https://t.me/s/ukrdam?q=WhatsApp','Роттердам'],
  ['Українці · Куопіо','https://t.me/s/kuopio_ua?q=WhatsApp','Куопіо'],
  ['Українці · Швельм','https://t.me/s/UA_Schwelm?q=WhatsApp','Швельм'],
  ['Українці · Австрія','https://t.me/s/Shelter_in_Austria?q=WhatsApp','Австрія'],
  ['Українці · Словаччина','https://t.me/s/ukrajincivsk?q=WhatsApp','Словаччина'],
  ['Українці · Бремен','https://t.me/s/ukrainebremen?q=WhatsApp','Бремен'],
  ['Українці · Торонто','https://t.me/s/new_life_in_canada?q=WhatsApp','Торонто'],
  ['Українці · Waterloo','https://t.me/s/razom_waterloo?q=WhatsApp','Waterloo'],
  ['Українці · Лондон','https://t.me/s/ukrainianlondon?q=WhatsApp','Лондон'],
];
const pageCache = new Map();
const UA = /(?:україн|украин|ukrain|ukraiń|ukrajin|ucrain|ucran|oekra|🇺🇦)/iu;
const SPAM = /(?:crypto|bitcoin|forex|casino|казино|betting|dating|escort|onlyfans|nft|airdrop|signals?\b|قروبات|روابط\s+مجموعات|مجموعات\s+واتساب|technical\s+support)/iu;
const MAX_TELEGRAM_HISTORY_PAGES=2;
const MAX_SEARCH_SOURCES=5;
const MAX_DIRECTORY_RESULTS=6;
const MAX_GRAPH_SOURCES_PER_STEP=2;
const SEARCH_BLOCK_COOLDOWN_MS=5*60*1000;
const SEARCH_RETRY_COOLDOWN_MS=30*1000;
const telegramGraph=new Map();
const crawledTelegramSources=new Set();
const graphInFlight=new Set();
const sourceOutcomeScores=new Map();
export function recordDiscoverySourceOutcome(sources,decision,reasons=[],result={}) {
  const memberCount=Number(result?.memberCount);
  const viableSize=Number.isFinite(memberCount)&&memberCount>=700&&memberCount<=18000;
  const hardReject=reasons.some(reason=>['too_few_members','too_many_members','cannot_write','ads_forbidden','topic_mismatch','invalid_whatsapp_link'].includes(reason));
  const usableSignal=viableSize&&result?.canWrite!==false&&!hardReject;
  for(const source of sources||[]){
    const key=normalizeTelegramPreview(source.sourceUrl||'');
    if(!key)continue;
    const delta=decision==='target'?80
      :reasons.includes('too_few_members')||reasons.includes('cannot_write')?-20
      :reasons.includes('invalid_whatsapp_link')?-12
      :usableSignal?24
      :decision==='rejected'?-8:0;
    sourceOutcomeScores.set(key,Math.max(-120,Math.min(240,(sourceOutcomeScores.get(key)||0)+delta)));
    const queued=telegramGraph.get(key);
    if(queued)queued.score+=delta;
  }
}
const PRODUCTIVE_TELEGRAM_SOURCES=[
  ['https://t.me/s/donetskaoda','Донецьк'],
  ['https://t.me/s/novocava','Валенсія'],
  ['https://t.me/s/Help_Ukraine_NRW','Німеччина'],
];
for(const [sourceUrl,place] of PRODUCTIVE_TELEGRAM_SOURCES){
  telegramGraph.set(sourceUrl,{sourceUrl,score:140,place,evidence:'proven WhatsApp-group source '+place});
}
const directorySearchCache=new Map();
const directoryResultVisited=new Set();
let graphSeedPromise=null;
let searchBlockedUntil=0;

export function workbookSearchPlan(seed) {
  const unsupported=/(назва села|назва селища|район міста|назва района|назва області|пункту пропуску|навчального закладу|назва жк|слово пошук)/iu;
  const english=new Set(['Ukrainian in','Ukrainians','Ukraine chat']);
  const keywords=[...new Set(seed.keywords)].filter(item=>!unsupported.test(item));
  const priority=text=>{
    if(/назва міста чат|Ukraine chat/iu.test(text))return 0;
    if(/Українці в|Ukrainian in|Ukrainians/iu.test(text))return 1;
    if(/допомог|помощь|біжен|переселен|\bвпо\b/iu.test(text))return 2;
    if(/батьки|мамоч/iu.test(text))return 3;
    if(/перевіз|перевез|передач/iu.test(text))return 4;
    if(/барахол|віддам|обмін|продаж/iu.test(text))return 5;
    if(/оренд|зніму|ріелтор/iu.test(text))return 6;
    return 7;
  };
  const render=(template,place)=>english.has(template)?template+' '+place:template==='Просто назва міста'?place
    :template.replace(/Українці в (?:місті|країні) \(назва (?:міста|країни)\)/giu,'Українці '+place)
      .replace(/назва (?:міста або країни|країни або міста|міста|країни)/giu,place)
      .replace(/\s*\+\s*/gu,' ').replace(/\s+/gu,' ').trim();
  const cityTemplates=keywords.filter(item=>/назва міста/iu.test(item)||english.has(item)).sort((a,b)=>priority(a)-priority(b));
  const countryTemplates=keywords.filter(item=>/країн/iu.test(item)||english.has(item)).sort((a,b)=>priority(a)-priority(b));
  const buckets=new Map();
  const seenPlaces=new Set();
  for(const city of seed.cities){
    const label=String(city.uk||city.name||'').trim();
    const key=String(city.country)+'|'+label.toLocaleLowerCase('uk-UA');
    if(!label||seenPlaces.has(key))continue;
    seenPlaces.add(key);
    if(!buckets.has(city.country))buckets.set(city.country,[]);
    buckets.get(city.country).push(city);
  }
  for(const cities of buckets.values())cities.sort((a,b)=>Number(b.population||0)-Number(a.population||0));
  const interleave=limit=>{
    const result=[];
    for(let index=0;index<limit;index++)for(const cities of buckets.values())if(cities[index])result.push(cities[index]);
    return result;
  };
  const fastCities=interleave(5);
  const broadCities=interleave(20);
  const pickTemplate=pattern=>cityTemplates.find(template=>pattern.test(template));
  const fastTemplates=[
    pickTemplate(/назва міста чат/iu),
    pickTemplate(/Українці в місті/iu),
    pickTemplate(/Мамочки/iu),
    pickTemplate(/Батьки/iu),
    pickTemplate(/^Барахолка/iu),
    pickTemplate(/Дитяча барахолка/iu),
    pickTemplate(/Перевізники|Перевезення/iu),
  ].filter(Boolean);
  const broadTemplates=[
    pickTemplate(/назва міста чат/iu),
    pickTemplate(/Українці в місті/iu),
  ].filter(Boolean);
  const tasks=[];
  const seenQueries=new Set();
  const push=task=>{
    const query=String(task.query||'').replace(/\s+/gu,' ').trim();
    if(!query||/назва |\(|\)/iu.test(query))return;
    const alias=String(task.alias||'').replace(/\s+/gu,' ').trim();
    const key=query.toLocaleLowerCase('uk-UA')+'|'+alias.toLocaleLowerCase('uk-UA');
    if(seenQueries.has(key))return;
    seenQueries.add(key);
    tasks.push({...task,query,alias});
  };

  // Fast lane: country-level communities first, then only the strongest city
  // intents for the largest cities in every country. These are the most likely
  // to yield 700+ writable community/parents/marketplace/transport groups.
  for(const country of buckets.keys()){
    push({place:country,query:'Українці '+country,alias:''});
    push({place:country,query:country+' WhatsApp українці',alias:''});
    push({place:country,query:'Оголошення '+country+' українці',alias:''});
  }
  for(const city of fastCities)for(const template of fastTemplates){
    const place=String(city.uk||city.name);
    push({place,query:render(template,place),alias:city.name!==place?render(template,city.name):''});
  }
  for(const city of broadCities)for(const template of broadTemplates){
    const place=String(city.uk||city.name);
    push({place,query:render(template,place),alias:city.name!==place?render(template,city.name):''});
  }

  // Then broaden country-level intent coverage before entering the exhaustive
  // workbook tail. Full coverage remains available, but it no longer delays the
  // high-yield search path for a small target goal.
  for(const country of buckets.keys())for(const template of countryTemplates)push({place:country,query:render(template,country),alias:''});

  // Fast high-yield tiers stay first, but the tail is exhaustive: every valid
  // city/template pair from the workbook is eventually searched. push() keeps
  // this tail deduplicated against the priority tiers above.
  for(const cities of buckets.values())for(const city of cities)for(const template of cityTemplates){
    const place=String(city.uk||city.name);
    push({place,query:render(template,place),alias:city.name!==place?render(template,city.name):''});
  }
  return tasks;
}

function requireSeedData(seedData) {
  if(!seedData||!Array.isArray(seedData.cities)||!seedData.cities.length||!Array.isArray(seedData.keywords)||!seedData.keywords.length){
    throw new Error('source_plan_missing');
  }
  return seedData;
}

export async function localDiscoveryPlanSize({seedData}={}) {
  const plan=workbookSearchPlan(requireSeedData(seedData));
  return BOOTSTRAP_SOURCES.length+plan.length;
}

function graphSourceContext(html,index) {
  return strip(html.slice(Math.max(0,index-700),Math.min(html.length,index+1800)));
}

export function discoverRelatedTelegramSources(html,currentSourceUrl,place='',parentTitle='') {
  const decoded=decode(html).replaceAll('\\/','/');
  const current=normalizeTelegramPreview(currentSourceUrl);
  let added=0;
  for(const match of decoded.matchAll(/https:\/\/t\.me\/(?:s\/)?[A-Za-z0-9_]{3,}/giu)){
    const sourceUrl=normalizeTelegramPreview(match[0]);
    if(!sourceUrl||sourceUrl===current||crawledTelegramSources.has(sourceUrl))continue;
    const channel=telegramChannel(sourceUrl);
    if(!channel||/_bot$/iu.test(channel)||/(?:whatsapp\d*|kiwifarms|intelslava|pilotblog|rfuenglish)/iu.test(channel))continue;
    const context=graphSourceContext(decoded,match.index||0);
    if(SPAM.test(context))continue;
    let score=0;
    if(UA.test(context)||UA.test(parentTitle))score+=30;
    if(place&&new RegExp(escapeRegExp(place),'iu').test(context+' '+channel))score+=18;
    if(/(?:ukrain|ukr|[_-]ua|ua[_-]|help|vpo|refuge|волонтер|допомог|біжен)/iu.test(channel+' '+context))score+=16;
    if(/(?:community|громад|diaspora|батьк|родител|перевез|transport|чат\b|chat\b)/iu.test(context))score+=6;
    if(score<12)continue;
    const existing=telegramGraph.get(sourceUrl);
    if(!existing||score>existing.score){
      const parentScore=sourceOutcomeScores.get(current)||0;
      telegramGraph.set(sourceUrl,{sourceUrl,score:score+parentScore,place,evidence:(parentTitle+' '+context).slice(0,1600)});
      if(!existing)added++;
    }
  }
  return added;
}

export function telegramWhatsAppSearchPreview(value) {
  const normalized=normalizeTelegramPreview(value);
  if(!normalized)return null;
  const url=new URL(normalized);
  if(!url.searchParams.has('before'))url.searchParams.set('q','chat.whatsapp.com');
  return url.toString();
}

function takeTelegramGraphSources(place,limit=MAX_GRAPH_SOURCES_PER_STEP) {
  const placeRe=place?new RegExp(escapeRegExp(place),'iu'):null;
  const ranked=[...telegramGraph.values()]
    .filter(item=>!crawledTelegramSources.has(item.sourceUrl)&&!graphInFlight.has(item.sourceUrl))
    .map(item=>({...item,effectiveScore:item.score+(placeRe?.test(item.evidence+' '+item.sourceUrl)?25:0)}))
    .sort((a,b)=>b.effectiveScore-a.effectiveScore)
    .slice(0,limit);
  for(const item of ranked){
    graphInFlight.add(item.sourceUrl);
  }
  return ranked.map(item=>telegramWhatsAppSearchPreview(item.sourceUrl)).filter(Boolean);
}

async function ensureTelegramGraphSeeded(fetcher) {
  if(telegramGraph.size||graphSeedPromise)return graphSeedPromise;
  graphSeedPromise=(async()=>{
    for(const [,url,place] of BOOTSTRAP_SOURCES){
      try{
        const page=await fetchText(url,fetcher,8000,500000);
        discoverRelatedTelegramSources(page,url,place,telegramTitle(page,url));
        if(telegramGraph.size>=24)break;
      }catch{}
    }
  })().finally(()=>{graphSeedPromise=null;});
  return graphSeedPromise;
}

function olderPreview(html,current) {
  const url=new URL(current);
  const matches=[...decode(html).matchAll(/href=["']([^"']*[?&]before=\d+[^"']*)["']/giu)];
  for(const match of matches){
    const next=new URL(match[1],url);
    if(next.origin===url.origin&&next.pathname===url.pathname&&next.searchParams.get('before')!==url.searchParams.get('before'))return next.toString();
  }
  return null;
}
async function telegramSource(sourceUrl,query,place,fetcher) {
  const cached=pageCache.get(sourceUrl);
  if(cached&&cached.expires>Date.now())return {...cached.source,query,seedLabel:place};
  let current=sourceUrl;
  let title='';
  const snippets=[];
  const seenInvites=new Set();
  for(let pageIndex=0;pageIndex<MAX_TELEGRAM_HISTORY_PAGES&&current;pageIndex++){
    const page=await fetchText(current,fetcher,12000,900000);
    if(!title)title=telegramTitle(page,current);
    discoverRelatedTelegramSources(page,current,place,title);
    for(const snippet of extractRelevantInviteSnippets(page,title)){
      const match=snippet.match(/(?:https?:\/\/)?chat\.whatsapp\.com\/[A-Za-z0-9_-]{8,128}/iu);
      const invite=match?canonicalInvite(match[0]):null;
      if(!invite||seenInvites.has(invite))continue;
      seenInvites.add(invite);
      snippets.push(snippet);
      if(snippets.length>=24)break;
    }
    if(snippets.length>=24)break;
    current=olderPreview(page,current);
  }
  const source={sourceUrl,sourceTitle:title||telegramChannel(sourceUrl),query,seedLabel:place,context:title||place,text:snippets.join('\n\n').slice(0,45000)};
  if(pageCache.size>=500)pageCache.delete(pageCache.keys().next().value);
  pageCache.set(sourceUrl,{source,expires:Date.now()+15*60*1000});
  return source;
}

export async function crawlLocalDiscoverySource(cursor,{fetcher=fetch,seedData}={}) {
  const index=Math.max(0,Number(cursor)||0);
  let totalTasks=null,query='',attempted=0;
  const warnings=[];
  try{
    const plan=workbookSearchPlan(requireSeedData(seedData));
    totalTasks=BOOTSTRAP_SOURCES.length+plan.length;
    if(index>=totalTasks)return {searched:0,nextCursor:index,done:true,totalTasks,query,sources:[],errors:[]};
    const sources=[];
    if(index<BOOTSTRAP_SOURCES.length){
      const [,url,place]=BOOTSTRAP_SOURCES[index];
      query='Telegram · '+place;
      attempted=1;
      try{
        const source=await telegramSource(url,query,place,fetcher);
        if(source.text)sources.push(source);
      }catch(error){
        warnings.push({cursor:index,query,reason:error instanceof Error?error.message:String(error)});
      }
    }else{
      const task=plan[index-BOOTSTRAP_SOURCES.length];
      query=task.query;
      await ensureTelegramGraphSeeded(fetcher);

      // Prefer the Telegram graph. It survives search-engine rate limits and each
      // visited source can discover more sources for later steps.
      let graphBudget=MAX_GRAPH_SOURCES_PER_STEP;
      while(graphBudget>0&&!sources.length){
        const graphCandidates=takeTelegramGraphSources(task.place,Math.min(4,graphBudget));
        if(!graphCandidates.length)break;
        graphBudget-=graphCandidates.length;
        attempted+=graphCandidates.length;
        const graphPages=await Promise.allSettled(
          graphCandidates.map(async url=>{
            const key=normalizeTelegramPreview(url);
            try{
              const source=await telegramSource(url,'Telegram graph · '+task.query,task.place,fetcher);
              crawledTelegramSources.add(key);
              telegramGraph.delete(key);
              return source;
            }catch(error){
              warnings.push({cursor:index,query,reason:'telegram_graph_failed · '+String(error?.message||error)});
              throw error;
            }finally{graphInFlight.delete(key);}
          })
        );
        sources.push(...graphPages
          .filter(item=>item.status==='fulfilled'&&item.value?.text)
          .map(item=>item.value));
      }

      // Search the public Telegram directory first. This is account-free and
      // returns both channel and concrete post results; post pages can contain
      // the WhatsApp invite directly.
      let directoryAnswered=false;
      if(sources.length<8){
        const directoryQueries=[...new Set([
          /whatsapp/iu.test(task.query)?task.query:task.query+' WhatsApp',
          task.query,
          task.place?task.place+' WhatsApp':'',
          task.place,
        ].map(item=>String(item||'').trim()).filter(Boolean))].slice(0,3);
        attempted+=directoryQueries.length;
        const directoryBatches=await Promise.allSettled(directoryQueries.map(async directoryQuery=>{
          const cacheKey=directoryQuery.toLocaleLowerCase('uk-UA');
          const cached=directorySearchCache.get(cacheKey);
          if(cached&&cached.expires>Date.now())return {directoryQuery,candidates:cached.candidates};
          const directory=new URL(TELEGRAM_DIRECTORY_URL);
          directory.searchParams.set('q',directoryQuery);
          const html=await fetchText(directory.toString(),fetcher,7000,450000);
          const candidates=rankTelegramDirectoryResults(html,task.place).slice(0,MAX_DIRECTORY_RESULTS*2);
          if(directorySearchCache.size>=400)directorySearchCache.delete(directorySearchCache.keys().next().value);
          directorySearchCache.set(cacheKey,{candidates,expires:Date.now()+20*60*1000});
          return {directoryQuery,candidates};
        }));
        const selected=[];
        const selectedUrls=new Set();
        for(const batch of directoryBatches){
          if(batch.status==='rejected'){
            warnings.push({cursor:index,query,reason:'telegram_directory_failed · '+(batch.reason instanceof Error?batch.reason.message:String(batch.reason))});
            continue;
          }
          directoryAnswered=true;
          for(const url of batch.value.candidates){
            if(directoryResultVisited.has(url)||selectedUrls.has(url))continue;
            selectedUrls.add(url);
            selected.push({url,directoryQuery:batch.value.directoryQuery});
            if(selected.length>=MAX_DIRECTORY_RESULTS)break;
          }
          if(selected.length>=MAX_DIRECTORY_RESULTS)break;
        }
        const pages=await Promise.allSettled(selected.map(async item=>{
          try{
            const source=await telegramDirectorySource(item.url,item.directoryQuery,task.place,fetcher);
            directoryResultVisited.add(item.url);
            return source;
          }catch(error){
            warnings.push({cursor:index,query,reason:'telegram_directory_source_failed · '+String(error?.message||error)});
            throw error;
          }
        }));
        sources.push(...pages
          .filter(item=>item.status==='fulfilled'&&item.value?.text)
          .map(item=>item.value));
      }

      // A successful empty directory response is not useful supply. Try web
      // search as well; directory availability only affects error backoff.
      let searchFailureReason='';
      if(!sources.length&&Date.now()>=searchBlockedUntil){
        const queries=[task.query+' "chat.whatsapp.com"',...(task.alias?[task.alias+' "chat.whatsapp.com"']:[]),task.query+' WhatsApp'];
        const seen=new Set();
        for(const searchQuery of queries){
          attempted++;
          try{
            const search=new URL(SEARCH_URL);
            search.searchParams.set('q','site:t.me '+searchQuery);
            search.searchParams.set('source','web');
            const html=await fetchText(search.toString(),fetcher,12000,350000);
            const candidates=rankTelegramSources(html,task.place).map(telegramWhatsAppSearchPreview).filter(url=>url&&!seen.has(url)).slice(0,MAX_SEARCH_SOURCES);
            for(const url of candidates)seen.add(url);
            const pages=await Promise.allSettled(candidates.map(url=>telegramSource(url,searchQuery,task.place,fetcher)));
            const fulfilled=pages.filter(item=>item.status==='fulfilled');
            sources.push(...fulfilled.filter(item=>item.value?.text).map(item=>item.value));
            if(candidates.length&&fulfilled.length===0)throw new Error('telegram_source_fetch_failed');
            if(sources.length)break;
          }catch(error){
            const reason=error instanceof Error?error.message:String(error);
            searchFailureReason=reason||'search_failed';
            const blocked=/(?:search_rate_limited|search_blocked|source_http_429|too many requests|captcha|verify (?:that )?you are human)/iu.test(searchFailureReason);
            searchBlockedUntil=Date.now()+(blocked?SEARCH_BLOCK_COOLDOWN_MS:SEARCH_RETRY_COOLDOWN_MS);
            break;
          }
        }
      }
      if(!sources.length&&(searchFailureReason||Date.now()<searchBlockedUntil)){
        if(directoryAnswered){
          warnings.push({cursor:index,query,reason:'optional_web_search_deferred · '+(searchFailureReason||'search_cooldown')});
        }else{
          return {
            searched:attempted,nextCursor:index,done:false,totalTasks,query,sources:[],errors:[],warnings,
            deferred:true,
            deferredReason:searchFailureReason||'search_cooldown',
            retryAfterMs:Math.max(1000,searchBlockedUntil-Date.now()),
          };
        }
      }
    }
    return {searched:attempted,nextCursor:index+1,done:index+1>=totalTasks,totalTasks,query,sources,errors:[],warnings,deferred:false,retryAfterMs:0};
  }catch(error){
    return {searched:attempted,nextCursor:index,done:false,totalTasks,query,sources:[],errors:[{cursor:index,query,reason:error instanceof Error?error.message:String(error)}],warnings};
  }
}

export function rankTelegramDirectoryResults(html,place='') {
  const decoded=decode(html).replaceAll('\\/','/');
  const blocked=new Set(['ads','c','g','geo','login','need','new','notifications','premium','search','send','settings','top','wiki','ton']);
  const seen=new Set();
  const ranked=[];
  let order=0;
  const re=/href=["']\/([A-Za-z0-9_]{3,})(?:\/(\d+))?["']/giu;
  for(const match of decoded.matchAll(re)){
    const username=String(match[1]||'');
    const postId=String(match[2]||'');
    const lower=username.toLowerCase();
    if(blocked.has(lower)||/_bot$/iu.test(username)||seen.has(username+'|'+postId))continue;
    const context=searchResultContext(decoded,match.index||0);
    if(SPAM.test(context))continue;
    const identity=context+' '+username;
    const uaSignal=UA.test(identity)||/(?:ukrain|ukr|[_-]ua|ua[_-]|diaspora|refuge|біжен|переселен)/iu.test(identity);
    if(!uaSignal)continue;
    const placeSignal=Boolean(place&&new RegExp(escapeRegExp(place),'iu').test(identity));
    const whatsappSignal=/(?:chat\.whatsapp\.com|\bwhatsapp\b)/iu.test(context);
    let score=100-order++;
    score+=45;
    if(placeSignal)score+=35;
    if(whatsappSignal)score+=55;
    if(/(?:help|допомог|оголош|community|громад|transport|перевез|батьк|мамоч|барахол)/iu.test(identity))score+=18;
    if(postId)score+=10; else score+=20;
    seen.add(username+'|'+postId);
    ranked.push({url:'https://tg.me/'+username+(postId?'/'+postId:''),score});
  }
  return ranked.sort((a,b)=>b.score-a.score).map(item=>item.url);
}

async function telegramDirectorySource(resultUrl,query,place,fetcher){
  const parts=new URL(resultUrl).pathname.split('/').filter(Boolean);
  const username=parts[0]||'';
  const postId=parts[1]||'';
  if(!username)return {sourceUrl:resultUrl,sourceTitle:'',query,seedLabel:place,context:place,text:''};

  // A directory channel result is only a lead. Search inside the actual public
  // Telegram channel for group invite URLs before deciding it has no WhatsApp chats.
  if(!postId){
    const exactUrl='https://t.me/s/'+username+'?q=chat.whatsapp.com';
    const exact=await telegramSource(exactUrl,query,place,fetcher);
    if(exact.text)return exact;
    return telegramSource('https://t.me/s/'+username+'?q=WhatsApp',query,place,fetcher);
  }

  const cached=pageCache.get(resultUrl);
  if(cached&&cached.expires>Date.now())return {...cached.source,query,seedLabel:place};
  const page=await fetchText(resultUrl,fetcher,10000,650000);
  const telegramUrl='https://t.me/'+username+'/'+postId;
  const title=telegramTitle(page,'https://t.me/s/'+username);
  discoverRelatedTelegramSources(page,'https://t.me/s/'+username,place,title);
  const snippets=extractRelevantInviteSnippets(page,title);
  const source={sourceUrl:telegramUrl,sourceTitle:title||username,query,seedLabel:place,context:title||place,text:snippets.join('\n\n').slice(0,45000)};
  if(pageCache.size>=500)pageCache.delete(pageCache.keys().next().value);
  pageCache.set(resultUrl,{source,expires:Date.now()+15*60*1000});
  return source;
}

export function rankTelegramSources(html, place) {
  const decoded = decode(html).replaceAll('\\/', '/');
  const seen = new Set();
  const ranked = [];
  const re = /https:\/\/t\.me\/(?:s\/)?[A-Za-z0-9_]+(?:\?before=\d+)?/giu;
  let order = 0;
  for (const match of decoded.matchAll(re)) {
    const sourceUrl = normalizeTelegramPreview(match[0]);
    if (!sourceUrl || seen.has(sourceUrl)) continue;
    seen.add(sourceUrl);
    const path = telegramChannel(sourceUrl) || '';
    if (/(?:whatsapp\d*|kiwifarms|intelslava|pilotblog|rfuenglish)/iu.test(path)) continue;

    const context = searchResultContext(decoded, match.index || 0);
    if (SPAM.test(context)) continue;

    let score = 100 - order++;
    if (/chat\.whatsapp\.com/iu.test(context)) score += 140;
    if (UA.test(context)) score += 45;
    if (new RegExp(escapeRegExp(place),'iu').test(context)) score += 20;
    if (/(?:ukrain|ukr|[_-]ua|ua[_-]|help|vpo)/iu.test(path)) score += 18;
    if (/(?:допомог|help|refuge|біжен|community|громад|diaspora)/iu.test(context)) score += 6;
    ranked.push({ sourceUrl, score });
  }
  return ranked.sort((a,b)=>b.score-a.score).map(item=>item.sourceUrl);
}

function searchResultContext(html,index) {
  const blockStart = html.lastIndexOf('<div class="snippet', index);
  const nextBlock = html.indexOf('<div class="snippet', index + 1);
  if (blockStart >= 0) {
    const end = nextBlock > blockStart ? nextBlock : Math.min(html.length, blockStart + 12000);
    return strip(html.slice(blockStart, end));
  }
  return strip(html.slice(Math.max(0,index-500), Math.min(html.length,index+2500)));
}

export function extractRelevantInviteSnippets(html,title) {
  const decoded = decode(html).replaceAll('\\/', '/');
  const titleEvidence = strip(title || '');
  const result = [];
  const seen = new Set();
  const re = /(?:https?:\/\/)?chat\.whatsapp\.com\/[A-Za-z0-9_-]{8,128}(?:\?[^\s<>"']*)?/giu;
  for (const match of decoded.matchAll(re)) {
    const canonical = canonicalInvite(match[0]);
    if (!canonical || seen.has(canonical)) continue;
    const i = match.index || 0;
    const context = strip(decoded.slice(Math.max(0,i-1100), Math.min(decoded.length,i+match[0].length+1100)));
    const evidence = titleEvidence + ' · ' + context;
    if (!UA.test(evidence) || SPAM.test(context)) continue;
    const arabic = (context.match(/[\u0600-\u06ff]/gu) || []).length;
    const letters = (context.match(/\p{L}/gu) || []).length || 1;
    if (arabic / letters > 0.25) continue;
    seen.add(canonical);
    result.push(titleEvidence + '\n' + context + '\n' + canonical);
    if (result.length >= 12) break;
  }
  return result;
}

function canonicalInvite(value) {
  try {
    const raw = /^https?:\/\//i.test(value) ? value : ('https://' + value);
    const url = new URL(raw);
    if (url.hostname.toLowerCase() !== 'chat.whatsapp.com') return null;
    const code = url.pathname.split('/').filter(Boolean)[0] || '';
    return /^[A-Za-z0-9_-]{8,128}$/u.test(code) ? ('https://chat.whatsapp.com/' + code) : null;
  } catch { return null; }
}
function normalizeTelegramPreview(value) {
  try {
    const url = new URL(value);
    if (url.hostname !== 't.me' && url.hostname !== 'telegram.me') return null;
    const parts = url.pathname.split('/').filter(Boolean);
    const channel = parts[0] === 's' ? parts[1] : parts[0];
    if (!channel || !/[A-Za-z0-9_]{3,}/u.test(channel)) return null;
    const out = new URL('https://t.me/s/' + channel);
    const before = url.searchParams.get('before');
    if (before && /^\d+$/u.test(before)) out.searchParams.set('before', before);
    return out.toString();
  } catch { return null; }
}
function telegramChannel(value) { try { return new URL(value).pathname.split('/').filter(Boolean).filter(x=>x!=='s')[0] || ''; } catch { return ''; } }
function telegramTitle(html,sourceUrl) {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/iu)?.[1] || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/iu)?.[1];
  if (og) return strip(decode(og));
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/iu)?.[1];
  return strip(decode(title || telegramChannel(sourceUrl)));
}
async function fetchText(url,fetcher,timeout,limit) {
  const host=new URL(url).hostname.toLowerCase();
  let lastError;
  for(let attempt=0;attempt<2;attempt++){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeout);
    try{
      let text;
      if(host==='search.brave.com'&&fetcher===fetch){
        const marker='__WORK_OS_HTTP_STATUS__';
        const {stdout}=await execFile('/usr/bin/curl',[
          '-L','-sS','--compressed','--max-time',String(Math.ceil(timeout/1000)),
          '-A',USER_AGENT,'-H','Accept-Language: uk,en;q=0.8','-w',marker+'%{http_code}',url,
        ],{encoding:'utf8',maxBuffer:Math.max(limit+200000,700000)});
        const raw=String(stdout||'');
        const markerIndex=raw.lastIndexOf(marker);
        const status=markerIndex>=0?Number(raw.slice(markerIndex+marker.length)):0;
        text=markerIndex>=0?raw.slice(0,markerIndex):raw;
        if(status===429)throw new Error('search_rate_limited · '+host);
        if(status>=400)throw new Error('source_http_'+status+' · '+host);
      }else{
        const response=await fetcher(url,{signal:controller.signal,redirect:'follow',headers:{'User-Agent':USER_AGENT,Accept:'text/html,application/json,text/plain;q=0.8','Accept-Language':'uk,en;q=0.8'}});
        if(!response.ok)throw new Error('source_http_'+response.status+' · '+host);
        text=await response.text();
      }
      if(!text.trim())throw new Error('source_empty_response · '+host);
      if(host==='search.brave.com'&&/captcha|verify (?:that )?you are human|too many requests|rate limit|access denied/iu.test(strip(text).slice(0,3000)))throw new Error('search_blocked · '+host);
      return text.slice(0,limit);
    }catch(error){
      lastError=error;
      if(attempt===0)await new Promise(resolve=>setTimeout(resolve,500));
    }finally{clearTimeout(timer);}
  }
  throw lastError;
}
function decode(value) {
  const named={amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '};
  return String(value||'').replace(/&(#x?[0-9a-f]+|[a-z]+);/giu,(_,key)=>{
    const lower=String(key).toLowerCase();
    if(lower[0]==='#'){const hex=lower[1]==='x';const n=parseInt(lower.slice(hex?2:1),hex?16:10);return Number.isFinite(n)?String.fromCodePoint(n):_;}
    return named[lower] ?? _;
  });
}
function strip(value) { return decode(value).replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/giu,' ').replace(/<[^>]+>/gu,' ').replace(/\s+/gu,' ').trim(); }
function escapeRegExp(value) {
  const slash=String.fromCharCode(92);
  const specials='^$.*+?()[]{}|'+slash;
  return String(value).split('').map((char)=>specials.includes(char)?slash+char:char).join('');
}
