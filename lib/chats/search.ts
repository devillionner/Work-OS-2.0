export function normalizeChatSearchText(value:string){
  return String(value||'').normalize('NFKC').toLocaleLowerCase('uk-UA');
}

export function chatMatchesSearch(name:string,link:string,query:string){
  const normalizedQuery=normalizeChatSearchText(query);
  if(!normalizedQuery)return true;
  return normalizeChatSearchText(name).includes(normalizedQuery)
    || normalizeChatSearchText(link).includes(normalizedQuery);
}
