/* Runs before the real app in the explicitly generated local demo document only. */
(() => {
 'use strict';
 if(document.querySelector('meta[name="iig-local-demo"]')?.content!=='isolated-v1')throw Error('Not an isolated demonstration document');
 const scenarios=['new','returning','friend','readback-error','save-error'];
 const requested=new URLSearchParams(location.search).get('scenario');
 const scenario=scenarios.includes(requested)?requested:'new';
 const data=new Map(),groups=new Map(),identities=new Map();
 let serial=10,pinNumber=7394,sessionEmail='',lastEmail='',requests=0,blocked=0,readbackFailure=false,saveFailure=scenario==='save-error';
 let notice;
 const clone=value=>JSON.parse(JSON.stringify(value));
 const uuid=()=> 'd0000000-0000-4000-8000-'+String(++serial).padStart(12,'0');
 const storage={getItem:key=>data.get(String(key))??null,setItem:(key,value)=>data.set(String(key),String(value)),removeItem:key=>data.delete(String(key)),clear:()=>data.clear()};
 const api={isolated:true,storage,uuid,open:simulateOpen,share:async details=>preview(details.text||'Simulated share'),clipboard:Object.freeze({writeText:async text=>preview('Simulated copy — nothing copied:\n'+text)}),purchase:Object.freeze({postMessage:()=>preview('Purchases are disabled in this demonstration.')}),practice:Object.freeze({snapshot:practiceSnapshot,addFriends:practiceFriends,fillOtherScores:practiceScores,asOrganiser:practiceOrganiser}),get metrics(){return {requests,blocked,groups:groups.size};}};
 Object.defineProperty(window,'IIG_DEMO',{value:Object.freeze(api),writable:false,configurable:false});
 window.TENS_IN_CONFIG=Object.freeze({supabaseUrl:'',supabaseKey:''});
 function note(text){const el=document.getElementById('iig-demo-note');if(el)el.textContent=text;}
 function updateMetrics(){const el=document.getElementById('iig-demo-metrics');if(el)el.textContent=requests+' simulated requests · '+blocked+' blocked attempts · no server-side data';}
 function stop(){blocked++;updateMetrics();throw new TypeError('This demonstration blocks unrecognised or external requests.');}
 function preview(text){
  const box=document.getElementById('iig-demo-preview');
  if(box){box.textContent=String(text);box.hidden=false;notice?.open();box.scrollIntoView?.({block:'nearest'});}
  note('Simulation only. Nothing was opened, copied or sent.');
 }
 // There is deliberately no saved native fetch reference and no network fallback.
 window.fetch=async(input,options={})=>{
  const url=new URL(typeof input==='string'?input:input.url,location.origin);
  if(url.origin!==location.origin || !['POST','PUT'].includes(options.method))return stop();
  let body;try{body=JSON.parse(options.body||'{}');}catch(_){return stop();}
  const path=url.pathname;
  const allowed=['/auth/v1/otp','/auth/v1/verify','/auth/v1/logout',
   ...['iig_get_owned_group','iig_create_owned_group','get_group_access_status','iig_join_owned_group',
       'iig_get_player_group','iig_save_owned_group','iig_set_my_attendance','iig_submit_my_score'].map(p=>'/rest/v1/rpc/'+p)];
  if(!allowed.includes(path))return stop();
  requests++;updateMetrics();
  const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
  const error=(message,status=400,code='DEMONSTRATION')=>reply({message,msg:message,code},status);
  const owned=()=>[...groups.values()].find(g=>g.owner===sessionEmail);
  const byPin=()=>groups.get(String(body.p_pin));
  const validHandicap=value=>Number.isFinite(value)&&value>=-10&&value<=60&&Math.abs(value*10-Math.round(value*10))<1e-8;
  const needAuth=!path.startsWith('/auth/');
  if(needAuth && (!sessionEmail||options.headers?.Authorization!=='Bearer DEMONSTRATION_ONLY'))return error('Demonstration sign-in required',401);
  if(path==='/auth/v1/otp'){
   if(!/^[^\s@]+@example\.test$/i.test(body.email||''))return error('Use a fictional address such as alex@example.test. No email will be sent.');
   lastEmail=body.email.toLowerCase();note('Simulated email for '+lastEmail+'. Use code 123456; no email was sent.');return reply({});
  }
  if(path==='/auth/v1/verify'){
   if(body.email?.toLowerCase()!==lastEmail||body.token!=='123456')return error('Simulated incorrect/expired code',403);
   sessionEmail=lastEmail;if(!identities.has(sessionEmail))identities.set(sessionEmail,uuid());
   return reply({access_token:'DEMONSTRATION_ONLY',expires_in:3600,user:{id:identities.get(sessionEmail),email:sessionEmail}});
  }
  if(path==='/auth/v1/logout'){sessionEmail='';return reply({});}
  if(path.endsWith('/iig_get_owned_group')){
   if(readbackFailure){readbackFailure=false;return error('Simulated saved-group readback failure. Use Check my group.',503);}
   const g=owned();return reply(g?view(g):null);
  }
  if(path.endsWith('/iig_create_owned_group')){
   if(owned())return reply(view(owned()));
   if(saveFailure){saveFailure=false;return error('Simulated connection failure. Your details are kept; tap Create my group to retry.',503);}
   if(!String(body.p_name||'').trim()||!String(body.p_organiser_name||'').trim())return error('Enter fictional group and organiser names.');
   const g=makeGroup(String(pinNumber++),body.p_name,sessionEmail,body.p_organiser_name);groups.set(g.group_pin,g);
   if(scenario==='readback-error')readbackFailure=true;
   return reply({group_pin:g.group_pin,group_id:g.group_id});
  }
  if(path.endsWith('/get_group_access_status'))return reply(byPin()?[{access_allowed:true,plan_type:'trial'}]:[]);
  if(path.endsWith('/iig_save_owned_group')){
   const g=byPin();if(!g||g.owner!==sessionEmail)return error('Demonstration organiser access required',403);
   if(body.p_revision!==g.revision)return error('Group changed; reload before saving',409);
   if(!body.p_state||!Array.isArray(body.p_state.players)||!Array.isArray(body.p_state.history))return error('Invalid demonstration state');
   g.state=clone(body.p_state);return reply(++g.revision);
  }
  if(path.endsWith('/iig_join_owned_group')){
   const g=byPin();if(!g||body.p_invite!==g.invite_token)return error('Invalid demonstration invitation',403);
   if(!body.p_name?.trim()||!validHandicap(body.p_handicap))return error('Enter a name and handicap from -10 to 60 with up to one decimal place.');
   if(g.members.has(sessionEmail))return reply(g.members.get(sessionEmail));
   const id=uuid();g.members.set(sessionEmail,id);g.state.players.push({id,name:body.p_name.trim(),handicap:body.p_handicap,paid:false,playingThisRound:false,stableford:null,netScore:null,scoreSubmitted:false,leaguePoints:0,wins:0});g.revision++;return reply(id);
  }
  if(path.endsWith('/iig_get_player_group')){
   const g=byPin(),id=g?.members.get(sessionEmail);
   if(!id)return error('Group membership required',403,'42501');
   return reply({player_id:id,revision:g.revision,plan_type:'trial',state:clone(g.state)});
  }
  const g=byPin(),id=g?.members.get(sessionEmail),player=g?.state.players.find(p=>p.id===id);
  if(!player)return error('Demonstration membership required',403);
  if(body.p_revision!==g.revision)return error('Group changed; reload before saving',409);
  if(!g.state.roundOpen)return error('No demonstration competition is open yet');
  if(path.endsWith('/iig_set_my_attendance'))player.playingThisRound=body.p_attending===true;
  else if(path.endsWith('/iig_submit_my_score')){
   if(!Number.isInteger(body.p_score)||body.p_score<0||body.p_score>(g.state.pointsCompetition==='net'?999:99)||body.p_format!==g.state.pointsCompetition||!player.playingThisRound)return error('Enter a valid whole final score for your entered competition');
   player[g.state.pointsCompetition==='net'?'netScore':'stableford']=body.p_score;player.scoreSubmitted=true;
  }
  return reply(++g.revision);
 };
 function view(g){const {members,owner,...result}=g;return clone(result);}
 function makeGroup(pin,name,owner,organiser){return {group_pin:pin,group_id:++serial,revision:0,invite_token:uuid(),owner,members:new Map(),admin_name:organiser,admin_contact:owner,plan_type:'trial',state:{groupName:name,course:'',date:'',stake:0,gameType:'points',roundOpen:false,pointsCompetition:'stableford',pointsValue:10,players:[],history:[]}};}
 if(['returning','friend'].includes(scenario)){
  const g=makeGroup('4826','Saturday Demo Golfers','alex@example.test','Alex Taylor');groups.set(g.group_pin,g);
  if(scenario==='friend'&&document.querySelector('meta[name="iig-hosted-demo"]')){
   Object.assign(g.state,{course:'Fictional Meadow Golf',date:new Date().toISOString().slice(0,10),roundId:uuid(),roundOpen:true});
   const id=uuid();g.members.set('riley@example.test',id);g.state.players.push({id,name:'Riley Woods',handicap:14.2,playingThisRound:true,stableford:null,netScore:null,scoreSubmitted:false,leaguePoints:0,wins:0});
  }
  if(scenario==='friend')history.replaceState(null,'',location.pathname+'?scenario=friend#pin=4826&invite='+g.invite_token);
 }
 function practiceSnapshot(){
  const g=[...groups.values()].find(g=>g.owner===sessionEmail||g.members.has(sessionEmail));
  return g?{pin:g.group_pin,owner:g.owner===sessionEmail,roundOpen:g.state.roundOpen===true,history:g.state.history.length,players:g.state.players.length,entered:g.state.players.filter(p=>p.playingThisRound).length,submitted:g.state.players.filter(p=>p.playingThisRound&&p.scoreSubmitted).length,mySubmitted:g.state.players.some(p=>p.id===g.members.get(sessionEmail)&&p.scoreSubmitted)}:null;
 }
 function practiceFriends(){
  const g=[...groups.values()].find(g=>g.owner===sessionEmail);if(!g||!g.state.roundOpen)throw Error('Create your practice competition first.');
  if(g.state.players.some(p=>p.scoreSubmitted))throw Error('Practice players must be prepared before scoring starts.');
  for(const [email,name,handicap] of [['riley@example.test','Riley Woods',14.2],['casey@example.test','Casey Hill',22.7]]){
   if(g.members.has(email))continue;
   const id=uuid();g.members.set(email,id);g.state.players.push({id,name,handicap,paid:false,playingThisRound:true,stableford:null,netScore:null,scoreSubmitted:false,wins:0,leaguePoints:0});
  }
  for(const p of g.state.players)p.playingThisRound=true;
  g.revision++;document.getElementById('secureOrganiserReload')?.click();
 }
 function practiceScores(){
  const g=[...groups.values()].find(g=>g.owner===sessionEmail||g.members.has(sessionEmail));if(!g||!g.state.roundOpen)throw Error('Open a practice competition first.');
  const mine=g.members.get(sessionEmail);let score=g.state.pointsCompetition==='net'?74:32;
  for(const p of g.state.players){if(p.id===mine||!p.playingThisRound||p.scoreSubmitted)continue;p[g.state.pointsCompetition==='net'?'netScore':'stableford']=score++;p.scoreSubmitted=true;}
  g.revision++;document.getElementById(g.owner===sessionEmail?'secureOrganiserReload':'securePlayerReload')?.click();
 }
 async function practiceRequest(path,body){
  const response=await window.fetch(location.origin+path,{method:'POST',headers:{Authorization:'Bearer DEMONSTRATION_ONLY'},body:JSON.stringify(body)});
  const value=await response.json();if(!response.ok)throw Error(value.message||'Practice action failed');return value;
 }
 function practiceOrganiser(){
  const g=[...groups.values()].find(g=>g.members.has(sessionEmail));if(!g)throw Error('Join the fictional group first.');
  if(!g.state.players.some(p=>p.id===g.members.get(sessionEmail)&&p.scoreSubmitted))throw Error('Submit your own practice score first.');
  practiceScores();window.iigSecurePlayer?.close();sessionEmail=g.owner;
  window.iigSecureOrganiser.open(view(g),practiceRequest,()=>location.assign('/app/?scenario=new'),'trial');
 }
 function simulateOpen(url){preview('Simulated destination — not opened:\n'+String(url));return {closed:false,close(){}};}
 const blockedConstructor=function(){return stop();};
 for(const name of ['XMLHttpRequest','WebSocket','EventSource','Worker','SharedWorker'])window[name]=blockedConstructor;
 window.open=simulateOpen;
 try{navigator.sendBeacon=()=>{blocked++;updateMetrics();return false;};}catch(_){}
 try{navigator.share=async details=>preview(details.text||'Simulated share');}catch(_){}
 try{if(navigator.clipboard)navigator.clipboard.writeText=async text=>preview('Simulated copy — nothing copied:\n'+text);}catch(_){}
 try{if(navigator.serviceWorker)navigator.serviceWorker.register=async()=>{throw new Error('Service workers are disabled in this demonstration.');};}catch(_){}
 window.IigPurchase=Object.freeze({postMessage:()=>preview('Purchases are disabled in this demonstration.')});
 window.addEventListener('securitypolicyviolation',()=>{blocked++;updateMetrics();});
 window.addEventListener('submit',event=>event.preventDefault(),true);
 const destinations=new WeakMap();
 function neutraliseLinks(){
  for(const link of document.querySelectorAll('a[href]')){
   const href=link.getAttribute('href');
   if(href!=='#iig-demonstration'){destinations.set(link,href);link.setAttribute('href','#iig-demonstration');}
   if(link.hasAttribute('target'))link.removeAttribute('target');if(link.hasAttribute('download'))link.removeAttribute('download');
  }
 }
 // Neutralise hrefs as well as clicks: long-press/context-menu cannot open WhatsApp.
 new MutationObserver(neutraliseLinks).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['href','target','download']});
 window.addEventListener('click',event=>{
  const copy=event.target.closest?.('#secureInviteCopy');
  if(copy){event.preventDefault();event.stopImmediatePropagation();preview('DEMONSTRATION COPY — NOT COPIED\n\n'+(document.getElementById('secureInviteLink')?.dataset.message||''));return;}
  const link=event.target.closest?.('a');if(!link)return;
  event.preventDefault();event.stopImmediatePropagation();
  const url=new URL(destinations.get(link)||link.getAttribute('href')||'',location.origin);
  if(url.hash.startsWith('#iig-demo-whatsapp='))preview('DEMONSTRATION WHATSAPP INVITATION — NOT SENT\n\n'+decodeURIComponent(url.hash.slice('#iig-demo-whatsapp='.length)));
  else preview('DEMONSTRATION LINK — NOT OPENED\n\n'+url.href+'\n\nUse Review controls → Friend joining to try a fictional invitation.');
 },true);
 window.addEventListener('auxclick',event=>{if(event.target.closest?.('a'))event.preventDefault();},true);
 document.addEventListener('DOMContentLoaded',()=>{
  const panel=document.createElement('dialog');
  panel.innerHTML='<div class="demo-notice-heading"><h2>Demonstration only</h2><button type="button" data-demo-notice-close>Close</button></div><p>This is a fictional practice version. No real accounts, emails, payments or WhatsApp messages are created or sent. Your practice data stays in this tab and resets on reload. Real golf groups and scores are never loaded.</p><h3>Review controls</h3><p>Use made-up details only. Everything is in browser memory and resets on reload. Mac and iPhone have separate fictional data.</p><p><b>Demo email:</b> alex@example.test<br><b>Demo code:</b> 123456<br>Try 000000 for an incorrect/expired code.</p><label for="iig-demo-scenario">Choose a scenario</label><select id="iig-demo-scenario"><option value="new">New organiser</option><option value="returning">Returning organiser — existing group</option><option value="friend">Friend joining by invitation</option><option value="readback-error">Group created, confirmation read fails once</option><option value="save-error">Group creation fails once, then retry</option></select><button id="iig-demo-reset" type="button">Start selected scenario / reset</button><button id="iig-demo-prefill" type="button">Fill fictional details</button><button id="iig-demo-code" type="button">Fill demo email code</button><details><summary>Test handicap typing and paste</summary><p>Type 12, then 3: the third digit is blocked. Enter a dot, then 7: 12.7 is accepted. Invalid pastes leave the previous value unchanged.</p><label for="iig-demo-handicap">Handicap playground</label><input id="iig-demo-handicap" inputmode="decimal"><label for="iig-demo-valid">Valid sample — select and copy manually</label><input id="iig-demo-valid" readonly value="22.7"><label for="iig-demo-invalid">Invalid sample — select and copy manually</label><input id="iig-demo-invalid" readonly value="112"><p>The real joining and organiser fields use the same input guard.</p></details><p id="iig-demo-note" role="status" aria-live="polite">This is a local simulation, not an online TEST verification.</p><p id="iig-demo-metrics"></p><pre id="iig-demo-preview" hidden></pre><p><b>Database review still required:</b> bulk organiser edits do not independently validate every handicap server-side. This demo does not close or test that gap.</p><button id="iig-demo-close" type="button">Close review controls</button>';
  notice=window.iigDemoNotice.mount(panel);
  const el=id=>document.getElementById(id);
  el('iig-demo-close').onclick=notice.close;
  el('iig-demo-scenario').value=scenario;
  el('iig-demo-reset').onclick=()=>location.assign('/app/?scenario='+encodeURIComponent(el('iig-demo-scenario').value));
  function fill(){
   const values={regName:'Alex Taylor',regGroupName:'Weekend Demo Golfers',regSetupEmail:'alex@example.test',regEmail:scenario==='friend'?'jamie@example.test':'alex@example.test',regPlayerName:'Jamie Green',regOwnerPlayerName:'Alex Taylor'};
   for(const [id,value] of Object.entries(values)){const input=el(id);if(input)input.value=value;}
   note('Fictional details filled. Close these controls, then use the real screen buttons.');
  }
  el('iig-demo-prefill').onclick=fill;
  el('iig-demo-code').onclick=()=>{el('regCode').value='123456';note('Demonstration code filled. Close these controls and tap Verify.');};
  window.iigHandicap.bind(el('iig-demo-handicap'));
  for(const id of ['iig-demo-valid','iig-demo-invalid'])el(id).onclick=()=>el(id).select();
  fill();updateMetrics();
  if(scenario==='returning'){el('regReturning')?.click();note('Returning organiser: sign in as alex@example.test with code 123456 to reopen fictional group 4826.');}
 });
})();
