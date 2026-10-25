/* Inert until a separately approved TEST-only build explicitly enables it.
 * No endpoints, keys, credentials or network clients are constructed here.
 */
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.IIGEntryGuard=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const TEST='nyavvwrsrxqfyhiygkgw';
 const clone=x=>JSON.parse(JSON.stringify(x));
 const error=()=>({data:null,error:{message:'Reload the latest group before continuing.',code:'IIG_RELOAD_REQUIRED'}});
 function validateBuild(build,config,origin){
  if(build===undefined)return false;
  if(!build||build.mode!=='test-only'||build.projectRef!==TEST||build.origin!==origin||
    !/^https:\/\//.test(origin)||config?.supabaseUrl!=='https://'+TEST+'.supabase.co')throw Error('GUARDED_TEST_CONFIG_REQUIRED');
  return true;
 }
 function create(raw,{promptCredential,uuid,publish}={}){
  if(!raw||typeof raw.rpc!=='function'||typeof uuid!=='function')throw Error('INVALID_GUARD_CLIENT');
  const versions=new WeakMap();let current=null,secret=null,pending=null,generation=0,busy=false;
  function context(x){
   if(!x||typeof x.groupId!=='string'||!x.groupId||typeof x.roundId!=='string'||!x.roundId||
    !Number.isSafeInteger(x.revision)||x.revision<0||typeof x.closed!=='boolean'||!['open','finished'].includes(x.phase))throw Error('INVALID_CONTEXT');
   return {groupId:x.groupId,roundId:x.roundId,revision:x.revision,closed:x.closed,phase:x.phase};
  }
  function capture(state,pin){
   const c=versions.get(state);
   if(!c||c.pin!==pin||!current||c.groupId!==current.groupId)throw Error('VERSIONED_READ_REQUIRED');
   return {...c,generation};
  }
  async function read(pin){
   const epoch=generation;
   try{
    const result=await raw.rpc('iig_entry_read',{p_pin:pin});
    if(epoch!==generation||result.error||!result.data||!result.data.state||typeof result.data.state!=='object')return error();
    const c={...context(result.data.context),pin};
    if(current&&(current.groupId!==c.groupId||current.pin!==pin)){secret=null;pending=null;generation++;}
    current=c;versions.set(result.data.state,c);return {data:result.data.state,error:null};
   }catch(_){return error();}
  }
  async function credential(pin,c,operation){
   const kind=['profile','sidegame','claim'].includes(operation)?'player':'organiser';
   if(secret&&secret.groupId===c.groupId&&secret.kind===kind)return secret.token;
   if(typeof promptCredential!=='function')throw Error('ORGANISER_CREDENTIAL_REQUIRED');
   const epoch=generation;
   const token=await promptCredential({kind,operation});
   if(epoch!==generation||typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))throw Error('ORGANISER_CREDENTIAL_REQUIRED');
   const checked=kind==='player'
    ? await raw.rpc('iig_entry_check_member',{p_pin:pin,p_group:c.groupId,p_credential:token,p_scope:operation})
    : await raw.rpc('iig_entry_check_credential',{p_pin:pin,p_group:c.groupId,p_credential:token});
   if(epoch!==generation||checked.error||(kind==='player'?typeof checked.data?.playerId!=='string':checked.data!==true))throw Error('CREDENTIAL_REQUIRED');
   secret={groupId:c.groupId,token,kind};return token;
  }
  async function commit(operation,pin,state,captured,source){
   if(busy||!['save','finish','start','correct','cancel','settings','members','settle','profile','sidegame','claim'].includes(operation))return error();
   let sent=false;const epoch=generation;let request;
   try{
    if(!captured||captured.generation!==generation||captured.pin!==pin||current?.groupId!==captured.groupId)throw Error('GROUP_CHANGED');
    busy=true;
    const token=operation==='save'?null:await credential(pin,captured,operation);
    if(epoch!==generation)throw Error('GROUP_CHANGED');
    request={operation,pin,...context(captured),requestId:uuid()};
    sent=true;
    const response=await raw.rpc('iig_entry_write',{p_pin:pin,p_group:captured.groupId,p_round:captured.roundId,
     p_revision:captured.revision,p_operation:operation,p_state:clone(state),p_credential:token,p_request:request.requestId});
    if(epoch!==generation||response.error||response.data?.ok!==true)throw Error('RELOAD');
    const ack=response.data,next=context(ack);
    if(ack.requestId!==request.requestId||next.groupId!==captured.groupId||
     (next.revision!==captured.revision+1&&!(operation==='save'&&next.revision===captured.revision))||
     (operation==='start'?next.roundId===captured.roundId:next.roundId!==captured.roundId)||ack.replayed===true)throw Error('RELOAD');
    // Never apply an ACK's version to a source object edited since capture.
    if(source&&JSON.stringify(source)!==JSON.stringify(state))throw Error('LOCAL_STATE_CHANGED');
    const c={...next,pin};current=c;
    if(source){
     if(operation==='start')source.roundId=ack.applicationRoundId;
     versions.set(source,c);
    }
    pending=null;
    if(typeof publish==='function')publish(operation,ack);
    return {data:true,error:null};
   }catch(_){
    secret=null;
    if(source)versions.delete(source);
    if(sent&&epoch===generation)pending=request; // opaque identity only, no state/token
    return error();
   }finally{busy=false;}
  }
  async function recover(){
   if(busy||!pending)return error();
   const p={...pending},epoch=generation;
   try{
    busy=true;
    const token=p.operation==='save'?null:await credential(p.pin,p,p.operation);
    const receipt=await raw.rpc('iig_entry_receipt',{p_pin:p.pin,p_group:p.groupId,p_request:p.requestId,p_credential:token});
    const ack=receipt.data?.response;
    if(epoch!==generation||receipt.error||receipt.data?.status!=='committed'||ack?.ok!==true||ack.requestId!==p.requestId||ack.groupId!==p.groupId||
     (ack.revision!==p.revision+1&&!(p.operation==='save'&&ack.revision===p.revision))||
     (p.operation==='start'?ack.roundId===p.roundId:ack.roundId!==p.roundId))throw Error('UNKNOWN');
    const fresh=await read(p.pin);
    const c=fresh.data&&versions.get(fresh.data);
    if(epoch!==generation||fresh.error||!c||c.groupId!==p.groupId||c.revision<ack.revision)throw Error('UNKNOWN');
    pending=null;secret=null;return {data:fresh.data,error:null};
   }catch(_){secret=null;return error();}finally{busy=false;}
  }
  const route=async(name,args)=>{
   if(name==='get_group_state')return read(args.p_pin);
   if(name==='save_group_state'){
    try{return await commit('save',args.p_pin,clone(args.p_state),capture(args.p_state,args.p_pin),args.p_state);}catch(_){return error();}
   }
   return raw.rpc(name,args);
  };
  const proxy=new Proxy(raw,{get(target,key){
   if(key==='rpc')return route;
   const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
  }});
  return {db:proxy,capture,commit,recover,
   entryStatus(state,pin){const c=versions.get(state);return c&&c.pin===pin?{closed:c.closed,open:c.phase==='open'}:{closed:true,open:false};},
   clear(){generation++;current=null;secret=null;pending=null;},
   clearCredential(){secret=null;generation++;},
   hasPending(){return Boolean(pending);}};
 }
 return {validateBuild,create};
});
