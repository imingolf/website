import {payloadFor,accessToken} from './native-reminders.mjs';
const ENDPOINT='https://fcm.googleapis.com/v1/projects/i-m-in-golf/messages:send';
// One provider attempt per invite, on the recipient's most recently registered phone.
// A timeout is ambiguous: preserve the in-app invite and never risk a duplicate push.
export async function sendSideInvites({db,env,fetcher=fetch,tokenProvider=accessToken}){
 const counts={claimed:0,sent:0,failed:0,skipped:0};
 if(env('IIG_SIDEGAME_INVITES_ENABLED')!=='true')return {status:'disabled',...counts};
 const call=async(name,args)=>{const r=await db.rpc(name,args);if(r.error)throw Error('Invite database unavailable');return r.data;};
 try{
  const raw=env('IIG_FIREBASE_SERVICE_ACCOUNT');if(!raw)return {status:'not_configured',...counts};
  const token=await tokenProvider(JSON.parse(raw),fetcher);
  const claims=await call('iig_claim_side_invites',{p_limit:20});
  if(!Array.isArray(claims))throw Error('Invalid invite queue');
  counts.claimed=claims.length;
  let i=0;
  await Promise.all(Array.from({length:Math.min(4,claims.length)},async()=>{
   while(i<claims.length){
    const item=claims[i++],args={p_event:item.event_id,p_fid:item.fid,p_claim:item.claim_id};
    const ready=await call('iig_authorize_side_invite',args);
    if(!ready){counts.skipped++;continue;}
    let status='failed';
    try{
     const response=await fetcher(ENDPOINT,{method:'POST',signal:AbortSignal.timeout(8000),
      headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(payloadFor(ready))});
     if(response.ok)status='sent';
    }catch(_){}
    await call('iig_finish_side_invite',{...args,p_status:status});counts[status]++;
   }
  }));
  return {status:'complete',...counts};
 }catch(_){return {status:'unavailable',...counts};}
}
