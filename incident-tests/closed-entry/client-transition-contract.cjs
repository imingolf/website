'use strict';
// OFFLINE CONTRACT PROTOTYPE ONLY. Not loaded by app or connected to Supabase.
// RPC/envelope names are proposals, not installed production endpoints.
const {randomUUID}=require('node:crypto');
function createTransitionClient(send){
 if(typeof send!=='function')throw Error('INVALID_TRANSPORT');
 let session=null,credential=null,busy=false,generation=0,unresolved=null;
 function fail(){throw Error('RELOAD_REQUIRED');}
 function envelope(value){
  if(!value || typeof value.groupId!=='string'||!value.groupId ||
    typeof value.roundId!=='string'||!value.roundId ||
    !Number.isSafeInteger(value.revision)||value.revision<0)fail();
  return {groupId:value.groupId,roundId:value.roundId,revision:value.revision};
 }
 return Object.freeze({
  load(value){if(busy)throw Error('REQUEST_PENDING');session=null;credential=null;generation++;unresolved=null;session=envelope(value);},
  authorise(groupId,token){
   if(busy||!session||groupId!==session.groupId||typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))
    throw Error('ORGANISER_CREDENTIAL_REQUIRED');
   credential=token;
  },
  clear(){session=null;credential=null;unresolved=null;generation++;},
  pendingFinishReceipt(){return unresolved?{...unresolved}:null;},
  acceptFinishReceipt(receipt,fresh){
   if(busy)throw Error('REQUEST_PENDING');
   if(!unresolved)throw Error('NO_PENDING_FINISH');
   const ack=receipt?.response;
   const next=envelope(fresh);
   if(receipt?.status!=='committed'||ack?.ok!==true||ack.requestId!==unresolved.requestId||
     ack.groupId!==unresolved.groupId||ack.roundId!==unresolved.roundId||
     ack.revision!==unresolved.revision+1||next.groupId!==ack.groupId||
     next.revision<ack.revision||(next.revision===ack.revision&&next.roundId!==ack.roundId))fail();
   // Both inputs must come from the reviewed, authenticated server transport.
   // Do not reinstall the historical receipt's state/revision over a newer round.
   session=next;credential=null;unresolved=null;generation++;
   return {ok:true,...next};
  },
  async request(operation,proposal){
   if(!['save','finish','start'].includes(operation))throw Error('UNSUPPORTED_OPERATION');
   if(busy)throw Error('REQUEST_PENDING');
   if(!session)fail();
   if(operation!=='save'&&!credential)throw Error('ORGANISER_CREDENTIAL_REQUIRED');
   const captured={...session},epoch=generation;
   // Clone proposals to prevent changes while the queued transport is pending.
   const params={expected:{...captured},proposal:structuredClone(proposal),requestId:randomUUID()};
   if(operation!=='save')params.organiserCredential=credential;
   busy=true;
   try{
    const response=await send(operation,params);
    if(epoch!==generation)fail();
    if(!response||response.error||response.ok!==true)fail();
    const next=envelope(response);
    if(next.groupId!==captured.groupId || next.revision!==captured.revision+1 ||
      (operation!=='start'&&next.roundId!==captured.roundId)||
      (operation==='start'&&next.roundId===captured.roundId))fail();
    session=next;
    // Never return server error text, state or credentials to UI/log handlers.
    return {ok:true,...next};
   }catch(_){
    if(epoch===generation&&operation==='finish')unresolved={requestId:params.requestId,...captured};
    session=null;credential=null;generation++;
    // Timeout/unknown commit: no automatic retry or revision rebase. Only an authenticated receipt lookup plus a fresh read can reconcile
    // a finish. The app/transport and start/save receipt protocols are unfinished.
    throw Error('RELOAD_REQUIRED');
   }finally{busy=false;}
  }
 });
}
module.exports={createTransitionClient};
