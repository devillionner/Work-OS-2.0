import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
const execFile = promisify(execFileCallback);
const SEARCH_URL = 'https://search.brave.com/search';
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
const UA = /(?:україн|украин|ukrain|🇺🇦)/iu;
const SPAM = /(?:crypto|bitcoin|forex|casino|казино|betting|dating|escort|onlyfans|nft|airdrop|signals?\b|قروبات|روابط\s+مجموعات|مجموعات\s+واتساب|technical\s+support)/iu;
const MAX_TELEGRAM_HISTORY_PAGES=4;
const MAX_SEARCH_SOURCES=5;
const MAX_GRAPH_SOURCES_PER_STEP=8;
const SEARCH_BLOCK_COOLDOWN_MS=5*60*1000;
const telegramGraph=new Map();
const crawledTelegramSources=new Set();
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
  const top20=interleave(20);
  const top20Keys=new Set(top20.map(city=>String(city.country)+'|'+String(city.uk||city.name)));
  const top50Tail=interleave(50).filter(city=>!top20Keys.has(String(city.country)+'|'+String(city.uk||city.name)));
  const coreTemplates=cityTemplates.slice(0,12);
  const remainingTemplates=cityTemplates.slice(12);
  const fallbackTemplates=cityTemplates.slice(0,2);
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
  for(const country of buckets.keys()){
    push({place:country,query:'Українці '+country,alias:''});
    push({place:country,query:'Ukrainians '+country,alias:''});
    push({place:country,query:country+' WhatsApp українці',alias:''});
  }
  for(const country of buckets.keys())for(const template of countryTemplates)push({place:country,query:render(template,country),alias:''});
  for(const city of top20)for(const template of coreTemplates){
    const place=String(city.uk||city.name);
    push({place,query:render(template,place),alias:city.name!==place?render(template,city.name):''});
  }
  for(const city of interleave(8))for(const template of remainingTemplates){
    const place=String(city.uk||city.name);
    push({place,query:render(template,place),alias:city.name!==place?render(template,city.name):''});
  }
  for(const city of top50Tail)for(const template of fallbackTemplates){
    const place=String(city.uk||city.name);
    push({place,query:render(template,place),alias:city.name!==place?render(template,city.name):''});
  }

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
      telegramGraph.set(sourceUrl,{sourceUrl,score,place,evidence:(parentTitle+' '+context).slice(0,1600)});
      if(!existing)added++;
    }
  }
  return added;
}

export function telegramWhatsAppSearchPreview(value) {
  const normalized=normalizeTelegramPreview(value);
  if(!normalized)return null;
  const url=new URL(normalized);
  if(!url.searchParams.has('before'))url.searchParams.set('q','WhatsApp');
  return url.toString();
}

function takeTelegramGraphSources(place,limit=MAX_GRAPH_SOURCES_PER_STEP) {
  const placeRe=place?new RegExp(escapeRegExp(place),'iu'):null;
  const ranked=[...telegramGraph.values()]
    .filter(item=>!crawledTelegramSources.has(item.sourceUrl))
    .map(item=>({...item,effectiveScore:item.score+(placeRe?.test(item.evidence+' '+item.sourceUrl)?25:0)}))
    .sort((a,b)=>b.effectiveScore-a.effectiveScore)
    .slice(0,limit);
  for(const item of ranked){
    telegramGraph.delete(item.sourceUrl);
    crawledTelegramSources.add(item.sourceUrl);
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
  try{
    const plan=workbookSearchPlan(requireSeedData(seedData));
    totalTasks=BOOTSTRAP_SOURCES.length+plan.length;
    if(index>=totalTasks)return {searched:0,nextCursor:index,done:true,totalTasks,query,sources:[],errors:[]};
    const sources=[];
    if(index<BOOTSTRAP_SOURCES.length){
      const [,url,place]=BOOTSTRAP_SOURCES[index];
      query='Telegram · '+place;
      attempted=1;
      const source=await telegramSource(url,query,place,fetcher);
      if(source.text)sources.push(source);
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
          graphCandidates.map(url=>telegramSource(url,'Telegram graph · '+task.query,task.place,fetcher))
        );
        sources.push(...graphPages
          .filter(item=>item.status==='fulfilled'&&item.value?.text)
          .map(item=>item.value));
      }

      // Web search is only an optional seed source. A 429 or temporary backend
      // failure must never stop the Discovery run.
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
            sources.push(...pages
              .filter(item=>item.status==='fulfilled'&&item.value?.text)
              .map(item=>item.value));
            if(sources.length)break;
          }catch(error){
            const reason=error instanceof Error?error.message:String(error);
            if(/(?:search_rate_limited|source_http_429|curl.*(?:22|429)|too many requests)/iu.test(reason)){
              searchBlockedUntil=Date.now()+SEARCH_BLOCK_COOLDOWN_MS;
              break;
            }
          }
        }
      }
      if(!sources.length&&Date.now()<searchBlockedUntil){
        return {
          searched:attempted,nextCursor:index,done:false,totalTasks,query,sources:[],errors:[],
          deferred:true,retryAfterMs:Math.max(1000,searchBlockedUntil-Date.now()),
        };
      }
    }
    return {searched:attempted,nextCursor:index+1,done:index+1>=totalTasks,totalTasks,query,sources,errors:[],deferred:false,retryAfterMs:0};
  }catch(error){
    return {searched:attempted,nextCursor:index,done:false,totalTasks,query,sources:[],errors:[{cursor:index,query,reason:error instanceof Error?error.message:String(error)}]};
  }
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
          '-A',USER_AGENT,'-H','Accept-Language: uk,en;q=0.8','-w','\\n'+marker+'%{http_code}',url,
        ],{encoding:'utf8',maxBuffer:Math.max(limit+200000,700000)});
        const raw=String(stdout||'');
        const markerIndex=raw.lastIndexOf('\\n'+marker);
        const status=markerIndex>=0?Number(raw.slice(markerIndex+marker.length+1)):0;
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
