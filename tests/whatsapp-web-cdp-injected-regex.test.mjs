import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const path=new URL('../scripts/whatsapp-web-cdp.mjs',import.meta.url);
const source=readFileSync(path,'utf8');
const file=ts.createSourceFile('whatsapp-web-cdp.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);

function templateParts(){
  const parts=[];
  const visit=(node)=>{
    if(ts.isNoSubstitutionTemplateLiteral(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node)){
      parts.push({raw:node.rawText??'',cooked:node.text,line:file.getLineAndCharacterOfPosition(node.getStart()).line+1});
    }
    ts.forEachChild(node,visit);
  };
  visit(file);
  return parts;
}

// Code injected into the WhatsApp/Work OS tab is built from template literals, so a single
// backslash is consumed by the template itself: `\s` becomes `s` and `\b` becomes backspace.
void test('template literals sent through CDP keep regex escapes',()=>{
  const lossy=[];
  for(const part of templateParts()){
    for(const match of part.raw.matchAll(/\\(.)/gsu)){
      if(!/[\\`$'"nrtu0\n]/u.test(match[1]))lossy.push(`${part.line}: \\${match[1]}`);
    }
  }
  assert.deepEqual(lossy,[]);
});

function cookedRegexAround(marker){
  const part=templateParts().find(item=>item.cooked.includes(marker));
  assert.ok(part,`template with ${marker}`);
  const line=part.cooked.split('\n').find(item=>item.includes(marker));
  const literal=line.match(/\/\(\?:.*?\)\/iu/u)?.[0];
  assert.ok(literal,`regex near ${marker}`);
  return new Function(`return ${literal};`)();
}

// The candidate priority moved from CDP-injected page JS into lib/chat-discovery/run-state.ts (2026-10-04);
// checked through the dispatcher's real ordering instead of extracting the regex literal.
void test('Discovery candidate priority matches whole words in Cyrillic and Latin',async()=>{
  const { EMPTY_RUN, nextCandidateTask } = await import('../lib/chat-discovery/run-state.ts');
  const candidate=(id,name)=>({ id, platform:'whatsapp', name, link:`https://chat.whatsapp.com/${id}`, localOnly:true, sources:[], preflightState:'queued' });
  const first=(a,b)=>nextCandidateTask({ ...EMPTY_RUN, runId:'r', running:true, candidates:[candidate('a',a),candidate('b',b)] },0).task.name;
  assert.equal(first('Bremen info','WhatsApp chat Bremen'),'WhatsApp chat Bremen','"chat" as a whole word boosts');
  assert.equal(first('Чат, оголошення','Новини'),'Чат, оголошення');
  assert.equal(first('chatbot Bremen','Bremen info x'),'chatbot Bremen','"chatbot" is not the word "chat" (equal score keeps order)');
  assert.equal(first('Українське кафе','Українська громада'),'Українська громада','"кафе" as a whole word is penalised');
  assert.equal(first('Café Kyiv','Kyiv'),'Kyiv');
  assert.equal(first('кафедра Київ','Київ'),'кафедра Київ','"кафедра" is not "кафе" (equal score keeps order)');
  assert.equal(first('IT & Business Ukraine','Ukraine'),'Ukraine');
});

