from pathlib import Path
import re,sys,json,shutil
root=Path(__file__).resolve().parents[3]
qa=Path(sys.argv[1]).resolve();dist=qa/'dist';dist.mkdir(parents=True,exist_ok=True)
styles='\n'.join(re.findall(r'<style[^>]*>.*?</style>',(root/'app/index.html').read_text(),re.S))
for name in ['native-reminders.js','account-controls.js']:
 shutil.copyfile(root/'app'/name,dist/name)
html='''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'self' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'none'; frame-src 'none'; form-action 'none'; object-src 'none'">
<title>Reminder checks</title>'''+styles+'''</head><body><pre id="results">Running settings checks…</pre>
<script>
window.IIG_ACCOUNT_ACCESS={};window.iigHandicap={bind(){}};
window.testState={permission:'authorized',saved:true,calls:[],messages:[],fail:false};
window.IigNotifications={postMessage(raw){const m=JSON.parse(raw);testState.messages.push(m);if(m.action==='sync')queueMicrotask(()=>dispatchEvent(new CustomEvent('iig-native-notifications',{detail:{requestId:m.requestId,permission:testState.permission,fid:'synthetic-phone-1234567890'}})));}};
window.mockRequest=async(path,body,auth)=>{if(!auth||body.p_account!=='synthetic-user')throw Error('Missing verified identity');testState.calls.push({path,body,auth});if(testState.fail)throw Error('offline');if(path.endsWith('iig_set_native_reminders'))testState.saved=body.p_enabled;if(path.endsWith('iig_register_native_reminders'))return testState.saved;if(path.endsWith('iig_unregister_native_reminders'))return true;return{enabled:testState.saved,available:true};};
</script><script src="native-reminders.js"></script><script src="account-controls.js"></script>
<script>
(async()=>{const checks=[],assert=(ok,name)=>{if(!ok)throw Error(name);checks.push(name);},tick=()=>new Promise(r=>setTimeout(r,30)),box=()=>document.querySelector('#iigReminderSettings'),sw=()=>box().querySelector('[role=switch]');
try{
 iigNativeReminders.connect('synthetic-user',mockRequest);await tick();iigAccount.configure({focused:true,currentEmail:()=> 'golfer@example.test'});iigAccount.open();
 assert(sw().checked,'default on');assert(box().textContent.includes('ready for automatic'),'ready after permission');assert(box().textContent.includes('three days before and the night before'),'all reminder times explained');
 assert(box().nextElementSibling.id==='accountMessage','setting lives inside My account');
 sw().click();await tick();assert(!sw().checked&&box().textContent.includes('are off'),'off saved');iigAccount.close();iigAccount.open();assert(!sw().checked,'off after reopening');
 iigNativeReminders.clear();iigNativeReminders.connect('synthetic-user',mockRequest);await tick();iigAccount.close();iigAccount.open();assert(!sw().checked,'off after account restoration');
 sw().click();await tick();assert(sw().checked&&box().textContent.includes('ready for automatic'),'on restored');
 testState.permission='denied';dispatchEvent(new CustomEvent('iig-native-notifications',{detail:{type:'ready'}}));await tick();assert(box().textContent.includes('iPhone Settings'),'OS denial explained');assert(testState.calls.at(-1).path.endsWith('iig_unregister_native_reminders'),'denied phone unregistered');
 testState.permission='authorized';box().querySelector('button').click();await tick();assert(box().textContent.includes('ready for automatic'),'permission recovery');
 testState.fail=true;sw().click();await tick();assert(sw().checked&&box().textContent.includes('could not connect'),'failed off save does not lie');testState.fail=false;
 const count=testState.calls.length;iigNativeReminders.clear();dispatchEvent(new CustomEvent('iig-native-notifications',{detail:{requestId:'stale',permission:'authorized',fid:'synthetic-phone-1234567890'}}));await tick();assert(testState.calls.length===count,'signed-out stale callback ignored');
 const native=IigNotifications;delete window.IigNotifications;iigNativeReminders.connect('synthetic-user',mockRequest);iigAccount.close();iigAccount.open();assert(!box(),'ordinary browser has no native setting');window.IigNotifications=native;
 iigNativeReminders.connect('synthetic-user',mockRequest);await tick();iigAccount.close();iigAccount.open();
 window.qaResults={passed:checks.length,checks};document.getElementById('results').textContent=JSON.stringify(qaResults,null,2);window.scrollTo(0,0);document.getElementById('iigAccountDialog').scrollTop=0;
}catch(e){window.qaResults={passed:checks.length,error:e.message,checks};document.getElementById('results').textContent=JSON.stringify(qaResults,null,2);}
})();
</script></body></html>'''
(dist/'index.html').write_text(html)
(qa/'.openai').mkdir(exist_ok=True);(qa/'.openai/hosting.json').write_text(json.dumps({'static':{'directory':'dist'}}))
print(qa)
