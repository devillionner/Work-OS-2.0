'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, BookOpenText, FilePlus2, History, RotateCcw, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { LibraryHistoryDialog } from '@/components/library-history-dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { WorkspaceInitialLoading, WorkspaceRefreshIndicator } from '@/components/workspace-load-state';
import { handleTabKeyNavigation } from '@/lib/tab-navigation';
import {
  LIBRARY_ADVERTISEMENT_PLATFORMS,
  canonicalLibraryPlatform,
  cleanLibraryPlatforms,
  type LibraryAdvertisementPlatform,
} from '@/lib/library';
import { SUBJECT_OPTIONS, canonicalKnownSubject, type CanonicalSubject } from '@/lib/subjects';

type Collection = 'advertisement' | 'official_script' | 'personal_script' | 'knowledge';
type Item = { id:string; kind:'advertisement'|'script'; collection:Collection; version:number; title:string; ukText:string; ruText:string; notes:string; tags:string[]; platforms:string[]; usedTodayPlatforms:string[]; archivedAt:number|null; updatedAt:number };
type Form = { title:string; ukText:string; ruText:string; notes:string; tags:string[]; platforms:string[] };
const collectionLabels:Record<Collection,string>={advertisement:'Оголошення',official_script:'Офіційні скрипти',personal_script:'Особисті скрипти',knowledge:'База знань'};
const blankForm=():Form=>({title:'',ukText:'',ruText:'',notes:'',tags:[],platforms:[]});
const newForm=(collection:Collection):Form=>({...blankForm(),platforms:collection==='advertisement'?[...LIBRARY_ADVERTISEMENT_PLATFORMS]:[]});

export function LibraryWorkspace({ syncRevision=0, active=true }: { syncRevision?:number; active?:boolean } = {}) {
  const [collection,setCollection]=useState<Collection>('advertisement');
  const [archived,setArchived]=useState(false);
  const [search,setSearch]=useState('');
  const [platformFilter,setPlatformFilter]=useState('all');
  const [items,setItems]=useState<Item[]>([]);
  const [selected,setSelected]=useState<Item|null>(null);
  const [editorOpen,setEditorOpen]=useState(false);
  const [historyOpen,setHistoryOpen]=useState(false);
  const historyTrigger=useRef<HTMLButtonElement|null>(null);
  const [archiveCandidate,setArchiveCandidate]=useState<Item|null>(null);
  const [form,setForm]=useState<Form>(()=>newForm('advertisement'));
  const [loading,setLoading]=useState(true);
  const [refreshing,setRefreshing]=useState(false);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [viberJob,setViberJob]=useState<ViberSafeJob|null>(null);
  const [viberBusy,setViberBusy]=useState(false);
  const hasLoaded=useRef(false);
  const viewCache=useRef(new Map<string,Item[]>());
  const lastSyncRevision=useRef(syncRevision);

  const load=useCallback(async(silent=false)=>{
    const key=libraryViewKey(collection,archived,search);
    const cached=viewCache.current.get(key);
    if(cached&&!hasLoaded.current){setItems(cached);hasLoaded.current=true;setLoading(false);}
    if(!silent&&!hasLoaded.current)setLoading(true);
    setRefreshing(true);setError('');
    try{
      const params=new URLSearchParams({kind:'all',collection,archived:String(archived),search});
      const response=await fetch(`/api/library?${params}`,{cache:'no-store'});
      const body=await response.json() as {items?:Item[];error?:string};
      if(!response.ok)throw new Error(body.error||'Не вдалося завантажити бібліотеку.');
      const next=body.items||[];
      viewCache.current.set(key,next);setItems(next);hasLoaded.current=true;
    }catch(reason){setError(reason instanceof Error?reason.message:'Не вдалося завантажити бібліотеку.');}
    finally{setLoading(false);setRefreshing(false);}
  },[collection,archived,search]);
  useEffect(()=>{const timer=setTimeout(()=>void load(),search?250:0);return()=>clearTimeout(timer);},[load,search]);
  useEffect(()=>{
    if(!active||lastSyncRevision.current===syncRevision)return;
    lastSyncRevision.current=syncRevision;
    viewCache.current.clear();
    void load(true);
  },[active,syncRevision,load]);
  useEffect(()=>{if(!viberJob||(viberJob.status!=='pending'&&viberJob.status!=='claimed'))return;const timer=setInterval(()=>{void (async()=>{try{const response=await fetch('/api/messenger-automation',{cache:'no-store'});const body=await response.json() as {job?:ViberSafeJob|null};if(response.ok&&body.job?.id===viberJob.id)setViberJob(body.job);}catch{/* transient poll failures keep the last confirmed state */}})();},2000);return()=>clearInterval(timer);},[viberJob]);

  function edit(item:Item|null,open=true){
    const knownPlatforms=item?cleanLibraryPlatforms(item.platforms):[];
    const editPlatforms=item
      ? (collection==='advertisement'?(item.platforms.length===0?[...LIBRARY_ADVERTISEMENT_PLATFORMS]:knownPlatforms):item.platforms)
      : newForm(collection).platforms;
    setEditorOpen(open);setSelected(item);setForm(item?{title:item.title,ukText:item.ukText,ruText:item.ruText,notes:item.notes,tags:[...item.tags],platforms:[...editPlatforms]}:newForm(collection));setNotice('');setError('');
  }
  function switchCollection(next:Collection){
    const cached=viewCache.current.get(libraryViewKey(next,false,''));
    if(cached)setItems(cached);
    setCollection(next);setArchived(false);setPlatformFilter('all');edit(null,false);
  }
  function switchArchived(){
    const next=!archived;
    const cached=viewCache.current.get(libraryViewKey(collection,next,search));
    if(cached)setItems(cached);
    setArchived(next);setPlatformFilter('all');edit(null,false);
  }

  async function save(){
    setSaving(true);setError('');setNotice('');
    try{
      const response=await fetch('/api/library',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'save',id:selected?.id,version:selected?.version,collection,...form})});
      const body=await response.json() as {id?:string;version?:number;updatedAt?:number;error?:string};
      if(!response.ok)throw new Error(body.error||'Не вдалося зберегти матеріал.');
      if(!body.id||!body.version||!body.updatedAt)throw new Error('Не вдалося підтвердити збереження.');
      setSelected({id:body.id,kind:collection==='advertisement'?'advertisement':'script',collection,version:body.version,title:form.title.trim(),ukText:form.ukText,ruText:form.ruText,notes:form.notes,tags:[...form.tags],platforms:[...form.platforms],usedTodayPlatforms:selected?.usedTodayPlatforms||[],archivedAt:null,updatedAt:body.updatedAt});
      setNotice(`Збережено · v${body.version}.`);await load();
    }catch(reason){setError(reason instanceof Error?reason.message:'Не вдалося зберегти матеріал.');await load();}
    finally{setSaving(false);}
  }

  async function changeArchive(item:Item){
    const action=item.archivedAt===null?'archive':'restore';
    setSaving(true);setError('');
    try{
      const response=await fetch('/api/library',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,id:item.id,version:item.version})});
      const body=await response.json() as {error?:string};if(!response.ok)throw new Error(body.error||'Не вдалося змінити матеріал.');
      edit(null,false);setNotice(action==='archive'?'Переміщено в архів.':'Матеріал відновлено.');await load();
    }catch(reason){setError(reason instanceof Error?reason.message:'Не вдалося змінити матеріал.');await load();}
    finally{setSaving(false);}
  }

  async function runViberSafeNote(language:'uk'|'ru'){
    if(!selected)return;
    setViberBusy(true);setError('');setNotice('');
    try{
      const requestKey='viber_'+crypto.randomUUID().replaceAll('-','');
      const response=await fetch('/api/messenger-automation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'viber-safe-note',requestKey,advertisementId:selected.id,language})});
      const body=await response.json() as {job?:ViberSafeJob;error?:string};
      if(!response.ok||!body.job)throw new Error(body.error||'Не вдалося запустити Viber safe-mode тест.');
      setViberJob(body.job);setNotice('Viber safe-mode: задача створена. Відправлення дозволене лише в «Мої нотатки».');
    }catch(reason){setError(reason instanceof Error?reason.message:'Не вдалося запустити Viber safe-mode тест.');}
    finally{setViberBusy(false);}
  }
  async function cancelViberSafeNote(){
    if(!viberJob)return;
    setViberBusy(true);setError('');
    try{
      const response=await fetch('/api/messenger-automation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'cancel-viber-safe-note',jobId:viberJob.id})});
      const body=await response.json() as {error?:string};if(!response.ok)throw new Error(body.error||'Не вдалося скасувати Viber safe-mode тест.');
      setViberJob({...viberJob,status:'cancelled'});setNotice('Viber safe-mode тест скасовано. Публікацію не зараховано.');
    }catch(reason){setError(reason instanceof Error?reason.message:'Не вдалося скасувати Viber safe-mode тест.');}
    finally{setViberBusy(false);}
  }
  const isKnowledge=collection==='knowledge';
  const platformOptions=collection==='advertisement'?[...LIBRARY_ADVERTISEMENT_PLATFORMS]:[];
  const visibleItems=platformFilter==='all'?items:items.filter(item=>item.platforms.length===0||item.platforms.some(value=>canonicalLibraryPlatform(value)===platformFilter));
  const selectedDirections=SUBJECT_OPTIONS.filter(subject=>form.tags.some(tag=>canonicalKnownSubject(tag)===subject));
  const extraTags=form.tags.filter(tag=>canonicalKnownSubject(tag)===null);
  const unsupportedPlatforms=collection==='advertisement'&&selected?selected.platforms.filter(value=>!canonicalLibraryPlatform(value)):[];
  const emptyWorkspace=!loading&&!editorOpen&&visibleItems.length===0;
  return <div className={`library-workspace ${editorOpen ? 'has-editor' : ''} ${emptyWorkspace ? 'is-empty' : ''}`} aria-busy={refreshing}>
    <LibraryHistoryDialog open={historyOpen} item={selected?{id:selected.id,title:selected.title}:null} onClose={()=>setHistoryOpen(false)} finalFocus={()=>historyTrigger.current}/>
    <WorkspaceRefreshIndicator active={refreshing&&hasLoaded.current} label="Оновлюємо бібліотеку…" />
    <ConfirmDialog open={archiveCandidate!==null} title="Перемістити матеріал в архів?" description={archiveCandidate?`«${archiveCandidate.title}» зникне з активної бібліотеки, але його можна буде відновити з архіву.`:''} confirmLabel="В архів" destructive busy={saving} onCancel={()=>setArchiveCandidate(null)} onConfirm={()=>{const item=archiveCandidate;if(!item)return;setArchiveCandidate(null);void changeArchive(item);}}/>
    <section className="library-hero"><div><p className="eyebrow">Єдине місце для робочих матеріалів</p><h2>Бібліотека</h2><p>Офіційні й особисті скрипти розділені, важливі інструкції мають власну історію версій.</p></div><Button disabled={saving||archived} onClick={()=>edit(null)}><FilePlus2 data-icon="inline-start"/>Додати</Button></section>
    {error&&<div className="workspace-error" role="alert">{error}</div>}{notice&&<output className="reports-notice">{notice}</output>}
    <div className="library-toolbar"><div className="library-kind-picker" role="tablist" aria-label="Колекція матеріалів">{(Object.keys(collectionLabels) as Collection[]).map(value=><button type="button" role="tab" disabled={saving} aria-selected={collection===value} tabIndex={collection===value?0:-1} key={value} onKeyDown={handleTabKeyNavigation} onClick={()=>switchCollection(value)}>{collectionLabels[value]}</button>)}</div><label className="library-search" htmlFor="library-search"><Search/><Input id="library-search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Пошук за назвою, текстом або тегом…"/></label>{collection==='advertisement'&&<label className="library-platform-filter"><span className="sr-only">Фільтр оголошень за платформою</span><select value={platformFilter} disabled={saving} onChange={event=>{setPlatformFilter(event.target.value);edit(null,false);}}><option value="all">Усі платформи</option>{platformOptions.map(value=><option key={value} value={value}>{platformLabel(value)}</option>)}</select></label>}<Button size="sm" variant={archived?'secondary':'outline'} disabled={saving} onClick={switchArchived}>{archived?'Показати активні':'Архів'}</Button></div>
    <div className="library-layout"><section className="library-list">{loading&&!hasLoaded.current?<WorkspaceInitialLoading compact label="Завантажуємо бібліотеку…"/>:visibleItems.length?visibleItems.map(item=><button type="button" className={`library-item ${selected?.id===item.id?'is-selected':''}`} key={item.id} disabled={saving} onClick={()=>edit(item)}><span><strong>{item.title}</strong><small>{item.ukText||item.ruText}</small>{collection==='advertisement'&&<><span className="library-item-platforms">{displayPlatforms(item.platforms).map(value=><Badge key={value} variant="secondary">{platformLabel(value)}</Badge>)}</span>{item.usedTodayPlatforms.length>0&&<span className="library-item-used"><small>Сьогодні:</small>{cleanLibraryPlatforms(item.usedTodayPlatforms).map(value=><Badge key={value} variant="outline">{platformLabel(value)}</Badge>)}</span>}</>}</span><Badge variant="outline">v{item.version}</Badge></button>):<div className="workspace-empty"><BookOpenText/><strong>{platformFilter!=='all'?'Немає оголошень для цієї платформи':archived?'Архів порожній':'Матеріалів ще немає'}</strong><p>{platformFilter!=='all'?'Зміни платформу або очисть пошук.':archived?'У цій колекції немає архівних матеріалів.':`Додай перший матеріал у «${collectionLabels[collection]}».`}</p></div>}</section>
      <section className="library-editor">{editorOpen?<><Button type="button" variant="ghost" className="library-mobile-back" onClick={()=>edit(null,false)}>← До бібліотеки</Button><div className="card-heading"><div><p className="eyebrow">{collectionLabels[collection]}</p><h3>{selected?selected.title:`Новий матеріал`}</h3>{selected&&<small>Поточна версія: v{selected.version}</small>}</div>{selected&&<div className="lead-actions"><Button ref={historyTrigger} variant="ghost" size="sm" disabled={saving} onClick={()=>setHistoryOpen(true)}><History data-icon="inline-start"/>Історія</Button><Button variant="ghost" size="sm" disabled={saving} onClick={()=>{if(selected.archivedAt===null)setArchiveCandidate(selected);else void changeArchive(selected);}}>{selected.archivedAt===null?<Archive data-icon="inline-start"/>:<RotateCcw data-icon="inline-start"/>}{selected.archivedAt===null?'В архів':'Відновити'}</Button></div>}</div>
        <label htmlFor="library-title">Назва<Input id="library-title" disabled={saving||archived} value={form.title} onChange={event=>setForm({...form,title:event.target.value})} placeholder={isKnowledge?'Наприклад: Як підготувати учня до пробного':'Наприклад: Англійська — батьки школярів'}/></label>
        <div className="library-language-grid">
          <label htmlFor="library-uk">{isKnowledge?'Інструкція / відповідь українською':'Українська версія'}<Textarea id="library-uk" disabled={saving||archived} rows={7} value={form.ukText} onChange={event=>setForm({...form,ukText:event.target.value})} placeholder={isKnowledge?'Робоча інструкція, бот, підготовка учня або типова відповідь…':'Текст українською…'}/></label>
          <label htmlFor="library-ru">{isKnowledge?'Російська версія, якщо потрібна':'Російська версія'}<Textarea id="library-ru" disabled={saving||archived} rows={7} value={form.ruText} onChange={event=>setForm({...form,ruText:event.target.value})} placeholder="Текст російською…"/></label>
        </div>
        <label htmlFor="library-notes">Нотатка<Textarea id="library-notes" disabled={saving||archived} rows={3} value={form.notes} onChange={event=>setForm({...form,notes:event.target.value})} placeholder="Коли та де використовувати…"/></label>
        {collection==='advertisement'?<div className="library-structured-fields">
          <fieldset className="library-choice-group"><legend>Платформи</legend><p className="library-choice-hint">Вкажи, де це оголошення можна публікувати.</p><div className="library-choice-grid">{LIBRARY_ADVERTISEMENT_PLATFORMS.map(value=><label className="library-choice" key={value}><input type="checkbox" disabled={saving||archived} checked={form.platforms.includes(value)} onChange={event=>setForm(current=>({...current,platforms:updatePlatformChoice(current.platforms,value,event.target.checked)}))}/><span>{platformLabel(value)}</span></label>)}</div></fieldset>
          <fieldset className="library-choice-group"><legend>Напрямки</legend><p className="library-choice-hint">Без вибраного напрямку матеріал вважається універсальним.</p><div className="library-direction-grid">{SUBJECT_OPTIONS.map(subject=><label className="library-choice" key={subject}><input type="checkbox" disabled={saving||archived} checked={selectedDirections.includes(subject)} onChange={event=>setForm(current=>({...current,tags:updateDirectionChoice(current.tags,subject,event.target.checked)}))}/><span>{subject}</span></label>)}</div></fieldset>
          <label htmlFor="library-extra-tags">Додаткові теги<Input id="library-extra-tags" disabled={saving||archived} value={extraTags.join(', ')} onChange={event=>setForm(current=>({...current,tags:[...selectedDirections,...split(event.target.value)]}))} placeholder="Наприклад: батьки, НМТ, 1–4 клас"/></label>
          {selected&&selected.usedTodayPlatforms.length>0&&<p className="library-used-today" role="status">Сьогодні вже використано: {cleanLibraryPlatforms(selected.usedTodayPlatforms).map(platformLabel).join(', ')}. Повтор на тій самій платформі залежить від наявності невикористаних придатних оголошень.</p>}
          {unsupportedPlatforms.length>0&&<p className="library-legacy-warning" role="status">Є старі невідомі платформи: {unsupportedPlatforms.join(', ')}. Обери актуальні платформи зі списку перед збереженням.</p>}
          {selected&&selected.archivedAt===null&&cleanLibraryPlatforms(selected.platforms).includes('viber')&&<div className="library-choice-group" aria-label="Viber safe-mode"><strong>Viber safe-mode · «Мої нотатки»</strong><p className="library-choice-hint">Безпечний тест executor: він не створює publication fact і не впливає на Today, Reports чи Analytics. Реальні Viber-чати тут недоступні.</p><div className="lead-actions">{selected.ukText.trim()&&<Button type="button" size="sm" variant="outline" disabled={saving||viberBusy||viberJob?.status==='pending'||viberJob?.status==='claimed'} onClick={()=>void runViberSafeNote('uk')}>{viberBusy?'Запускаємо…':'Тест UA'}</Button>}{selected.ruText.trim()&&<Button type="button" size="sm" variant="outline" disabled={saving||viberBusy||viberJob?.status==='pending'||viberJob?.status==='claimed'} onClick={()=>void runViberSafeNote('ru')}>{viberBusy?'Запускаємо…':'Тест RU'}</Button>}{viberJob&&(viberJob.status==='pending'||viberJob.status==='claimed')&&<Button type="button" size="sm" variant="ghost" disabled={viberBusy} onClick={()=>void cancelViberSafeNote()}>Скасувати тест</Button>}</div>{viberJob&&<p className="library-used-today" role="status">Стан safe-mode: {viberJobStatus(viberJob.status)}.</p>}</div>}
        </div>:<div className="library-two-fields"><label htmlFor="library-tags">Теги<Input id="library-tags" disabled={saving||archived} value={form.tags.join(', ')} onChange={event=>setForm({...form,tags:split(event.target.value)})} placeholder={isKnowledge?'бот, підготовка, техпідтримка':'відповідь, запис, ціна'}/></label><label htmlFor="library-platforms">Платформи<Input id="library-platforms" disabled={saving||archived} value={form.platforms.join(', ')} onChange={event=>setForm({...form,platforms:split(event.target.value)})} placeholder="telegram, viber"/></label></div>}
        {!archived&&<Button onClick={()=>void save()} disabled={saving||!form.title.trim()||(!form.ukText.trim()&&!form.ruText.trim())||(collection==='advertisement'&&!form.platforms.length)}>{saving?'Зберігаємо…':'Зберегти нову версію'}</Button>}
      </>:<div className="workspace-empty"><BookOpenText/><strong>Обери матеріал</strong><p>{archived?'Відкрий архівний матеріал, щоб переглянути історію або відновити його.':'Або натисни «Додати».'}</p></div>}</section></div>
  </div>;
}
function split(value:string){return [...new Set(value.split(',').map(item=>item.trim()).filter(Boolean))];}
function updatePlatformChoice(current:string[],value:LibraryAdvertisementPlatform,checked:boolean){
  const canonical=cleanLibraryPlatforms(current);
  return checked?[...new Set([...canonical,value])]:canonical.filter(item=>item!==value);
}
function updateDirectionChoice(current:string[],subject:CanonicalSubject,checked:boolean){
  const rest=current.filter(tag=>canonicalKnownSubject(tag)!==subject);
  return checked?[...rest,subject]:rest;
}
function displayPlatforms(values:string[]){
  if(values.length===0)return ['all'];
  const known=cleanLibraryPlatforms(values);
  const extras=[...new Set(values.filter(value=>!canonicalLibraryPlatform(value)).map(value=>value.trim()).filter(Boolean))];
  return [...known,...extras];
}
function platformLabel(value:string){return ({all:'Усі платформи',telegram:'Telegram',whatsapp:'WhatsApp',viber:'Viber',facebook:'Facebook'} as Record<string,string>)[value.toLowerCase()]||value;}

function libraryViewKey(collection:Collection,archived:boolean,search:string){return `${collection}:${archived?'archived':'active'}:${search}`;}

type ViberSafeJob={id:string;status:'pending'|'claimed'|'sent'|'failed'|'cancelled';result:Record<string,unknown>|null};
function viberJobStatus(status:ViberSafeJob['status']){return ({pending:'очікує executor',claimed:'виконується',sent:'підтверджено в «Мої нотатки»',failed:'завершено без підтвердженої відправки',cancelled:'скасовано'} as const)[status];}
