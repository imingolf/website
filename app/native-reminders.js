/* Native competition reminders use the existing verified account transport. */
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 if(typeof document==='undefined')return;
 let current=null,account=null;
 const bridge=()=>window.IigNotifications;
 const notify=()=>{const box=document.getElementById('iigReminderSettings');if(box)render(box);};
 function render(box){
  const state=current?.state;box.hidden=!(state?.available||state?.sideAvailable);if(box.hidden)return;
  box.replaceChildren();
  const label=document.createElement('label');label.style.cssText='display:flex;align-items:center;gap:12px';
  const input=document.createElement('input');input.type='checkbox';input.checked=state.enabled;input.disabled=state.busy;
  input.setAttribute('role','switch');input.setAttribute('aria-label','Competition reminders');input.style.cssText='width:24px;height:24px';
  const text=document.createElement('strong');text.textContent='Competition reminders '+(state.enabled?'On':'Off');label.append(input,text);
  const detail=document.createElement('p');detail.className='muted';detail.textContent='When a competition opens, three days before and the night before. Timed reminders arrive at 6pm in your group’s time zone.';
  const status=document.createElement('p');status.setAttribute('role','status');status.textContent=state.message;
  if(state.available)box.append(label,detail);
  if(state.sideAvailable){
   const sideLabel=document.createElement('label');sideLabel.style.cssText='display:flex;align-items:center;gap:12px;margin-top:20px';
   const sideInput=document.createElement('input');sideInput.type='checkbox';sideInput.checked=state.sideEnabled;sideInput.disabled=state.busy;
   sideInput.setAttribute('role','switch');sideInput.setAttribute('aria-label','Side Game invites');sideInput.style.cssText='width:24px;height:24px';
   const sideText=document.createElement('strong');sideText.textContent='Side Game invites '+(state.sideEnabled?'On':'Off');
   sideLabel.append(sideInput,sideText);box.append(sideLabel);
   const explanation=document.createElement('p');explanation.className='muted';explanation.textContent='A phone alert when someone invites you to a Side Game. Tap it to open your group, then choose View invite.';box.append(explanation);
   sideInput.onchange=()=>current?.setSideEnabled(sideInput.checked);
  }
  box.append(status);input.onchange=()=>current?.setEnabled(input.checked);
  if(((state.available&&state.enabled)||(state.sideAvailable&&state.sideEnabled))&&['blocked','error'].includes(state.phase)){
   const retry=document.createElement('button');retry.type='button';retry.className='secondary full';retry.disabled=state.busy;
   retry.textContent='Check notifications again';retry.onclick=()=>current?.refresh();box.append(retry);
  }
 }
 window.iigNativeReminders={
  connect(userId,request){
   if(!bridge()?.postMessage||account===userId)return;
   current?.dispose();account=userId;
   current=api.create({userId,request:(name,body)=>request('/rest/v1/rpc/'+name,{...body,p_account:userId},true),
    send:message=>bridge().postMessage(JSON.stringify(message)),changed:notify});
   current.refresh();
  },
  clear(){current?.dispose();current=null;account=null;try{bridge()?.postMessage(JSON.stringify({action:'clear',requestId:'clear'}));}catch(_){}notify();},
  mount(parent){if(!bridge()?.postMessage||!current)return;const box=document.createElement('section');box.id='iigReminderSettings';parent.append(box);render(box);},
  handleTap(pin){
   if(!/^\d{4}$/.test(pin||''))return;
   const adapter=window.iigSecureOrganiser?.active?window.iigSecureOrganiser:window.iigSecurePlayer;
   if(adapter?.active&&!adapter.canSwitchView){window.showAppToast?.('Finish your current action','Save or cancel your entry before opening another competition.');return;}
   if(location.hash==='#pin='+pin)return;
   location.assign(location.pathname+'#pin='+pin);
  }
 };
 window.addEventListener('iig-native-notifications',event=>{
  if(event.detail?.type==='ready'){current?.nativeReady();return;}
  if(event.detail?.type==='open'){window.iigNativeReminders.handleTap(event.detail.pin);return;}
  current?.receive(event.detail);
 });
})(typeof globalThis!=='undefined'?globalThis:this,()=>{
 'use strict';
 function create({userId,request,send,changed=()=>{},id=()=>crypto.randomUUID()}){
  let disposed=false,generation=0,nonce=null,fid=null,timer=null;
  const state={available:false,enabled:true,sideAvailable:false,sideEnabled:false,busy:false,phase:'loading',message:''};
  const update=values=>{Object.assign(state,values);if(!disposed)changed({...state});};
  const current=n=>!disposed&&n===generation;
  const clear=()=>{clearTimeout(timer);timer=null;nonce=null;};
  const fail=()=>{clear();update({busy:false,phase:'error',message:'Reminders could not connect. Check your connection and try again.'});};
  function sync(n){
   if(!current(n))return;clear();
   if(!state.available&&!state.sideAvailable){update({busy:false,phase:'unavailable',message:''});return;}
   if(!(state.available&&state.enabled)&&!(state.sideAvailable&&state.sideEnabled)){send({action:'pause',requestId:id()});update({busy:false,phase:'off',message:'Phone alerts are off for your account.'});return;}
   nonce=id();update({busy:true,phase:'connecting',message:'Checking this phone’s notification permission…'});
   timer=setTimeout(()=>{if(current(n))fail();},25000);
   send({action:'sync',requestId:nonce,allowPrompt:true});
  }
  return {
   get state(){return {...state};},
   nativeReady(){if(disposed)return;if(state.phase==='connecting'){sync(generation);}else if(!state.busy){this.refresh();}},
   async refresh(){
    if(disposed||state.busy)return;const n=++generation;clear();update({busy:true,phase:'loading',message:'Checking reminders…'});
    try{const result=await request('iig_get_native_reminders',{});if(!current(n))return;
     if(typeof result?.enabled!=='boolean'||typeof result?.available!=='boolean')throw Error();
     update({available:result.available,enabled:result.enabled,sideAvailable:result.sideAvailable===true,sideEnabled:result.sideEnabled===true});sync(n);
    }catch(_){if(current(n))fail();}
   },
   async setEnabled(enabled){
    if(disposed||state.busy||typeof enabled!=='boolean')return;const n=++generation;clear();update({busy:true});
    try{const result=await request('iig_set_native_reminders',{p_enabled:enabled});if(!current(n))return;
     if(result?.enabled!==enabled)throw Error();update({available:!!result.available,enabled,sideAvailable:result.sideAvailable===true,sideEnabled:result.sideEnabled===true});sync(n);
    }catch(_){if(current(n))fail();}
   },
   async setSideEnabled(enabled){
    if(disposed||state.busy||typeof enabled!=='boolean')return;const n=++generation;clear();update({busy:true});
    try{const result=await request('iig_set_side_invites',{p_enabled:enabled});if(!current(n))return;
     if(result?.sideEnabled!==enabled||typeof result?.enabled!=='boolean')throw Error();
     update({available:!!result.available,enabled:result.enabled,sideAvailable:!!result.sideAvailable,sideEnabled:enabled});sync(n);
    }catch(_){if(current(n))fail();}
   },
   async receive(message){
    if(disposed||!nonce||message?.requestId!==nonce)return;
    const n=generation;clear();
    const phoneFid=typeof message.fid==='string'&&/^[A-Za-z0-9_-]{20,128}$/.test(message.fid)?message.fid:null;
    try{
     if(message.error)throw Error();
     if(!['authorized','provisional'].includes(message.permission)){
      if(phoneFid||fid)await request('iig_unregister_native_reminders',{p_fid:phoneFid||fid});
      if(current(n))update({busy:false,phase:'blocked',message:'Allow notifications for I’m In Golf in iPhone Settings, then check again.'});return;
     }
     if(!phoneFid)throw Error();fid=phoneFid;
     const registered=await request('iig_register_native_reminders',{p_fid:fid});if(!current(n))return;
     if(registered!==true){update({busy:false,phase:'error',message:'Notification settings changed. Check notifications again.'});return;}
     update({busy:false,phase:'ready',message:message.permission==='provisional'?'Reminders will arrive quietly. Allow alerts in iPhone Settings for banners and sounds.':'This phone is ready for the alerts you have switched on.'});
    }catch(_){if(current(n))fail();}
   },
   dispose(){disposed=true;generation++;clear();}
  };
 }
 return {create};
});
