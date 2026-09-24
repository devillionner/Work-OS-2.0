import { BULK_MAX_ITEMS, normalizeGroupLink, type BulkInput } from './bulk-input.ts';
import type { BulkPreviewItem } from './bulk.ts';

const BATCH_BODY_BUDGET=200_000;

export function splitBulkBatches(items:BulkInput[]):BulkInput[][] {
  const batches:BulkInput[][]=[];
  let current:BulkInput[]=[];
  for(const item of items) {
    const candidate=[...current,item];
    const bytes=new TextEncoder().encode(JSON.stringify({action:'preview',items:candidate})).byteLength;
    if(current.length&&(current.length>=BULK_MAX_ITEMS||bytes>BATCH_BODY_BUDGET)) {
      batches.push(current);
      current=[item];
    } else current=candidate;
  }
  if(current.length)batches.push(current);
  return batches;
}

export function markCrossBatchDuplicates(items:BulkPreviewItem[]):BulkPreviewItem[] {
  const seen=new Set<string>();
  return items.map(item=>{
    const normalized=normalizeGroupLink(item.link);
    if(!normalized)return item;
    if(seen.has(normalized.link))return {...item,link:normalized.link,platform:normalized.platform,status:'duplicate'};
    seen.add(normalized.link);
    return item;
  });
}

export function mergeBulkResults(results:Array<{added:number;counts:Record<string,number>|undefined}>) {
  const counts:Record<string,number>={};
  let added=0;
  for(const result of results) {
    added+=result.added;
    for(const [platform,count] of Object.entries(result.counts||{}))counts[platform]=(counts[platform]||0)+Number(count||0);
  }
  return {added,counts};
}
