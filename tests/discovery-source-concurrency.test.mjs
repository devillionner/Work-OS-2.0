import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../scripts/chat-discovery-source-crawl.mjs',import.meta.url),'utf8');
const loadModule=code=>import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
test('parallel source jobs honor one provider rate-limit response',async()=>{
 const m=await loadModule(source);
 let requests=0;
 const fetcher=async url=>{
   if(url.includes('search.brave.com')){requests++;return new Response('limited',{status:429});}
   return new Response('<html>No matches</html>');
 };
 const seedData={cities:[{country:'Німеччина',name:'Berlin',uk:'Берлін'}],keywords:['назва міста чат']};
 const results=await Promise.all([15,16,17].map(cursor=>m.crawlLocalDiscoverySource(cursor,{fetcher,seedData})));
 assert.equal(requests,1);
 assert.ok(results.every(r=>r.warnings.some(w=>/search_rate_limited|source_http_429|search_cooldown/.test(w.reason))));
});
