import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../scripts/chat-discovery-source-crawl.mjs',import.meta.url),'utf8');
const adapter=readFileSync(new URL('../scripts/whatsapp-web-cdp.mjs',import.meta.url),'utf8');
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
test('source handoff preserves latest retry checkpoint and exposes warnings',async()=>{
 const m=await loadModule(adapter);
 const key='work-os:chat-discovery-local-preview:v3';
 const storage=new Map([[key,JSON.stringify({running:true,runId:'r',candidates:[{id:'a',platform:'whatsapp',link:'https://chat.whatsapp.com/abcdefgh',preflightState:'queued',discoveryCheckpoint:{attempts:1}}]})]]);
 const sandbox={Date,sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},window:{dispatchEvent(){}},CustomEvent:class{},
   fetch:async()=>{
     const current=JSON.parse(storage.get(key));current.candidates[0].discoveryCheckpoint={attempts:2,result:{membershipState:'joined',groupId:'g@g.us'}};
     storage.set(key,JSON.stringify(current));
     return {ok:true,json:async()=>({batch:{added:1,duplicates:0},previews:[{id:'b',platform:'whatsapp',link:'https://chat.whatsapp.com/ijklmnop',name:'Українці'}]})};
   }
 };
 const oldFetch=globalThis.fetch,oldSocket=globalThis.WebSocket;
 globalThis.fetch=async()=>({ok:true,json:async()=>[{type:'page',url:'https://work.example/',webSocketDebuggerUrl:'ws://127.0.0.1:9222/test'}]});
 globalThis.WebSocket=class extends EventTarget{
   constructor(){super();queueMicrotask(()=>this.dispatchEvent(new Event('open')));}
   send(raw){const message=JSON.parse(raw);Promise.resolve(vm.runInNewContext(message.params.expression,sandbox)).then(value=>{
     const event=new Event('message');event.data=JSON.stringify({id:message.id,result:{result:{value}}});this.dispatchEvent(event);
   });}
   close(){}
 };
 try{
   const result=await m.applyWorkOsLocalDiscoverySourceBatchViaCdp('https://work.example',{
     nextCursor:18,searched:3,done:false,totalTasks:100,errors:[],
     warnings:[{query:'Берлін',reason:'optional_web_search_deferred · search_rate_limited'}],
     sources:[{sourceUrl:'https://t.me/s/example',text:'Українці https://chat.whatsapp.com/ijklmnop'}],
   },{cdpBaseUrl:'http://127.0.0.1:9222',expectedRunId:'r'});
   assert.equal(result.kind,'result');
   const state=JSON.parse(storage.get(key));
   assert.equal(state.candidates.length,2);
   assert.equal(state.candidates[0].discoveryCheckpoint.attempts,2);
   assert.equal(state.candidates[0].discoveryCheckpoint.result.membershipState,'joined');
   assert.equal(state.sourceFailures,0);
   assert.ok(state.sourceIssues[0].reason.includes('search_rate_limited'));
 }finally{globalThis.fetch=oldFetch;globalThis.WebSocket=oldSocket;}
});
