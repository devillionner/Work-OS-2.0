'use client';

import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';

export function WorkspaceInitialLoading({
  label='Завантажуємо дані…',
  compact=false,
}:{
  label?:string;
  compact?:boolean;
}) {
  return <div className={`workspace-initial-loading ${compact?'is-compact':''}`} role="status" aria-live="polite">
    <div className="workspace-loading-skeleton" aria-hidden="true">
      <i/><i/><i/>
    </div>
    <span>{label}</span>
  </div>;
}

export function WorkspaceRefreshIndicator({
  active,
  label='Оновлюємо…',
  delay=220,
}:{
  active:boolean;
  label?:string;
  delay?:number;
}) {
  const [visible,setVisible]=useState(false);
  useEffect(()=>{
    if(!active){setVisible(false);return;}
    const timer=setTimeout(()=>setVisible(true),delay);
    return()=>clearTimeout(timer);
  },[active,delay]);
  if(!visible)return null;
  return <output className="workspace-refresh-indicator" aria-live="polite">
    <LoaderCircle className="is-spinning" aria-hidden="true"/>
    <span>{label}</span>
  </output>;
}
