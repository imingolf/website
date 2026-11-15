/* Isolated preview transport, never part of the LIVE app. All records are synthetic. */
(() => {
 'use strict';
 const key='iig-multi-group-preview-v1',clone=x=>x==null?x:JSON.parse(JSON.stringify(x));
 const user={id:'11111111-1111-4111-8111-111111111111',email:'preview@example.com',email_confirmed_at:'2026-11-14T10:00:00Z',is_anonymous:false};
 const newSession=()=>({access_token:'preview-only-access',refresh_token:'preview-only-refresh',user:clone(user),expires_at:Math.floor(Date.now()/1000)+3600});
 function group(pin,name,owner=true){return {group_pin:pin,group_id:Number(pin),owner,player_id:'preview-player-'+pin,revision:1,invite_token:'22222222-2222-4222-8222-222222222222',entry:{open:false,closed:false,entrantIds:null},plan_type:'complimentary',state:{groupName:name,course:'',date:'',stake:0,gameType:'money',roundOpen:false,pointsCompetition:'stableford',pointsValue:10,paymentProvider:'monzo',paymentLink:'https://monzo.me/preview'+pin,players:[{id:'preview-player-'+pin,name:'Alex Preview',handicap:11.2,paid:false,stableford:null,netScore:null,playingThisRound:false,wins:0,leaguePoints:0,netWinnings:0}],history:[]}};}
 let db;try{db=JSON.parse(localStorage.getItem(key)||'null')}catch(_){}
 db ||= {session:newSession(),groups:[group('4827','Saturday Golf'),group('5828','Wednesday Golf'),group('6830','Friends’ Golf',false)],requests:{}};
 const persist=()=>localStorage.setItem(key,JSON.stringify(db));persist();
 const calls=[];let failNext=null,delayed=null;
 const error=(message,code='42501',status=403)=>({status,data:{message,code}});
 const owned=g=>{const data=clone(g);delete data.owner;delete data.player_id;delete data.group_id;return data;};
 function rpc(path,body,auth){
  const g=db.groups.find(g=>g.group_pin===body.p_pin);
  if(path==='/auth/v1/otp')return {data:{}};
  if(path==='/auth/v1/verify'||path==='/auth/v1/token?grant_type=password'){
   if(body.token&&body.token!=='123456')return error('Code expired','otp_expired');db.session=newSession();persist();return {data:clone(db.session)};
  }
  if(path==='/rest/v1/rpc/get_group_access_status')return {data:[{group_pin:body.p_pin,group_name:g?.state.groupName,access_allowed:!!g,plan_type:'complimentary'}]};
  if(path==='/rest/v1/rpc/iig_get_player_join_options')return {data:{group_pin:body.p_pin,group_name:g?.state.groupName||'Preview Golf',pin_join_enabled:true}};
  if(!auth||!db.session)return error('Verified organiser sign-in required');
  if(path==='/rest/v1/rpc/iig_list_owned_groups')return {data:db.groups.filter(g=>g.owner).map(g=>({group_pin:g.group_pin,group_name:g.state.groupName,retired:false,status:'active'}))};
  if(path==='/rest/v1/rpc/iig_read_owned_entry_group')return g?.owner?{data:owned(g)}:error('Organiser access required');
  if(path==='/rest/v1/rpc/iig_read_entry_group'){
   if(!body.p_pin)return error('Choose a group before opening organiser access','22023',400);
   if(g?.player_id){const data=owned(g);delete data.invite_token;data.player_id=g.player_id;return {data};}
   return error('Group membership required');
  }
  if(path==='/rest/v1/rpc/iig_create_additional_playing_group'||path==='/rest/v1/rpc/iig_create_owned_playing_group'){
   if(!Number.isFinite(body.p_handicap)||body.p_handicap < -10||body.p_handicap>60)return error('Invalid handicap','22023',400);
   const prior=db.requests[body.p_request_id];if(prior)return {data:clone(prior)};
   if(path.endsWith('/iig_create_owned_playing_group')&&db.groups.some(g=>g.owner))return error('This organiser already has a group','22023',400);
   const pin=String(7829+Object.keys(db.requests).length),created=group(pin,body.p_name);
   created.state.players[0].name=body.p_organiser_name;created.state.players[0].handicap=body.p_handicap;
   delete created.state.paymentProvider;delete created.state.paymentLink;
   db.groups.push(created);const result={group_pin:pin,group_id:Number(pin),player_id:created.player_id};db.requests[body.p_request_id]=result;persist();return {data:clone(result)};
  }
  if(path==='/rest/v1/rpc/iig_operate_owned_group'||path==='/rest/v1/rpc/iig_save_owned_group'){
   if(!g?.owner)return error('Organiser access required');if(body.p_revision!==g.revision)return error('Revision changed. Reload your group.','P0001',409);
   if(body.p_operation&&body.p_operation!=='settings')return error('Competition changes are outside this private review.');
   g.state=clone(body.p_state);g.revision++;persist();return {data:g.revision};
  }
  if(path==='/rest/v1/rpc/iig_join_release_group')return g?{data:true}:error('Group not found');
  return error('This action is outside the multi-group review. No data was changed.','PREVIEW_ONLY',400);
 }
 window.fetch=async(url,options={})=>{
  const parsed=new URL(String(url),location.href);if(parsed.hostname!=='nyavvwrsrxqfyhiygkgw.supabase.co')throw new TypeError('External requests are disabled.');
  const path=parsed.pathname+parsed.search,body=JSON.parse(options.body||'{}');calls.push({path,body:clone(body)});
  if(failNext?.path===path){const f=failNext;failNext=null;return new Response(JSON.stringify({message:f.message||'Preview connection failed',code:'P0001'}),{status:503});}
  const reply=rpc(path,body,!!options.headers?.Authorization);
  if(delayed?.path===path){const pending=delayed;delayed=null;await new Promise(resolve=>pending.release=resolve);}
  return new Response(JSON.stringify(reply.data??null),{status:reply.status||200,headers:{'Content-Type':'application/json'}});
 };
 window.supabase={createClient(){let callback=()=>{};return {auth:{
  onAuthStateChange(cb){callback=cb;return {data:{subscription:{unsubscribe(){}}}}},
  async getSession(){return {data:{session:clone(db.session)},error:null}},
  async getUser(){return {data:{user:clone(db.session?.user)},error:db.session?null:Error('No session')}},
  async setSession(){callback('SIGNED_IN',clone(db.session));return {data:{session:clone(db.session)},error:null}},
  async signOut(){db.session=null;persist();callback('SIGNED_OUT',null);return {error:null}},stopAutoRefresh(){}
 },rpc:async()=>({data:null,error:{message:'Legacy access disabled in preview'}})}}};
 try{Object.defineProperty(navigator,'share',{value:undefined,configurable:true})}catch(_){}
 window.open=()=>null;
 document.addEventListener('click',e=>{const a=e.target.closest('a[href]');if(a&&new URL(a.href).origin!==location.origin)e.preventDefault()},true);
 window.IIGPreview={calls,get data(){return clone(db)},setGroup(g){const i=db.groups.findIndex(x=>x.group_pin===g.group_pin);if(i>=0)db.groups[i]=clone(g);persist()},fail(path,message){failNext={path,message}},delay(path){const pending={path};delayed=pending;return ()=>pending.release?.()},signOut(){db.session=null;persist()}};
 document.addEventListener('DOMContentLoaded',()=>{const bar=document.createElement('aside');bar.id='privatePreviewBar';bar.innerHTML='<span><strong>Private preview · test groups</strong><br>No real emails or payments. Sign-in code: <b>123456</b>.</span><button type="button">Start again</button>';document.body.prepend(bar);bar.querySelector('button').onclick=()=>{localStorage.clear();sessionStorage.clear();location.replace('/app/')};});
})();
