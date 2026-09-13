import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { commandBody, json } from '@/lib/leads/application/http';
import { LeadError, date as validDate, only, record, string } from '@/lib/leads/domain/validation';
import { BulkChatError } from '@/lib/chats/bulk-input';
import { readHistoricalChatAccounts, recordHistoricalJoinedChat } from '@/lib/reports/chat-correction';
import { ReportCorrectionError } from '@/lib/reports/publication-correction';

export async function GET():Promise<Response>{
  try{
    const user=await getCurrentUser();
    if(!user)return json({error:'Потрібно увійти.'},401);
    return json({accounts:await readHistoricalChatAccounts(env.DB,user.id)});
  }catch(error){return correctionError(error);}
}

export async function POST(request:Request):Promise<Response>{
  try{
    const user=await getCurrentUser();
    if(!user)return json({error:'Потрібно увійти.'},401);
    const body=record(await commandBody(request));
    only(body,['requestId','date','name','link','telegramAccountId']);
    const requestId=string(body.requestId,'ID запиту',100,true);
    const date=validDate(body.date,'Дата обліку');
    const link=string(body.link,'Посилання',2048,true);
    if(typeof body.name!=='string'||body.name.length>1000)throw new LeadError('Некоректна назва чату.');
    const telegramAccountId=body.telegramAccountId===null||body.telegramAccountId===undefined||body.telegramAccountId===''
      ? null
      : string(body.telegramAccountId,'Telegram-акаунт',200,true);
    const result=await recordHistoricalJoinedChat(env.DB,{
      userId:user.id,requestId,date,name:body.name,link,telegramAccountId,now:unixNow(),
    });
    return json({ok:true,...result,date});
  }catch(error){return correctionError(error);}
}

function correctionError(error:unknown){
  if(error instanceof BulkChatError||error instanceof ReportCorrectionError||error instanceof LeadError)
    return json({error:error.message},error.status);
  console.error('historical chat correction error',error);
  return json({error:'Не вдалося додати історичний чат.'},500);
}
function unixNow(){return Math.floor(Date.now()/1000);}
