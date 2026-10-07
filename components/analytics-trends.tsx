import { Activity } from 'lucide-react';

type TrendPoint = {
  date:string; joined:number; publications:number; responses:number; bookings:number; completed:number;
};
type MetricKey = Exclude<keyof TrendPoint,'date'>;

const metrics:Array<{key:MetricKey;label:string;color:string;gradId:string}>=[
  {key:'joined',label:'Приєднання',color:'#3b82f6',gradId:'grad-joined'},
  {key:'publications',label:'Публікації',color:'#2563eb',gradId:'grad-pub'},
  {key:'responses',label:'Відгуки',color:'#4f46e5',gradId:'grad-resp'},
  {key:'bookings',label:'Записи',color:'#059669',gradId:'grad-book'},
  {key:'completed',label:'Проведені',color:'#7c3aed',gradId:'grad-comp'},
];

export function AnalyticsTrends({points}:{points:TrendPoint[]}) {
  const sampled=samplePoints(points,120);
  return (
    <section className="analytics-card analytics-trends-section" aria-labelledby="analytics-trends-title">
      <div className="card-heading">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="size-4 text-indigo-600" />
            <p className="eyebrow !mb-0">Динаміка</p>
          </div>
          <h3 id="analytics-trends-title" className="mt-1">Активність за днями</h3>
        </div>
        <span className="muted-note text-xs">{points.length} днів спостереження</span>
      </div>
      <div className="analytics-trend-grid">
        {metrics.map(metric=>(
          <Trend
            key={metric.key}
            label={metric.label}
            color={metric.color}
            gradId={metric.gradId}
            values={sampled.map(point=>({date:point.date,value:point[metric.key]}))}
          />
        ))}
      </div>
      {points.length>120&&<p className="muted-note text-xs mt-3">Для графіка показано репрезентативну вибірку до 120 точок; серверні денні дані за весь період не обрізаються.</p>}
    </section>
  );
}

function Trend({label,values,color,gradId}:{label:string;values:Array<{date:string;value:number}>;color:string;gradId:string}) {
  const max=Math.max(1,...values.map(item=>item.value));
  const width=320; const height=76; const pad=4;
  const coords=values.map((item,index)=>{
    const x=values.length<=1?width/2:pad+(index/(values.length-1))*(width-pad*2);
    const y=height-pad-(item.value/max)*(height-pad*2);
    return `${round(x)},${round(y)}`;
  }).join(' ');

  const firstX = pad;
  const lastX = width - pad;
  const bottomY = height;
  const areaPoints = values.length > 1
    ? `${firstX},${bottomY} ${coords} ${lastX},${bottomY}`
    : '';

  const total=values.reduce((sum,item)=>sum+item.value,0);
  const peak=Math.max(0,...values.map(item=>item.value));

  return (
    <div className="analytics-trend-card">
      <div className="analytics-trend-head">
        <div>
          <span className="analytics-trend-label">{label}</span>
          <strong className="analytics-trend-total">{total}</strong>
        </div>
        <span className="analytics-trend-peak-pill">пік: {peak}</span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${label}: динаміка від ${values[0]?.date||'—'} до ${values.at(-1)?.date||'—'}, усього ${total}, максимум ${peak} за день`}
        preserveAspectRatio="none"
        className="analytics-trend-svg"
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0.0" />
          </linearGradient>
        </defs>
        {areaPoints && <polygon points={areaPoints} fill={`url(#${gradId})`} />}
        <polyline
          points={coords}
          fill="none"
          stroke={color}
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

function samplePoints(points:TrendPoint[],limit:number):TrendPoint[]{
  if(points.length<=limit)return points;
  const result:TrendPoint[]=[];
  for(let i=0;i<limit;i++) result.push(points[Math.round(i*(points.length-1)/(limit-1))]);
  return result;
}
function round(value:number){return Math.round(value*10)/10;}

