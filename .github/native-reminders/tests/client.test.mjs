import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {create}=createRequire(import.meta.url)('../../../app/native-reminders.js');
const fid='synthetic-phone-1234567890';
function setup(override){let preference=true,n=0;const requests=[],messages=[];
 const options={userId:'synthetic-user',id:()=>String(++n),send:m=>messages.push(m),request:async(name,body)=>{requests.push({name,body});if(override)return override(name,body);if(name==='iig_set_native_reminders')preference=body.p_enabled;if(name==='iig_register_native_reminders')return preference;if(name==='iig_unregister_native_reminders')return true;return {enabled:preference,available:true};}};
 return{options,requests,messages,c:create(options)};}
test('phone registers only after permission; quiet delivery explained',async()=>{
 for(const permission of ['authorized','provisional']){const{c,messages,requests}=setup();try{await c.refresh();assert.equal(requests.length,1);await c.receive({requestId:messages[0].requestId,permission,fid});assert.equal(c.state.phase,'ready');assert.equal(requests.at(-1).name,'iig_register_native_reminders');if(permission==='provisional')assert.match(c.state.message,/quietly/);}finally{c.dispose();}}
});
test('off persists across reopening without phone registration',async()=>{
 const{c,messages,requests,options}=setup();let second;try{await c.setEnabled(false);assert.equal(c.state.phase,'off');assert.equal(messages[0].action,'pause');c.dispose();second=create(options);await second.refresh();assert.equal(second.state.enabled,false);assert.ok(!requests.some(r=>r.name==='iig_register_native_reminders'));}finally{c.dispose();second?.dispose();}
});
test('denied permission unregisters phone and gives Settings instructions',async()=>{
 const{c,messages,requests}=setup();try{await c.refresh();await c.receive({requestId:messages[0].requestId,permission:'denied',fid});assert.equal(c.state.phase,'blocked');assert.match(c.state.message,/Settings/);assert.equal(requests.at(-1).name,'iig_unregister_native_reminders');}finally{c.dispose();}
});
test('stale callbacks cannot register after another request or sign-out',async()=>{
 const{c,messages,requests}=setup();await c.refresh();await c.receive({requestId:'wrong',permission:'authorized',fid});assert.equal(requests.length,1);c.dispose();await c.receive({requestId:messages[0].requestId,permission:'authorized',fid});assert.equal(requests.length,1);
});
test('disabled rollout does not prompt; failed save does not falsely confirm off',async()=>{
 const a=setup(async()=>({available:false,enabled:true})),b=setup(async()=>{throw Error('offline');});try{await a.c.refresh();assert.equal(a.messages.length,0);assert.equal(a.c.state.phase,'unavailable');await b.c.setEnabled(false);assert.equal(b.c.state.enabled,true);assert.equal(b.c.state.phase,'error');}finally{a.c.dispose();b.c.dispose();}
});
test('malformed or failed native registration never claims readiness',async()=>{
 for(const detail of [{fid:'bad'},{error:true}]){const{c,messages}=setup();try{await c.refresh();await c.receive({requestId:messages[0].requestId,permission:'authorized',...detail});assert.equal(c.state.phase,'error');}finally{c.dispose();}}
});
