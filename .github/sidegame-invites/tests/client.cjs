const {test}=require('node:test');const assert=require('node:assert/strict');
const {create}=require('../../../app/native-reminders.js');
function setup({competition=false,side=false}={}){
 let prefs={available:true,enabled:competition,sideAvailable:true,sideEnabled:side},messages=[],calls=[];
 const c=create({userId:'user',send:m=>messages.push(m),id:()=>String(messages.length),request:async(name,args)=>{
  calls.push(name);
  if(name==='iig_set_native_reminders')prefs.enabled=args.p_enabled;
  if(name==='iig_set_side_invites')prefs.sideEnabled=args.p_enabled;
  if(name==='iig_register_native_reminders')return true;
  return {...prefs};
 }});
 const ready=()=>c.receive({requestId:messages.at(-1).requestId,permission:'authorized',fid:'synthetic-phone-1234567890'});
 return {c,messages,calls,ready};
}
test('Side Game alone registers without enabling competition reminders',async()=>{
 const {c,messages,ready}=setup();try{await c.refresh();assert.equal(messages.at(-1).action,'pause');await c.setSideEnabled(true);
 assert.equal(messages.at(-1).action,'sync');await ready();assert.equal(c.state.enabled,false);assert.equal(c.state.sideEnabled,true);assert.equal(c.state.phase,'ready');}finally{c.dispose();}
});
test('Competition Off preserves Side Game registration; both Off pauses',async()=>{
 const {c,messages,ready}=setup({competition:true,side:true});try{await c.refresh();await ready();await c.setEnabled(false);
 assert.equal(messages.at(-1).action,'sync');await ready();assert.equal(c.state.sideEnabled,true);
 await c.setSideEnabled(false);assert.equal(messages.at(-1).action,'pause');}finally{c.dispose();}
});
test('Side Game Off preserves competition preference and registration',async()=>{
 const {c,messages,ready}=setup({competition:true,side:true});try{await c.refresh();await ready();await c.setSideEnabled(false);
 assert.equal(c.state.enabled,true);assert.equal(messages.at(-1).action,'sync');await ready();}finally{c.dispose();}
});
test('Late bridge reply after disposal cannot register an old account',async()=>{
 const {c,ready,calls}=setup({side:true});await c.refresh();c.dispose();await ready();assert.ok(!calls.includes('iig_register_native_reminders'));
});
