/* Isolated QA transport. Synthetic identities only; no real Auth, data or payment calls. */
(() => {
 'use strict';
 const key='iig-reconnection-qa-v1',clone=x=>x==null?x:JSON.parse(JSON.stringify(x));
 const users={wrong:{id:'11111111-1111-4111-8111-111111111111',email:'gaspinall@kieurope.com'},linked:{id:'22222222-2222-4222-8222-222222222222',email:'linked@example.com'},owner:{id:'33333333-3333-4333-8333-333333333333',email:'owner@example.com'}};
 const newSession=(who='wrong')=>({access_token:'qa-access-'+who,refresh_token:'qa-refresh-'+who,user:{...users[who],email_confirmed_at:'2026-11-15T10:00:00Z',is_anonymous:false},expires_at:Math.floor(Date.now()/1000)+3600});
 let db;try{db=JSON.parse(localStorage.getItem(key)||'null')}catch(_){}
 db ||= {session:newSession(),links:{'1260':users.linked.id,'7196':users.wrong.id}};
 const persist=()=>localStorage.setItem(key,JSON.stringify(db));persist();
 localStorage.setItem('iig-last-group-v1-'+users.wrong.id,'7196');
 const calls=[];let failSignout=false;
 const error=(message,code='42501',status=403)=>({status,data:{message,code}});
 const data=pin=>({group_pin:pin,group_id:Number(pin),player_id:'qa-player-'+pin,revision:1,invite_token:'44444444-4444-4444-8444-444444444444',entry:{open:false,closed:false,entrantIds:null},plan_type:'complimentary',state:{groupName:'QA Golf '+pin,course:'',date:'',stake:0,gameType:'money',roundOpen:false,pointsCompetition:'stableford',pointsValue:10,players:[{id:'qa-player-'+pin,name:'Existing Player',handicap:11.2,paid:false,stableford:null,netScore:null,playingThisRound:false,wins:0,leaguePoints:0,netWinnings:0}],history:[]}});
 const owns=pin=>pin==='1260'&&db.session?.user.id===users.owner.id||pin==='7196'&&db.session?.user.id===users.wrong.id;
 function rpc(path,body,auth){
  if(path==='/auth/v1/otp')return {data:{}};
  if(path==='/auth/v1/verify'||path==='/auth/v1/token?grant_type=password'){
   if(body.token&&body.token!=='123456')return error('Code expired','otp_expired');
   const who=Object.keys(users).find(k=>users[k].email===body.email);if(!who)return error('Unknown QA account');
   db.session=newSession(who);persist();return {data:clone(db.session)};
  }
  const pin=body.p_pin;
  if(path==='/rest/v1/rpc/get_group_access_status')return {data:[{group_pin:pin,group_name:'QA Golf '+pin,access_allowed:true,plan_type:'complimentary'}]};
  if(!auth||!db.session)return error('Verified organiser sign-in required');
  if(path==='/rest/v1/rpc/iig_get_player_join_options')return {data:{group_pin:pin,group_name:'QA Golf '+pin,pin_join_enabled:pin==='6830'}};
  if(path==='/rest/v1/rpc/iig_list_owned_groups')return {data:['1260','7196'].filter(owns).map(pin=>({group_pin:pin,group_name:'QA Golf '+pin,retired:false,status:'active'}))};
  if(path==='/rest/v1/rpc/iig_read_owned_entry_group'){const d=data(pin);delete d.player_id;return owns(pin)?{data:d}:error('Organiser access required')}
  if(path==='/rest/v1/rpc/iig_read_entry_group'){const d=data(pin);delete d.invite_token;return db.links[pin]===db.session.user.id?{data:d}:error('Group membership required')}
  if(path==='/rest/v1/rpc/iig_claim_player_relink'){
   if(pin!=='1260'||body.p_token!=='a'.repeat(64)||db.session.user.id!==users.owner.id)return error('Invalid reconnection link');
   db.links[pin]=db.session.user.id;persist();return {data:true};
  }
  return error('Unexpected QA write or endpoint: '+path,'QA_ONLY',400);
 }
 window.fetch=async(url,options={})=>{
  const parsed=new URL(String(url),location.href);if(parsed.hostname!=='nyavvwrsrxqfyhiygkgw.supabase.co')throw new TypeError('External requests disabled');
  const path=parsed.pathname+parsed.search,body=JSON.parse(options.body||'{}');calls.push({path,body:clone(body)});
  const reply=rpc(path,body,!!options.headers?.Authorization);
  return new Response(JSON.stringify(reply.data??null),{status:reply.status||200,headers:{'Content-Type':'application/json'}});
 };
 window.supabase={createClient(){let callback=()=>{};return {auth:{
  onAuthStateChange(cb){callback=cb;return {data:{subscription:{unsubscribe(){}}}}},
  async getSession(){return {data:{session:clone(db.session)},error:null}},
  async getUser(){return {data:{user:clone(db.session?.user)},error:db.session?null:Error('No session')}},
  async setSession(){callback('SIGNED_IN',clone(db.session));return {data:{session:clone(db.session)},error:null}},
  async signOut(options){calls.push({path:'SDK.signOut',body:options});if(failSignout){failSignout=false;return {error:Error('Offline')}}db.session=null;persist();callback('SIGNED_OUT',null);return {error:null}},stopAutoRefresh(){}
 },rpc:async()=>({data:null,error:{message:'Legacy access disabled'}})}}};
 window.IIGPreview={calls,get data(){return clone(db)},failSignout(){failSignout=true},signIn(who){db.session=who?newSession(who):null;persist()}};
 window.open=()=>null;
 document.addEventListener('click',e=>{const a=e.target.closest('a[href]');if(a&&new URL(a.href).origin!==location.origin)e.preventDefault()},true);
})();
