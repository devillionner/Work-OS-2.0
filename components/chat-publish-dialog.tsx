'use client';

import { useEffect, useMemo, useState } from 'react';
import { Copy, ExternalLink, LoaderCircle, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { ChatProfile } from '@/lib/chats/profile';

type PublishChat = { id:string; name:string; link:string; platform:string; profileConfirmed:boolean; profile:ChatProfile };
type PublicationDetails = { advertisementId:string|null; language:'uk'|'ru'|null };
type AdvertisementItem = {
  id:string; title:string; ukText:string; ruText:string; notes:string; tags:string[]; platforms:string[];
  suggestedLanguage:'uk'|'ru'|null; usedToday:boolean; selectable:boolean; recommended:boolean;
  directionMatch:'matched'|'generic'|'other'; note:string|null;
};
type SelectionPayload = { items:AdvertisementItem[]; error?:string };

export function ChatPublishDialog({open,chat,onClose,onPublished,onOpenChat}:{open:boolean;chat:PublishChat|null;onClose:()=>void;onPublished:(details:PublicationDetails)=>Promise<boolean>;onOpenChat:()=>void}) {
  const [items,setItems]=useState<AdvertisementItem[]>([]);
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [language,setLanguage]=useState<'uk'|'ru'>(chat?.profile.language==='ru'?'ru':'uk');
  const [search,setSearch]=useState('');
  const [loading,setLoading]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const chatId=chat?.id;
  const chatLanguage=chat?.profile.language;

  useEffect(()=>{
    if(!open||!chatId)return;
    let cancelled=false;
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),30_000);
    queueMicrotask(()=>{
      if(!cancelled){
        setLoading(true);setBusy(false);setError('');setNotice('');setItems([]);setSelectedId(null);setSearch('');setLanguage(chatLanguage==='ru'?'ru':'uk');
      }
    });
    fetch(`/api/chats/advertisements?chatId=${encodeURIComponent(chatId)}`,{cache:'no-store',signal:controller.signal})
      .then(async response=>{
        const value:unknown=await response.json();
        if(!response.ok)throw new Error(value&&typeof value==='object'&&'error' in value&&typeof value.error==='string'?value.error:'Не вдалося підібрати оголошення.');
        if(!value||typeof value!=='object'||!Array.isArray((value as SelectionPayload).items))throw new Error('Не вдалося прочитати підбір оголошень.');
        if(!cancelled)setItems((value as SelectionPayload).items);
      })
      .catch(reason=>{
        if(!cancelled)setError(reason instanceof Error&&reason.name!=='AbortError'&&reason.name!=='TypeError'?reason.message:'Не вдалося підібрати оголошення. Перевірте з’єднання.');
      })
      .finally(()=>{clearTimeout(timeout);if(!cancelled)setLoading(false);});
    return()=>{cancelled=true;controller.abort();clearTimeout(timeout);};
  },[open,chatId,chatLanguage]);

  const visible=useMemo(()=>{
    const needle=search.trim().toLocaleLowerCase('uk-UA');
    if(!needle)return items;
    return items.filter(item=>`${item.title} ${item.ukText} ${item.ruText} ${item.notes} ${item.tags.join(' ')}`.toLocaleLowerCase('uk-UA').includes(needle));
  },[items,search]);
  const selected=items.find(item=>item.id===selectedId)||null;
  const text=selected?(language==='ru'?selected.ruText||selected.ukText:selected.ukText||selected.ruText):'';
  const publicationLanguage=selected?(language==='ru'&&selected.ruText?'ru':selected.ukText?'uk':selected.ruText?'ru':null):null;

  function selectItem(item:AdvertisementItem){
    if(!item.selectable)return;
    setSelectedId(item.id);
    if(item.suggestedLanguage)setLanguage(item.suggestedLanguage);
    setNotice(item.note||'');
  }
  async function copyText(){
    if(!text)return;
    try{await navigator.clipboard.writeText(text);setNotice('Текст скопійовано.');}
    catch{setError('Не вдалося скопіювати текст. Виділіть його та скопіюйте вручну.');}
  }
  async function publish(){
    if(!chat||busy)return;
    setBusy(true);setError('');
    try{if(await onPublished({advertisementId:selectedId,language:publicationLanguage}))onClose();}
    catch(reason){setError(reason instanceof Error?reason.message:'Не вдалося відмітити публікацію. Оновіть список і спробуйте ще раз.');}
    finally{setBusy(false);}
  }

  return <Dialog open={open} onOpenChange={next=>{if(!next&&!busy)onClose();}}>
    <DialogContent className="chat-publish-dialog" showCloseButton={false}>
      <DialogHeader>
        <DialogTitle>Підготувати публікацію</DialogTitle>
        <DialogDescription>{chat?.name} · Work OS ставить невикористані придатні оголошення першими, але публікацію ви робите вручну.</DialogDescription>
      </DialogHeader>
      <Button className="chat-publish-close" variant="ghost" size="icon" aria-label="Закрити" disabled={busy} onClick={onClose}><X/></Button>
      {error&&<div className="workspace-error" role="alert">{error}</div>}
      {notice&&<output className="reports-notice">{notice}</output>}
      {chat&&<>
        <div className="chat-publish-chat"><strong>{chat.name}</strong><span>{chat.link}</span><Button type="button" variant="outline" size="sm" disabled={busy} onClick={onOpenChat}><ExternalLink data-icon="inline-start"/>Відкрити чат</Button></div>
        {!chat.profileConfirmed&&<output className="chat-publish-warning">Профіль чату ще не підтверджено. Work OS врахує платформу та історію використання, але не застосовуватиме напрямки профілю як перевірене правило.</output>}
        <label className="chat-publish-search" htmlFor="chat-publish-search">Матеріал<Input id="chat-publish-search" value={search} disabled={busy} onChange={event=>setSearch(event.target.value)} placeholder="Пошук оголошення…" /></label>
        {loading?<p className="workspace-loading"><LoaderCircle/>Підбираємо матеріали…</p>:visible.length?<div className="chat-publish-items" aria-label="Оголошення">{visible.map(item=><button type="button" aria-pressed={selectedId===item.id} className={selectedId===item.id?'is-selected':''} disabled={busy||!item.selectable} key={item.id} onClick={()=>selectItem(item)}><strong>{item.title}</strong><small>{item.ukText||item.ruText}</small><small className="muted-note">{item.recommended?'Рекомендовано · ':''}{item.usedToday?'Використано сьогодні · ':''}{item.directionMatch==='matched'?'Напрямок збігається':item.directionMatch==='other'?'Інший напрямок':'Без жорсткої прив’язки до напрямку'}</small>{item.note&&<small className="muted-note">{item.note}</small>}</button>)}</div>:<p className="muted-note">Придатних активних оголошень для цієї платформи не знайдено. Публікацію все ще можна відмітити без прив’язаного матеріалу.</p>}
        {selected&&<section className="chat-publish-preview"><div className="chat-publish-preview-head"><strong>{selected.title}</strong><div className="chat-publish-language"><Button type="button" variant="outline" size="sm" aria-pressed={language==='uk'} disabled={busy||!selected.ukText} onClick={()=>setLanguage('uk')}>UA</Button><Button type="button" variant="outline" size="sm" aria-pressed={language==='ru'} disabled={busy||!selected.ruText} onClick={()=>setLanguage('ru')}>RU</Button></div></div><Textarea readOnly rows={8} value={text} aria-label="Текст оголошення"/><div className="chat-publish-preview-actions"><Button type="button" variant="outline" size="sm" disabled={busy||!text} onClick={()=>void copyText()}><Copy data-icon="inline-start"/>Скопіювати текст</Button></div></section>}
        <div className="dialog-actions"><Button variant="outline" disabled={busy} onClick={onClose}>Скасувати</Button><Button disabled={busy} onClick={()=>void publish()}><Send data-icon="inline-start"/>{busy?'Зберігаємо…':selected?'Відмітити публікацію':'Відмітити без матеріалу'}</Button></div>
      </>}
    </DialogContent>
  </Dialog>;
}