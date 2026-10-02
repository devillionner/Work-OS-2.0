'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, ExternalLink, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { ChatProfile } from '@/lib/chats/profile';
import { WorkspaceInlineLoading } from '@/components/workspace-load-state';

type PublishChat = { id:string; name:string; link:string; platform:string; profileConfirmed:boolean; profile:ChatProfile };
type PublicationDetails = { advertisementId:string|null; language:'uk'|'ru'|null };
type AdvertisementItem = {
  id:string; title:string; ukText:string; ruText:string; notes:string; tags:string[]; platforms:string[];
  suggestedLanguage:'uk'|'ru'|null; usedToday:boolean; selectable:boolean; recommended:boolean;
  directionMatch:'matched'|'generic'|'other'; note:string|null;
};
type FocusPlan = { currentDirections:string[]; planDirections:string[]; planCreatedAt:number; currentFocusUpdatedAt:number; stale:boolean; addedDirections:string[]; removedDirections:string[]; source:'workday'|'current-focus'; workday:{id:string;workDate:string;version:number}|null };
type SelectionPayload = { items:AdvertisementItem[]; publicationAllowed:boolean; publicationReason:string|null; focusPlan:FocusPlan; error?:string };

export function ChatPublishDialog({open,chat,onClose,onPublished,onOpenChat,finalFocus,quickMode=false,preferredAdvertisementId=null}:{open:boolean;chat:PublishChat|null;onClose:()=>void;onPublished:(details:PublicationDetails)=>Promise<boolean>;onOpenChat:()=>void;finalFocus?:()=>HTMLElement|null;quickMode?:boolean;preferredAdvertisementId?:string|null}) {
  const [items,setItems]=useState<AdvertisementItem[]>([]);
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [language,setLanguage]=useState<'uk'|'ru'>(chat?.profile.language==='ru'?'ru':'uk');
  const [search,setSearch]=useState('');
  const [loading,setLoading]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [publicationRule,setPublicationRule]=useState<{allowed:boolean;reason:string|null}>({allowed:true,reason:null});
  const [focusPlan,setFocusPlan]=useState<FocusPlan|null>(null);
  const [focusDecision,setFocusDecision]=useState<'kept'|'refreshed'|null>(null);
  const selectionCache=useRef(new Map<string,SelectionPayload>());
  const chatId=chat?.id;
  const chatLanguage=chat?.profile.language;

  useEffect(()=>{
    if(!open||!chatId)return;
    let cancelled=false;
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),30_000);
    const applySelection=(payload:SelectionPayload)=>{
      setItems(payload.items);
      setPublicationRule({allowed:payload.publicationAllowed!==false,reason:payload.publicationReason||null});
      setFocusPlan(payload.focusPlan||null);
      setSelectedId(current=>{
        if(current&&payload.items.some(item=>item.id===current&&item.selectable))return current;
        if(quickMode&&preferredAdvertisementId){
          const preferred=payload.items.find(item=>item.id===preferredAdvertisementId);
          return preferred?.selectable?preferred.id:null;
        }
        return null;
      });
      if(quickMode&&preferredAdvertisementId){
        const preferred=payload.items.find(item=>item.id===preferredAdvertisementId);
        if(preferred?.selectable){
          setLanguage(preferred.suggestedLanguage||(chatLanguage==='ru'?'ru':'uk'));
          setNotice('Матеріал швидкого режиму підставлено автоматично.');
        } else setNotice('Матеріал швидкого режиму не підходить цьому чату за відомими правилами. Пропустіть чат або завершіть швидкий режим.');
      }
    };
    const cached=selectionCache.current.get(chatId);
    queueMicrotask(()=>{
      if(cancelled)return;
      setLoading(true);setBusy(false);setError('');setNotice('');setSelectedId(null);setSearch('');setLanguage(chatLanguage==='ru'?'ru':'uk');setFocusDecision(null);
      if(cached)applySelection(cached);
      else {setItems([]);setPublicationRule({allowed:true,reason:null});setFocusPlan(null);}
    });
    fetch(`/api/chats/advertisements?chatId=${encodeURIComponent(chatId)}`,{cache:'no-store',signal:controller.signal})
      .then(async response=>{
        const value:unknown=await response.json();
        if(!response.ok)throw new Error(value&&typeof value==='object'&&'error' in value&&typeof value.error==='string'?value.error:'Не вдалося підібрати оголошення.');
        if(!value||typeof value!=='object'||!Array.isArray((value as SelectionPayload).items))throw new Error('Не вдалося прочитати підбір оголошень.');
        if(!cancelled){
          const payload=value as SelectionPayload;
          selectionCache.current.set(chatId,payload);
          applySelection(payload);
        }
      })
      .catch(reason=>{
        if(!cancelled)setError(reason instanceof Error&&reason.name!=='AbortError'&&reason.name!=='TypeError'?reason.message:'Не вдалося підібрати оголошення. Перевірте з’єднання.');
      })
      .finally(()=>{clearTimeout(timeout);if(!cancelled)setLoading(false);});
    return()=>{cancelled=true;controller.abort();clearTimeout(timeout);};
  },[open,chatId,chatLanguage,quickMode,preferredAdvertisementId]);

  const visible=useMemo(()=>{
    const candidates=quickMode&&preferredAdvertisementId?items.filter(item=>item.id===preferredAdvertisementId):items;
    const needle=search.trim().toLocaleLowerCase('uk-UA');
    if(!needle)return candidates;
    return candidates.filter(item=>`${item.title} ${item.ukText} ${item.ruText} ${item.notes} ${item.tags.join(' ')}`.toLocaleLowerCase('uk-UA').includes(needle));
  },[items,search,quickMode,preferredAdvertisementId]);
  const selected=items.find(item=>item.id===selectedId)||null;
  const text=selected?(language==='ru'?selected.ruText||selected.ukText:selected.ukText||selected.ruText):'';
  const publicationLanguage=selected?(language==='ru'&&selected.ruText?'ru':selected.ukText?'uk':selected.ruText?'ru':null):null;
  const profileRequired=Boolean(chat&&!chat.profileConfirmed&&!quickMode&&chat.platform==='telegram');

  function selectItem(item:AdvertisementItem){
    if(!item.selectable)return;
    setSelectedId(item.id);
    if(item.suggestedLanguage)setLanguage(item.suggestedLanguage);
    setNotice(item.note||'');
  }
  async function refreshFocusPlan(){
    if(!chat||!focusPlan?.workday||busy)return;
    setBusy(true);setError('');
    try{
      const workday=focusPlan.workday;
      const response=await fetch('/api/workday',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'refresh-plan',id:workday.id,workDate:workday.workDate,expectedVersion:workday.version})});
      const body:unknown=await response.json();
      if(!response.ok)throw new Error(body&&typeof body==='object'&&'error' in body&&typeof body.error==='string'?body.error:'Не вдалося оновити план дня.');
      const selectionResponse=await fetch(`/api/chats/advertisements?chatId=${encodeURIComponent(chat.id)}`,{cache:'no-store'});
      const selectionValue:unknown=await selectionResponse.json();
      if(!selectionResponse.ok||!selectionValue||typeof selectionValue!=='object'||!Array.isArray((selectionValue as SelectionPayload).items))throw new Error('План оновлено, але не вдалося перечитати підбір. Відкрийте діалог ще раз.');
      const payload=selectionValue as SelectionPayload;
      setItems(payload.items);setFocusPlan(payload.focusPlan);setPublicationRule({allowed:payload.publicationAllowed!==false,reason:payload.publicationReason||null});
      setSelectedId(null);setFocusDecision('refreshed');setNotice('Невиконану частину плану оновлено під поточний фокус. Уже опубліковані пункти не змінено.');
    }catch(reason){setError(reason instanceof Error?reason.message:'Не вдалося оновити план дня.');}
    finally{setBusy(false);}
  }
  async function copyText(){
    if(!text)return;
    try{await navigator.clipboard.writeText(text);setNotice('Текст скопійовано.');}
    catch{setError('Не вдалося скопіювати текст. Виділіть його та скопіюйте вручну.');}
  }
  async function publish(){
    if(!chat||busy||profileRequired||!publicationRule.allowed||(quickMode&&!selectedId))return;
    setBusy(true);setError('');
    try{if(await onPublished({advertisementId:selectedId,language:publicationLanguage}))onClose();}
    catch(reason){setError(reason instanceof Error?reason.message:'Не вдалося відмітити публікацію. Оновіть список і спробуйте ще раз.');}
    finally{setBusy(false);}
  }

  return <Dialog open={open} onOpenChange={next=>{if(!next&&!busy)onClose();}}>
    <DialogContent className="chat-publish-dialog" showCloseButton={false} finalFocus={finalFocus}>
      <DialogHeader>
        <DialogTitle>{quickMode?'Швидка публікація':'Підготувати публікацію'}</DialogTitle>
        <DialogDescription>{chat?.name} · {quickMode?'Матеріал обирається один раз для серії WhatsApp/Viber, а фактичну публікацію ви підтверджуєте для кожного чату вручну.':'Work OS ставить невикористані придатні оголошення першими, але публікацію ви робите вручну.'}</DialogDescription>
      </DialogHeader>
      <Button className="chat-publish-close" variant="ghost" size="icon" aria-label="Закрити" disabled={busy} onClick={onClose}><X/></Button>
      {error&&<div className="workspace-error" role="alert">{error}</div>}
      {notice&&<output className="reports-notice">{notice}</output>}
      {chat&&<>
        <div className="chat-publish-chat"><strong>{chat.name}</strong><span>{chat.link}</span><Button type="button" variant="outline" size="sm" disabled={busy} onClick={onOpenChat}><ExternalLink data-icon="inline-start"/>Відкрити чат</Button></div>
        {!chat.profileConfirmed&&chat.platform==='telegram'&&<output className="chat-publish-warning">{quickMode?'Профіль чату ще не підтверджено. Швидкий режим дозволяє термінову ручну публікацію без автоматичного підтвердження правил; чат залишиться в черзі уточнення профілю.':'Звичайна публікація потребує підтвердженого профілю. Закрийте це вікно й уточніть правила чату або для WhatsApp/Viber свідомо увімкніть швидкий режим.'}</output>}
        {focusPlan&&<section className="chat-publish-focus" aria-label="Фокус підбору">
          <div><strong>Активний фокус</strong><span>{focusPlan.currentDirections.length?focusPlan.currentDirections.join(' · '):'Без обмеження напрямків'}</span></div>
          <div><strong>Поточний план</strong><span>{focusPlan.planDirections.length?focusPlan.planDirections.join(' · '):'Без обмеження напрямків'}</span><small>{focusPlan.planCreatedAt?`${focusPlan.source==='workday'?'Створено / оновлено':'Оновлено'} ${new Date(focusPlan.planCreatedAt*1000).toLocaleString('uk-UA')}`:'Ще не зафіксовано'}</small></div>
          {focusPlan.stale&&<div className="chat-publish-focus-stale"><output className="chat-publish-warning">План застарів після зміни фокусу.{focusPlan.addedDirections.length?` Додано: ${focusPlan.addedDirections.join(', ')}.`:''}{focusPlan.removedDirections.length?` Прибрано: ${focusPlan.removedDirections.join(', ')}.`:''} Уже опубліковані пункти залишаться без змін.</output>{focusDecision==='kept'?<small>Поточний план свідомо залишено без змін для цього сеансу.</small>:<div className="chat-publish-focus-actions">{focusPlan.workday&&<Button type="button" size="sm" disabled={busy} onClick={()=>void refreshFocusPlan()}>Оновити невиконану частину</Button>}<Button type="button" variant="outline" size="sm" disabled={busy} onClick={()=>{setFocusDecision('kept');setNotice('Поточний план залишено без змін.');}}>Залишити поточний</Button></div>}</div>}
        </section>}
        {!publicationRule.allowed&&<output className="chat-publish-warning">Публікація зараз недоступна: {publicationRule.reason||'правила профілю не дозволяють публікацію на цю дату.'}</output>}
        {quickMode&&preferredAdvertisementId&&!loading&&!selected&&<output className="chat-publish-warning">Зафіксований матеріал швидкого режиму тут недоступний. Чат не буде позначено опублікованим без цього матеріалу.</output>}
        {quickMode&&preferredAdvertisementId?<div className="chat-publish-locked-material"><strong>Матеріал швидкого режиму</strong><span>Зафіксовано після першої публікації. Для цього чату перевіряються його відомі правила.</span></div>:<label className="chat-publish-search" htmlFor="chat-publish-search">Матеріал<Input id="chat-publish-search" value={search} disabled={busy} onChange={event=>setSearch(event.target.value)} placeholder="Пошук оголошення…" /></label>}
        {loading&&!items.length?<WorkspaceInlineLoading label="Підбираємо матеріали…"/>:<>{loading&&items.length?<WorkspaceInlineLoading label="Перевіряємо актуальність матеріалів…"/>:null}{visible.length?<div className="chat-publish-items" aria-label="Оголошення">{visible.map(item=><button type="button" aria-pressed={selectedId===item.id} className={selectedId===item.id?'is-selected':''} disabled={loading||busy||!item.selectable} key={item.id} onClick={()=>selectItem(item)}><strong>{item.title}</strong><small>{item.ukText||item.ruText}</small><small className="muted-note">{item.recommended?'Рекомендовано · ':''}{item.usedToday?'Використано сьогодні · ':''}{item.directionMatch==='matched'?'Напрямок збігається':item.directionMatch==='other'?'Інший напрямок':'Без жорсткої прив’язки до напрямку'}</small>{item.note&&<small className="muted-note">{item.note}</small>}</button>)}</div>:<p className="muted-note">{quickMode?'Для швидкого режиму потрібен придатний активний матеріал. Пропустіть цей чат або завершіть швидкий режим.':'Придатних активних оголошень для цієї платформи не знайдено. Публікацію все ще можна відмітити без прив’язаного матеріалу.'}</p>}</>}
        {selected&&<section className="chat-publish-preview"><div className="chat-publish-preview-head"><strong>{selected.title}</strong><div className="chat-publish-language"><Button type="button" variant="outline" size="sm" aria-pressed={language==='uk'} disabled={busy||!selected.ukText} onClick={()=>setLanguage('uk')}>UA</Button><Button type="button" variant="outline" size="sm" aria-pressed={language==='ru'} disabled={busy||!selected.ruText} onClick={()=>setLanguage('ru')}>RU</Button></div></div><Textarea readOnly rows={8} value={text} aria-label="Текст оголошення"/><div className="chat-publish-preview-actions"><Button type="button" variant="outline" size="sm" disabled={busy||!text} onClick={()=>void copyText()}><Copy data-icon="inline-start"/>Скопіювати текст</Button></div></section>}
        <div className="dialog-actions"><Button variant="outline" disabled={busy} onClick={onClose}>Скасувати</Button><Button disabled={loading||busy||profileRequired||!publicationRule.allowed||(quickMode&&!selected)} onClick={()=>void publish()}><Send data-icon="inline-start"/>{busy?'Зберігаємо…':profileRequired?'Потрібен профіль':selected?'Відмітити публікацію':quickMode?'Оберіть матеріал':'Відмітити без матеріалу'}</Button></div>
      </>}
    </DialogContent>
  </Dialog>;
}