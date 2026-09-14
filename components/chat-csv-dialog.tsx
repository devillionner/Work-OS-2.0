'use client';

import { useRef, useState } from 'react';
import { Download, LoaderCircle, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type Platform='telegram'|'whatsapp'|'viber'|'facebook';
type Preview={
  revision:number;total:number;add:number;existing:number;conflicts:string[];
  byPlatform:Record<Platform,{total:number;add:number;existing:number}>;
};
const labels:Record<Platform,string>={telegram:'Telegram',whatsapp:'WhatsApp',viber:'Viber',facebook:'Facebook'};

export function ChatCsvDialog({open,onClose,onImported}:{open:boolean;onClose:()=>void;onImported:()=>void}){
  const inputRef=useRef<HTMLInputElement>(null);
  const [csv,setCsv]=useState('');
  const [fileName,setFileName]=useState('');
  const [preview,setPreview]=useState<Preview|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');

  function resetImport(){setCsv('');setFileName('');setPreview(null);setError('');setNotice('');if(inputRef.current)inputRef.current.value='';}
  function close(){if(busy)return;resetImport();onClose();}
  async function choose(file:File|null){
    resetImport();if(!file)return;
    setFileName(file.name);
    try{setCsv(await file.text());}catch{setError('Не вдалося прочитати CSV-файл.');}
  }
  async function request(mode:'preview'|'apply'){
    if(!csv)return null;
    setBusy(true);setError('');setNotice('');
    try{
      const suffix=mode==='apply'&&preview?`&revision=${encodeURIComponent(String(preview.revision))}`:'';
      const response=await fetch(`/api/chats/csv?mode=${mode}${suffix}`,{method:'POST',headers:{'Content-Type':'text/csv; charset=utf-8'},body:csv});
      const body=await response.json() as Preview&{error?:string;inserted?:number};
      if(!response.ok)throw new Error(body.error||'Не вдалося обробити CSV.');
      if(mode==='preview'){setPreview(body);return body;}
      setNotice(`Імпорт завершено: додано ${body.inserted||0} чатів.`);setPreview(null);onImported();return body;
    }catch(reason){setError(reason instanceof Error?reason.message:'Не вдалося обробити CSV.');if(mode==='apply')setPreview(null);return null;}
    finally{setBusy(false);}
  }
  async function download(){
    setBusy(true);setError('');setNotice('');
    try{
      const response=await fetch('/api/chats/csv',{cache:'no-store'});
      if(!response.ok){const body=await response.json() as {error?:string};throw new Error(body.error||'Не вдалося експортувати CSV.');}
      const blob=await response.blob();
      const disposition=response.headers.get('content-disposition')||'';
      const match=/filename="([^"]+)"/.exec(disposition);
      const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=match?.[1]||'work-os-chats.csv';document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
      setNotice('CSV експортовано.');
    }catch(reason){setError(reason instanceof Error?reason.message:'Не вдалося експортувати CSV.');}
    finally{setBusy(false);}
  }
  return <Dialog open={open} onOpenChange={next=>{if(!next&&!busy)close();}}><DialogContent className="modal-card chat-csv-dialog" showCloseButton={false}>
      <DialogHeader><p className="eyebrow">Перенесення чатів</p><DialogTitle>CSV імпорт та експорт</DialogTitle><DialogDescription>CSV переносить поточний стан і профілі чатів. Повна історія подій переноситься лише через резервну копію.</DialogDescription></DialogHeader>
      {error&&<div className="workspace-error" role="alert">{error}</div>}
      {notice&&<output className="reports-notice">{notice}</output>}
      <section className="settings-panel">
        <div className="card-heading"><div><strong>Експорт</strong><p>Зберегти Telegram, WhatsApp, Viber і Facebook разом зі станами, датами та профілями.</p></div><Button variant="outline" disabled={busy} onClick={()=>void download()}>{busy?<LoaderCircle data-icon="inline-start"/>:<Download data-icon="inline-start"/>}Експортувати CSV</Button></div>
      </section>
      <section className="settings-panel">
        <div className="card-heading"><div><strong>Імпорт</strong><p>Існуючі канонічні посилання не перезаписуються. Спочатку обов’язковий preview.</p></div></div>
        <input ref={inputRef} type="file" accept=".csv,text/csv" disabled={busy} aria-label="CSV чатів" onChange={event=>void choose(event.target.files?.[0]||null)}/>
        {fileName&&<p className="muted-note">Обрано: {fileName}</p>}
        <div className="dialog-actions"><Button variant="outline" disabled={busy||!csv} onClick={()=>void request('preview')}><Upload data-icon="inline-start"/>Перевірити CSV</Button>{preview&&<Button disabled={busy||preview.add===0||preview.conflicts.length>0} onClick={()=>void request('apply')}>{busy?'Імпортуємо…':`Імпортувати ${preview.add}`}</Button>}</div>
      </section>
      {preview&&<section className="settings-panel">
        <div className="card-heading"><div><strong>Попередній перегляд</strong><p>{preview.total} рядків · нових {preview.add} · вже існують {preview.existing}</p></div><Badge variant={preview.conflicts.length?'destructive':'secondary'}>{preview.conflicts.length?`${preview.conflicts.length} конфліктів`:'Готово до імпорту'}</Badge></div>
        <div className="settings-stat-row">{(Object.keys(labels) as Platform[]).map(platform=><div key={platform}><span>{labels[platform]}</span><strong>{preview.byPlatform[platform].add}</strong><small>нових із {preview.byPlatform[platform].total}</small></div>)}</div>
        {preview.conflicts.length>0&&<div className="workspace-error" role="alert"><strong>Спочатку виправте конфлікти:</strong><ul>{preview.conflicts.slice(0,20).map(item=><li key={item}>{item}</li>)}</ul>{preview.conflicts.length>20&&<p>Ще {preview.conflicts.length-20} конфліктів.</p>}</div>}
      </section>}
    </DialogContent></Dialog>;
}
