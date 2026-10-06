// Discovery source plan since 2026-10-02 (operator decision): public Telegram GROUPS only, no channels,
// no generic web/Brave/tg.me/Lyzem crawl. The server-side web-crawl graph (search.brave.com, tg.me
// directory, lyzem.com, cross-page Telegram-channel graph traversal) this file used to run was retired
// 2026-10-04 — the runner never called it (see docs/TODO.md) — and has been deleted here along with its
// private helpers (fetchText/decode/strip/telegramChannel/telegramTitle/escapeRegExp/placeMatches/
// canonicalInvite and the ranking functions). What remains is the live path: workbookSearchPlan builds the
// Telegram search-query plan, telegramGroupDiscoveryPlan turns it (plus the owner's already-joined Telegram
// groups) into runner steps, and telegramGroupSource formats one scanned group's invites for the DO.
const telegramGraph = new Map();
const sourceOutcomeScores = new Map();
const sourceChildren = new Map();
const sourceSaturatedUntil = new Map();
function feedbackSourceKey(value){
  try{
    const url=new URL(String(value||''));
    if(['t.me','telegram.me','tg.me'].includes(url.hostname)){
      const parts=url.pathname.split('/').filter(Boolean);
      const channel=(parts[0]==='s'?parts[1]:parts[0])||'';
      return channel?'https://t.me/s/'+channel:null;
    }
  }catch{}
  return null;
}
export function hydrateDiscoverySourceFeedback(feedback={}){
  const entries=Object.entries(feedback&&typeof feedback==='object'?feedback:{})
    .sort((a,b)=>Number(a[1]?.lastCrawledAt||a[1]?.lastOutcomeAt||0)-Number(b[1]?.lastCrawledAt||b[1]?.lastOutcomeAt||0))
    .slice(-500);
  for(const [raw,entry] of entries){
    const key=feedbackSourceKey(raw);
    if(!key||!entry||typeof entry!=='object')continue;
    sourceOutcomeScores.set(key,Math.max(-120,Math.min(240,Number(entry.score)||0)));
    const until=Number(entry.saturatedUntil)||0;
    if(until>Date.now())sourceSaturatedUntil.set(key,until);
    else sourceSaturatedUntil.delete(key);
  }
}
function adjustSourceScore(key,delta){
  if(!key||!Number.isFinite(delta)||delta===0)return;
  sourceOutcomeScores.set(key,Math.max(-120,Math.min(240,(sourceOutcomeScores.get(key)||0)+delta)));
  const queued=telegramGraph.get(key);
  if(queued)queued.score=Math.max(-120,Math.min(320,queued.score+delta));
}
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
    adjustSourceScore(key,delta);
    for(const child of sourceChildren.get(key)||[])adjustSourceScore(child,Math.round(delta*0.75));
  }
}

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
  const fallbackCities=interleave(120);
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
  // The fast lane above is cheap (the five largest cities per country) and deliberately broad. The two tiers
  // below are not: they span 20 and 120 places per country, so between them they are almost the whole plan,
  // and which templates they carry decides what the run spends its day on. Ranked by what the operator's
  // runner log actually measured over 4 612 Telegram searches (2026-10-04..06) — share of queries that
  // returned at least one public group, with the sample size that backs it:
  //   «Барахолка X» 16.7% (42 queries) · «X чат» 10.7% (1 434) · «Українці X» 4.8% (1 427, 180 groups)
  //   «Батьки X» 4.9% (41 — too small to outrank the two above) · never measured · «Мамочки X» 0.5%
  //   (10 groups out of 1 422 queries) · «Дитяча барахолка X» 0% (42) · «Перевізники X» 0% (54)
  // Until this ranking the tail carried «Мамочки» over 120 places per country: a third of the entire plan,
  // roughly 85 minutes of searching, for ten groups. Ranking instead of a fixed list also keeps the deep
  // tail reachable for a workbook that simply has other keywords.
  const measuredRank=text=>{
    if(text.startsWith('Барахолка'))return 0;
    if(/назва міста чат/iu.test(text))return 1;
    if(/Українці в місті/iu.test(text))return 2;
    if(/Батьки/iu.test(text))return 3;
    if(/Мамочки/iu.test(text))return 5;
    if(/Дитяча барахолка|Перевізники|Перевезення/iu.test(text))return 6;
    if(english.has(text))return 7;
    return 4; // never measured: ahead of what is proven dead, behind what is proven to work
  };
  const rankedTemplates=[...cityTemplates].sort((a,b)=>measuredRank(a)-measuredRank(b));
  const broadTemplates=rankedTemplates.slice(0,3);
  const fallbackTemplates=rankedTemplates.slice(0,3);
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

  // The old exhaustive city × keyword cross-product produced >84k tasks and
  // spent most of a five-minute run on low-yield queries. Keep a broad fallback
  // across the largest 120 places per country, but only with the three strongest
  // factual-yield intents. New source clusters can still expand through the
  // Telegram graph, so coverage grows from productive evidence instead of brute force.
  for(const city of fallbackCities)for(const template of fallbackTemplates){
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

// Discovery source plan since 2026-10-02 (operator decision): public Telegram GROUPS only, no channels.
// Steps alternate between (a) a Telegram global search for one workbook query (place + «українці»,
// «барахолка», «мамочки», «перевезення»…) and (b) a few groups that the owner's Telegram accounts already
// joined (read from Work OS when the run starts). Deterministic, so the run cursor can resume after a pause.
// Public username of a Telegram chat link; invite hashes (+xxxx, joinchat) are private and skipped.
export function telegramPublicUsername(link) {
  let url;
  try { url = new URL(String(link || '').trim()); } catch { return null; }
  const host = url.hostname.toLowerCase().replace(/^www\./u, '');
  if (!['t.me', 'telegram.me', 'telegram.dog'].includes(host)) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  const name = parts[0] === 's' ? parts[1] : parts[0];
  // Invite hashes (+xxxx, joinchat/...) are private groups: they cannot be opened without joining.
  if (!name || name.startsWith('+') || ['joinchat', 'addstickers', 'share', 'proxy', 'c'].includes(name.toLowerCase())) return null;
  if (!/^[A-Za-z][A-Za-z0-9_]{3,31}$/u.test(name) || /bot$/iu.test(name)) return null;
  return name;
}

export const JOINED_GROUPS_PER_STEP=3;
export function telegramGroupDiscoveryPlan(seed,joinedGroups=[]){
  // Telegram matches group titles, so the web-search word «WhatsApp» is dropped from the query.
  const searchSeen=new Set();
  const searches=[];
  for(const task of workbookSearchPlan(requireSeedData(seed))){
    const query=String(task.query||'').replace(/\bwhatsapp\b/giu,' ').replace(/\s+/gu,' ').trim();
    // Word order does not matter to Telegram search: «Українці Німеччина» = «Німеччина українці».
    const key=query.toLocaleLowerCase('uk-UA').split(' ').sort().join(' ');
    if(!query||searchSeen.has(key))continue;
    searchSeen.add(key);
    searches.push({kind:'search',query,place:task.place});
  }
  const seen=new Set();
  const joined=[];
  for(const group of Array.isArray(joinedGroups)?joinedGroups:[]){
    const username=telegramPublicUsername(group?.link);
    if(!username||seen.has(username.toLowerCase()))continue;
    seen.add(username.toLowerCase());
    joined.push({username,title:String(group?.name||'').slice(0,180)});
  }
  const joinedSteps=[];
  for(let index=0;index<joined.length;index+=JOINED_GROUPS_PER_STEP){
    joinedSteps.push({kind:'joined',groups:joined.slice(index,index+JOINED_GROUPS_PER_STEP)});
  }
  const steps=[];
  for(let index=0;index<Math.max(searches.length,joinedSteps.length);index++){
    if(searches[index])steps.push(searches[index]);
    if(joinedSteps[index])steps.push(joinedSteps[index]);
  }
  return steps;
}

// Source text for the Work OS preview: one entry per scanned Telegram group that posted WhatsApp invites.
export function telegramGroupSource(scan,{query='',place=''}={}){
  if(!scan||!Array.isArray(scan.invites)||!scan.invites.length||!scan.username)return null;
  const title=String(scan.title||scan.username).slice(0,180);
  return {
    sourceUrl:'https://t.me/'+scan.username,
    sourceTitle:title,
    query:String(query||('Telegram · '+title)).slice(0,500),
    seedLabel:String(place||title).slice(0,180),
    context:title,
    text:scan.invites.map(invite=>String(invite.text||'')+'\n'+String(invite.link||'')).join('\n\n').slice(0,45000),
  };
}
