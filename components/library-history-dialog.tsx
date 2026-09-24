'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { WorkspaceInlineLoading } from '@/components/workspace-load-state';

type Version={
  id:string;versionNumber:number;action:'create'|'update'|'archive'|'restore';collection:string;title:string;
  ukText:string;ruText:string;notes:string;tags:string[];platforms:string[];archivedAt:number|null;savedAt:number;
};
type ItemRef={id:string;title:string}|null;
const actions:Record<string,string>={create:'Створено',update:'Оновлено',archive:'Архівовано',restore:'Відновлено'};
const collections:Record<string,string>={advertisement:'Оголошення',official_script:'Офіційний скрипт',personal_script:'Особистий скрипт',knowledge:'База знань'};

export function LibraryHistoryDialog({open,item,onClose,finalFocus}:{open:boolean;item:ItemRef;onClose:()=>void;finalFocus?:()=>HTMLElement|null}){
  const [versions,setVersions]=useState<Version[]>([]);
  const [loading,setLoading]=useState(false);
  const [loadedId,setLoadedId]=useState('');
  const [error,setError]=useState('');
  const cache=useRef(new Map<string,Version[]>());
  useEffect(()=>{
    if(!open||!item)return;
    const controller=new AbortController();
    const cached=cache.current.get(item.id);
    queueMicrotask(()=>{setLoading(true);setError('');if(cached){setVersions(cached);setLoadedId(item.id);}else setLoadedId('');});
    fetch(`/api/library/history?id=${encodeURIComponent(item.id)}`,{cache:'no-store',signal:controller.signal})
      .then(async response=>{const body=await response.json() as {versions?:Version[];error?:string};if(!response.ok)throw new Error(body.error||'Не вдалося завантажити історію.');const next=body.versions||[];cache.current.set(item.id,next);setVersions(next);setLoadedId(item.id);})
      .catch(reason=>{if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:'Не вдалося завантажити історію.');})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[open,item]);
  const viewReady=Boolean(item)&&loadedId===item.id;
  return <Dialog open={open} onOpenChange={next=>{if(!next&&!loading)onClose();}}><DialogContent className="library-history-dialog" finalFocus={finalFocus}>
    <DialogHeader><DialogTitle>Історія матеріалу</DialogTitle><DialogDescription>{item?.title}</DialogDescription></DialogHeader>
    {error&&<div className="workspace-error" role="alert">{error}</div>}
    {loading&&!viewReady?<WorkspaceInlineLoading label="Завантажуємо версії…"/>:<>{loading&&viewReady?<WorkspaceInlineLoading label="Оновлюємо версії…"/>:null}{viewReady&&versions.length?<ol className="chat-history-list">{versions.map(version=><li key={version.id}>
      <div><strong>v{version.versionNumber} · {actions[version.action]||version.action}</strong><span> · {collections[version.collection]||version.collection}</span>{version.title!==item?.title&&<small> · {version.title}</small>}
        <details><summary>Показати збережену версію</summary>{version.notes&&<p>{version.notes}</p>}{version.ukText&&<pre className="lead-preserve">{version.ukText}</pre>}{version.ruText&&<pre className="lead-preserve">{version.ruText}</pre>}<small>Теги: {version.tags.join(', ')||'—'} · Платформи: {version.platforms.join(', ')||'—'}</small></details>
      </div><time dateTime={new Date(version.savedAt*1000).toISOString()}>{new Intl.DateTimeFormat('uk-UA',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Kyiv'}).format(new Date(version.savedAt*1000))}</time>
    </li>)}</ol>:viewReady?<p className="muted-note">Історія ще порожня.</p>:null}</>}
    <div className="dialog-actions"><Button variant="outline" onClick={onClose} disabled={loading}>Закрити</Button></div>
  </DialogContent></Dialog>;
}
