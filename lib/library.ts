export const LIBRARY_COLLECTIONS = ['advertisement','official_script','personal_script','knowledge'] as const;
export type LibraryCollection = (typeof LIBRARY_COLLECTIONS)[number];
export type LibraryKind = 'advertisement'|'script';
export type LibraryAction = 'create'|'update'|'archive'|'restore';

export function isLibraryCollection(value:unknown):value is LibraryCollection {
  return typeof value==='string'&&LIBRARY_COLLECTIONS.includes(value as LibraryCollection);
}
export function libraryKind(collection:LibraryCollection):LibraryKind {
  return collection==='advertisement'?'advertisement':'script';
}
export function defaultCollection(kind:unknown):LibraryCollection {
  return kind==='advertisement'?'advertisement':'personal_script';
}
export function cleanLibraryText(value:unknown,max:number) {
  return typeof value==='string'?Array.from(value.replace(/\p{Cc}/gu,' ').trim().normalize('NFC')).slice(0,max).join(''):'';
}
export function cleanLibraryBody(value:unknown,max:number) {
  return typeof value==='string'?Array.from(value.replace(/\r\n/g,'\n').normalize('NFC')).slice(0,max).join(''):'';
}
export function cleanLibraryList(value:unknown):string[] {
  if(!Array.isArray(value))return [];
  return [...new Set(value.filter((item):item is string=>typeof item==='string').map(item=>cleanLibraryText(item,50)).filter(Boolean))].slice(0,20);
}

export function libraryVersionStatement(db:D1Database,input:{
  userId:string;itemId:string;action:LibraryAction;expectedVersion:number;savedAt:number;
}) {
  return db.prepare(`INSERT INTO library_item_versions
    (id,user_id,item_id,version_number,action,kind,collection,title,uk_text,ru_text,notes,tags_json,platforms_json,archived_at,saved_at)
    SELECT ?1,i.user_id,i.id,i.version,?2,i.kind,i.collection,i.title,i.uk_text,i.ru_text,i.notes,i.tags_json,i.platforms_json,i.archived_at,?3
    FROM library_items i
    WHERE i.id=?4 AND i.user_id=?5 AND i.version=?6 AND changes()=1`)
    .bind(crypto.randomUUID(),input.action,input.savedAt,input.itemId,input.userId,input.expectedVersion);
}
