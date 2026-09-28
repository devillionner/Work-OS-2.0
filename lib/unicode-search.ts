export function normalizeUnicodeSearchText(value:string){
  return String(value||'').normalize('NFKC').toLocaleLowerCase('uk-UA');
}

export function unicodeSearchIncludes(value:string,query:string){
  const normalizedQuery=normalizeUnicodeSearchText(query);
  if(!normalizedQuery)return true;
  return normalizeUnicodeSearchText(value).includes(normalizedQuery);
}

export function unicodeSearchMatchesAny(values:readonly string[],query:string){
  const normalizedQuery=normalizeUnicodeSearchText(query);
  if(!normalizedQuery)return true;
  return values.some(value=>normalizeUnicodeSearchText(value).includes(normalizedQuery));
}
