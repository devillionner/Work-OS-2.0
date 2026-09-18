'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, BookOpenText, FilePlus2, History, RotateCcw, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { LibraryHistoryDialog } from '@/components/library-history-dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { handleTabKeyNavigation } from '@/lib/tab-navigation';

type Collection = 'advertisement' | 'official_script' | 'personal_script' | 'knowledge';
type Item = { id:string; kind:'advertisement'|'script'; collection:Collection; version:number; title:string; ukText:string; ruText:string; notes:string; tags:string[]; platforms:string[]; archivedAt:number|null; updatedAt:number };
type Form = { title:string; ukText:string; ruText:string; notes:string; tags:string; platforms:string };
const collectionLabels:Record<Collection,string>={advertisement:'Оголошення',official_script:'Офіційні скрипти',personal_script:'Особисті скрипти',knowledge:'База знань'};
const emptyForm:Form={title:'',ukText:'',ruText:'',notes:'',tags:'',platforms:''};

export function LibraryWorkspace() {
  const [collection,setCollection]=useState<Collection>('advertisement');
  const [archived,setArchived]=useState(false);
  const [search,setSearch]=useState('');
  const [items,setItems]=useState<Item[]>([]);
  const [selected,setSelected]=useState<Item|null>(null);
  const [editorOpen,setEditorOpen]=useState(false);
  const [historyOpen,setHistoryOpen]=useState(false);
  const historyTrigger=useRef<HTMLButtonElement|null>(null);
  const [archiveCandidate,setArchiveCandidate]=useState<Item|null>(null);
  const [form,setForm]=useState<Form>(emptyForm);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');

  const load=useCallback(async()=>{
    setLoading(true);setError('');
    try{
      const params=new URLSearchParams({kind:'all',collection,archived:String(archived),search});
      const response=await fetch(`/api/library?${params}`,{cache:'no-store'});
      const body=await response.json() as {items?:Item[];error?:string};
      if(!response.ok)throw new Error(body.error||'Не вдалося завантажити бібліотеку.');
      setItems(body.items||[]);
    }catch(reason){setError(reason instanceof Error?reason.message:'Не вдалося завантажити бібліотеку.');}
    finally{setLoading(false);}
  },[collection,archived,search]);
  useEffect(()=>{const timer=setTimeout(()=>void load(),search?250:0);return()=>clearTimeout(timer);},[load,search]);

  function edit(item:Item|null,open=true){
    setEditorOpen(open);setSelected(item);setForm(item?{title:item.title,ukText:item.ukText,ruText:item.ruText,notes:item.notes,tags:item.tags.join(', '),platforms:item.platforms.join(', ')}:emptyForm);setNotice('');setError('');
  }
  function switchCollection(next:Collection){setCollection(next);setArchived(false);edit(null,false);}

  async function save(){
    setSaving(true);setError('');setNotice('');
    try{
      const response=await fetch('/api/library',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'save',id:selected?.id,version:selected?.version,collection,...form,tags:split(form.tags),platforms:split(form.platforms)})});
      const body=await response.json() as {id?:string;version?:number;updatedAt?:number;error?:string};
      if(!response.ok)throw new Error(body.error||'Не вдалося зберегти матеріал.');
      if(!body.id||!body.version||!body.updatedAt)throw new Error('Не вдалося підтвердити збереження.');
      setSelected({id:body.id,kind:collection==='advertisement'?'advertisement':'script',collection,version:body.version,title:form.title.trim(),ukText:form.ukText,ruText:form.ruText,notes:form.notes,tags:split(form.tags),platforms:split(form.platforms),archivedAt:null,updatedAt:body.updatedAt});
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

  const isKnowledge=collection==='knowledge';
  const emptyWorkspace=!loading&&!editorOpen&&items.length===0;
  return <div className={`library-workspace ${editorOpen ? 'has-editor' : ''} ${emptyWorkspace ? 'is-empty' : ''}`}>
    <LibraryHistoryDialog open={historyOpen} item={selected?{id:selected.id,title:selected.title}:null} onClose={()=>setHistoryOpen(false)} finalFocus={()=>historyTrigger.current}/>
    <ConfirmDialog open={archiveCandidate!==null} title="Перемістити матеріал в архів?" description={archiveCandidate?`«${archiveCandidate.title}» зникне з активної бібліотеки, але його можна буде відновити з архіву.`:''} confirmLabel="В архів" destructive busy={saving} onCancel={()=>setArchiveCandidate(null)} onConfirm={()=>{const item=archiveCandidate;if(!item)return;setArchiveCandidate(null);void changeArchive(item);}}/>
    <section className="library-hero"><div><p className="eyebrow">Єдине місце для робочих матеріалів</p><h2>Бібліотека</h2><p>Офіційні й особисті скрипти розділені, важливі інструкції мають власну історію версій.</p></div><Button disabled={saving||archived} onClick={()=>edit(null)}><FilePlus2 data-icon="inline-start"/>Додати</Button></section>
    {error&&<div className="workspace-error" role="alert">{error}</div>}{notice&&<output className="reports-notice">{notice}</output>}
    <div className="library-toolbar"><div className="library-kind-picker" role="tablist" aria-label="Колекція матеріалів">{(Object.keys(collectionLabels) as Collection[]).map(value=><button type="button" role="tab" disabled={saving} aria-selected={collection===value} tabIndex={collection===value?0:-1} key={value} onKeyDown={handleTabKeyNavigation} onClick={()=>switchCollection(value)}>{collectionLabels[value]}</button>)}</div><label className="library-search" htmlFor="library-search"><Search/><Input id="library-search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Пошук за назвою, текстом або тегом…"/></label><Button size="sm" variant={archived?'secondary':'outline'} disabled={saving} onClick={()=>{setArchived(value=>!value);edit(null,false);}}>{archived?'Показати активні':'Архів'}</Button></div>
    <div className="library-layout"><section className="library-list">{loading?<div className="workspace-loading">Завантаження…</div>:items.length?items.map(item=><button type="button" className={`library-item ${selected?.id===item.id?'is-selected':''}`} key={item.id} disabled={saving} onClick={()=>edit(item)}><span><strong>{item.title}</strong><small>{item.ukText||item.ruText}</small></span><Badge variant="outline">v{item.version}</Badge></button>):<div className="workspace-empty"><BookOpenText/><strong>{archived?'Архів порожній':'Матеріалів ще немає'}</strong><p>{archived?'У цій колекції немає архівних матеріалів.':`Додай перший матеріал у «${collectionLabels[collection]}».`}</p></div>}</section>
      <section className="library-editor">{editorOpen?<><Button type="button" variant="ghost" className="library-mobile-back" onClick={()=>edit(null,false)}>← До бібліотеки</Button><div className="card-heading"><div><p className="eyebrow">{collectionLabels[collection]}</p><h3>{selected?selected.title:`Новий матеріал`}</h3>{selected&&<small>Поточна версія: v{selected.version}</small>}</div>{selected&&<div className="lead-actions"><Button ref={historyTrigger} variant="ghost" size="sm" disabled={saving} onClick={()=>setHistoryOpen(true)}><History data-icon="inline-start"/>Історія</Button><Button variant="ghost" size="sm" disabled={saving} onClick={()=>{if(selected.archivedAt===null)setArchiveCandidate(selected);else void changeArchive(selected);}}>{selected.archivedAt===null?<Archive data-icon="inline-start"/>:<RotateCcw data-icon="inline-start"/>}{selected.archivedAt===null?'В архів':'Відновити'}</Button></div>}</div>
        <label htmlFor="library-title">Назва<Input id="library-title" disabled={saving||archived} value={form.title} onChange={event=>setForm({...form,title:event.target.value})} placeholder={isKnowledge?'Наприклад: Як підготувати учня до пробного':'Наприклад: Англійська — батьки школярів'}/></label>
        <label htmlFor="library-uk">{isKnowledge?'Інструкція / відповідь українською':'Українська версія'}<Textarea id="library-uk" disabled={saving||archived} rows={7} value={form.ukText} onChange={event=>setForm({...form,ukText:event.target.value})} placeholder={isKnowledge?'Робоча інструкція, бот, підготовка учня або типова відповідь…':'Текст українською…'}/></label>
        <label htmlFor="library-ru">{isKnowledge?'Російська версія, якщо потрібна':'Російська версія'}<Textarea id="library-ru" disabled={saving||archived} rows={7} value={form.ruText} onChange={event=>setForm({...form,ruText:event.target.value})} placeholder="Текст російською…"/></label>
        <label htmlFor="library-notes">Нотатка<Textarea id="library-notes" disabled={saving||archived} rows={3} value={form.notes} onChange={event=>setForm({...form,notes:event.target.value})} placeholder="Коли та де використовувати…"/></label>
        <div className="library-two-fields"><label htmlFor="library-tags">Теги<Input id="library-tags" disabled={saving||archived} value={form.tags} onChange={event=>setForm({...form,tags:event.target.value})} placeholder={isKnowledge?'бот, підготовка, техпідтримка':'школа, англійська, response'}/></label><label htmlFor="library-platforms">Платформи<Input id="library-platforms" disabled={saving||archived} value={form.platforms} onChange={event=>setForm({...form,platforms:event.target.value})} placeholder="telegram, viber"/></label></div>
        {!archived&&<Button onClick={()=>void save()} disabled={saving||!form.title.trim()||(!form.ukText.trim()&&!form.ruText.trim())}>{saving?'Зберігаємо…':'Зберегти нову версію'}</Button>}
      </>:<div className="workspace-empty"><BookOpenText/><strong>Обери матеріал</strong><p>{archived?'Відкрий архівний матеріал, щоб переглянути історію або відновити його.':'Або натисни «Додати».'}</p></div>}</section></div>
  </div>;
}
function split(value:string){return [...new Set(value.split(',').map(item=>item.trim()).filter(Boolean))];}
