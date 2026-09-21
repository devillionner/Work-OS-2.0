import { discoveryMembershipStatement } from '../chat-discovery/workflow-link.ts';
import { chatStateEvent, chatStateTokenSql, type ChatState } from './state.ts';

export async function changeChatLeave(db:D1Database,input:{
  userId:string;chat:ChatState;now:number;confirm:boolean;
}) {
  const {chat}=input;
  if(!['telegram','whatsapp'].includes(chat.platform)||chat.workflow_status!=='archived'||chat.joined_at===null) {
    return {ok:false,error:'Підтвердження виходу доступне лише для архівного приєднаного Telegram/WhatsApp чату.'};
  }
  if(input.confirm&&chat.left_at!==null) return {ok:false,error:'Вихід уже підтверджено.'};
  if(!input.confirm&&chat.left_at===null) return {ok:false,error:'Підтвердження виходу вже скасовано.'};
  const action=input.confirm?'confirm_leave':'undo_leave';
  const eventId=crypto.randomUUID();
  const results=await db.batch([
    db.prepare(`UPDATE chats SET updated_at=?1 WHERE id=?2 AND user_id=?3 AND workflow_status='archived'
      AND joined_at IS NOT NULL AND platform IN ('telegram','whatsapp') AND ${chatStateTokenSql('chats')}=?4`)
      .bind(input.now,chat.id,input.userId,chat.state_token),
    chatStateEvent(db,{id:eventId,userId:input.userId,chatId:chat.id,action,now:input.now,previous:chat.state_token}),
    discoveryMembershipStatement(db,{
      userId:input.userId,
      chatId:chat.id,
      eventId,
      membershipState:input.confirm?'left':'joined',
      now:input.now,
    }),
  ]);
  return results[0].meta.changes?{ok:true}:{ok:false,error:'Чат уже змінився. Оновіть список.'};
}
