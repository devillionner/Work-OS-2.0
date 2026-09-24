type TrendPoint = {
  date:string; joined:number; publications:number; responses:number; bookings:number; completed:number;
};
type MetricKey = Exclude<keyof TrendPoint,'date'>;

const metrics:Array<{key:MetricKey;label:string}>=[
  {key:'joined',label:'Приєднання'},
  {key:'publications',label:'Публікації'},
  {key:'responses',label:'Відгуки'},
  {key:'bookings',label:'Записи'},
  {key:'completed',label:'Проведені'},
];

export function AnalyticsTrends({points}:{points:TrendPoint[]}) {
  const sampled=samplePoints(points,120);
  return <section className="analytics-card" aria-labelledby="analytics-trends-title">
    <div className="card-heading"><div><p className="eyebrow">Динаміка</p><h3 id="analytics-trends-title">Активність за днями</h3></div><span className="muted-note">{points.length} дн.</span></div>
    <div className="analytics-trend-grid">
      {metrics.map(metric=><Trend key={metric.key} label={metric.label} values={sampled.map(point=>({date:point.date,value:point[metric.key]}))}/>) }
    </div>
    {points.length>120&&<p className="muted-note">Для графіка показано репрезентативну вибірку до 120 точок; серверні денні дані за весь період не обрізаються.</p>}
  </section>;
}

function Trend({label,values}:{label:string;values:Array<{date:string;value:number}>}) {
  const max=Math.max(1,...values.map(item=>item.value));
  const width=320; const height=76; const pad=4;
  const coords=values.map((item,index)=>{
    const x=values.length<=1?width/2:pad+(index/(values.length-1))*(width-pad*2);
    const y=height-pad-(item.value/max)*(height-pad*2);
    return `${round(x)},${round(y)}`;
  }).join(' ');
  const total=values.reduce((sum,item)=>sum+item.value,0);
  const peak=Math.max(0,...values.map(item=>item.value));
  return <div className="analytics-trend-card">
    <div><span>{label}</span><strong>{total}</strong><small>пік за день: {peak}</small></div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label}: динаміка від ${values[0]?.date||'—'} до ${values.at(-1)?.date||'—'}, усього ${total}, максимум ${peak} за день`} preserveAspectRatio="none">
      <polyline points={coords} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  </div>;
}

function samplePoints(points:TrendPoint[],limit:number):TrendPoint[]{
  if(points.length<=limit)return points;
  const result:TrendPoint[]=[];
  for(let i=0;i<limit;i++) result.push(points[Math.round(i*(points.length-1)/(limit-1))]);
  return result;
}
function round(value:number){return Math.round(value*10)/10;}
