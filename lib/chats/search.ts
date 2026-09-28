import { normalizeUnicodeSearchText, unicodeSearchIncludes } from '../unicode-search.ts';

export function normalizeChatSearchText(value:string){
  return normalizeUnicodeSearchText(value);
}

export function chatMatchesSearch(name:string,link:string,query:string){
  return unicodeSearchIncludes(name,query)||unicodeSearchIncludes(link,query);
}
