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

void test('Discovery candidate priority matches whole words in Cyrillic and Latin',()=>{
  const boost=cookedRegexAround('famil|');
  assert.equal(boost.test('Українці Берлін чат'),true);
  assert.equal(boost.test('WhatsApp chat Bremen'),true);
  assert.equal(boost.test('Чат, оголошення'),true);
  assert.equal(boost.test('chatbot'),false);

  const penalty=cookedRegexAround('майстер клас|');
  assert.equal(penalty.test('IT & Business Ukraine'),true);
  assert.equal(penalty.test('it&business'),true);
  assert.equal(penalty.test('Українське кафе'),true);
  assert.equal(penalty.test('Café Kyiv'),true);
  assert.equal(penalty.test('кафедра'),false);
});

void test('legacy Brave stop recovery matches only the Brave host literally',()=>{
  const brave=cookedRegexAround('search_rate_limited');
  assert.equal(brave.test('search.brave.com HTTP 429'),true);
  assert.equal(brave.test('searchXbraveYcom'),false);
});
