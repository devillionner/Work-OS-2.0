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

export function workbookSearchPlan(seed) {
  const unsupported = /(назва села|назва селища|район міста|назва района|назва області|пункту пропуску|навчального закладу|назва жк|слово пошук)/iu;
  const english = new Set(['Ukrainian in','Ukrainians','Ukraine chat']);
  const keywords = [...new Set(seed.keywords)].filter(item => !unsupported.test(item));
  const priority = text => /Українці в/iu.test(text) ? 0 : /допомог|помощь|батьки|мамоч/iu.test(text) ? 1 : /чат|барахол|перевіз|перевез/iu.test(text) ? 2 : 3;
  keywords.sort((a,b) => priority(a)-priority(b));
  const buckets = new Map();
  const seen = new Set();
  for (const city of seed.cities) {
    const label = String(city.uk || city.name || '').trim();
    const key = String(city.country) + '|' + label.toLocaleLowerCase('uk-UA');
    if (!label || seen.has(key)) continue;
    seen.add(key);
    if (!buckets.has(city.country)) buckets.set(city.country,[]);
    buckets.get(city.country).push(city);
  }
  for (const cities of buckets.values()) cities.sort((a,b) => Number(b.population||0)-Number(a.population||0));
  const places = [];
  for (let index=0; ; index++) {
    let added=false;
    for (const cities of buckets.values()) if(cities[index]) { places.push(cities[index]); added=true; }
    if(!added)break;
  }
  const render=(template,place) => english.has(template) ? template+' '+place : template === 'Просто назва міста' ? place
    : template.replace(/Українці в (?:місті|країні) \(назва (?:міста|країни)\)/giu,'Українці в '+place)
      .replace(/назва (?:міста або країни|країни або міста|міста|країни)/giu,place)
      .replace(/\s*\+\s*/gu,' ').replace(/\s+/gu,' ').trim();
  const cityTemplates=keywords.filter(item=>/назва міста/iu.test(item)||english.has(item));
  const countryTemplates=keywords.filter(item=>/назва країни/iu.test(item)||english.has(item));
  const tasks=[];
  // Interleave countries and intents so no one country consumes the entire first pass.
  for(let wave=0;wave<cityTemplates.length;wave+=3){
    for(const city of places)for(const template of cityTemplates.slice(wave,wave+3)){
      const place=String(city.uk||city.name);
      tasks.push({place,query:render(template,place),alias:city.name!==place?render(template,city.name):''});
    }
    if(wave===0)for(const place of buckets.keys())for(const template of countryTemplates){
      tasks.push({place,query:render(template,place),alias:''});
    }
  }
  return tasks.filter(item=>item.query&&!/назва |\(|\)/iu.test(item.query));
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
  const page=await fetchText(sourceUrl,fetcher,12000,900000);
  const title=telegramTitle(page,sourceUrl);
  let snippets=extractRelevantInviteSnippets(page,title);
  if(!snippets.length){
    const older=olderPreview(page,sourceUrl);
    if(older)snippets=extractRelevantInviteSnippets(await fetchText(older,fetcher,12000,900000),title);
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
      const queries=[task.query+' "chat.whatsapp.com"',...(task.alias?[task.alias+' "chat.whatsapp.com"']:[]),task.query+' WhatsApp'];
      const seen=new Set();
      for(const searchQuery of queries){
        attempted++;
        const search=new URL(SEARCH_URL);
        search.searchParams.set('q','site:t.me '+searchQuery);
        search.searchParams.set('source','web');
        const html=await fetchText(search.toString(),fetcher,12000,350000);
        const candidates=rankTelegramSources(html,task.place).filter(url=>!seen.has(url)).slice(0,3);
        for(const url of candidates)seen.add(url);
        const pages=await Promise.all(candidates.map(url=>telegramSource(url,searchQuery,task.place,fetcher)));
        sources.push(...pages.filter(source=>source.text));
        if(sources.length)break;
      }
    }
    return {searched:attempted,nextCursor:index+1,done:index+1>=totalTasks,totalTasks,query,sources,errors:[]};
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
        const {stdout}=await execFile('/usr/bin/curl',[
          '-L','--fail','-sS','--compressed','--max-time',String(Math.ceil(timeout/1000)),
          '-A',USER_AGENT,'-H','Accept-Language: uk,en;q=0.8',url,
        ],{encoding:'utf8',maxBuffer:Math.max(limit+200000,700000)});
        text=String(stdout||'');
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
