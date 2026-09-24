'use client';

import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type PlatformLinkItem = { id?:string; name?:string; link?:string };
export type PublicationPace = { ratePerHour:number; completed:number; target:number };

export function PlatformOverview({
  pace,
  available,
  joined,
  published,
}:{
  pace:PublicationPace;
  available?:PlatformLinkItem[];
  joined:PlatformLinkItem[];
  published:PlatformLinkItem[];
}) {
  return <section className={`platform-overview ${available?'has-available':''}`} aria-label="Сьогоднішній стан">
    <DailyStat label="Темп" value={`${pace.ratePerHour}/год`} />
    <DailyStat label="Ціль" value={`${pace.completed} / ${pace.target}`} />
    {available&&<DailyLinkStat label="Доступні" items={available} />}
    <DailyLinkStat label="Приєднано" items={joined} />
    <DailyLinkStat label="Опубліковано" items={published} />
  </section>;
}

function DailyStat({label,value}:{label:string;value:string}) {
  return <div className="platform-stat">
    <span>{label}</span>
    <strong>{value}</strong>
  </div>;
}

function DailyLinkStat({label,items}:{label:string;items:PlatformLinkItem[]}) {
  async function copy(names:boolean) {
    const lines=items.flatMap((item,index)=>[
      `${names&&item.name?`${item.name} — `:''}${item.link||''}`,
      ...((index+1)%5===0&&index<items.length-1?['']:[]),
    ]);
    await navigator.clipboard.writeText(lines.join('\n'));
  }

  return <div className="platform-stat has-actions">
    <span>{label}</span>
    <strong>{items.length}</strong>
    <div className="platform-stat-actions">
      <Button variant="ghost" size="icon" title={`Копіювати посилання · ${label}`} aria-label={`Копіювати посилання · ${label}`} onClick={()=>void copy(false)} disabled={!items.length}><Copy/></Button>
      <Button className="platform-stat-names" variant="ghost" size="sm" title={`Копіювати назви й посилання · ${label}`} onClick={()=>void copy(true)} disabled={!items.length}>З назвами</Button>
    </div>
  </div>;
}
