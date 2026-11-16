/* Isolated transport for actual-app QA. Synthetic sessions only; every write fails. */
(() => {
 const clone=x=>JSON.parse(JSON.stringify(x)),cfg=JSON.parse(localStorage.getItem('iig-group-help-case')||'{}');
 const user={id:'11111111-1111-4111-8111-111111111111',email:'qa@example.com',email_confirmed_at:'2026-11-16T10:00:00Z',is_anonymous:false};
 let session={access_token:'qa-only',refresh_token:'qa-only',user,expires_at:Math.floor(Date.now()/1000)+3600};
 const calls=[],alerts=[],groups={};
 for(const [pin,count] of [['4827',cfg.count??3],['6938',1]])groups[pin]={group_pin:pin,group_id:Number(pin),revision:1,invite_token:'22222222-2222-4222-8222-222222222222',entry:{open:!!cfg.open,closed:!!cfg.closed,entrantIds:cfg.closed?['qa-1']:null},plan_type:'complimentary',state:{groupName:pin==='4827'?'QA Golf':'QA Golf Extended',course:cfg.open?'Test Course':'',date:cfg.open?'2026-11-21':'',roundId:'qa-round',stake:cfg.open?10:0,gameType:'money',roundOpen:!!cfg.open,pointsCompetition:'stableford',pointsValue:10,players:Array.from({length:count},(_,i)=>({id:'qa-'+(i+1),name:'Test Player '+(i+1),handicap:11+i,paid:!!cfg.closed,stableford:cfg.closed&&i===0?36:null,netScore:null,scoreSubmitted:!!cfg.closed&&i===0,playingThisRound:!!cfg.closed,wins:0,leaguePoints:0,netWinnings:0})),history:[]}};
 localStorage.setItem('iig-last-owned-group-v1-'+user.id,'4827');
 const error=message=>({status:403,data:{code:'42501',message}});
 function rpc(path,body,auth){
  const pin=body.p_pin||'4827',g=groups[pin];
  if(path==='/rest/v1/rpc/get_group_access_status')return {data:[{group_pin:pin,group_name:g?.state.groupName,access_allowed:true,plan_type:'complimentary'}]};
  if(!auth||!session)return error('Verified sign-in required');
  if(path==='/rest/v1/rpc/iig_list_owned_groups')return {data:cfg.role==='player'?[]:Object.values(groups).map(g=>({group_pin:g.group_pin,group_name:g.state.groupName,status:'active'}))};
  if(path==='/rest/v1/rpc/iig_read_owned_entry_group')return cfg.role==='player'?error('Organiser access required'):{data:g};
  if(path==='/rest/v1/rpc/iig_read_entry_group')return g?.state.players.length?{data:{...g,player_id:'qa-1',invite_token:undefined}}:error('Group membership required');
  if(path==='/rest/v1/rpc/iig_get_player_join_options')return {data:{group_pin:pin,group_name:g?.state.groupName,pin_join_enabled:false}};
  return error('UNEXPECTED WRITE OR ENDPOINT: '+path);
 }
 window.fetch=async(url,options={})=>{
  const parsed=new URL(String(url),location.href);if(parsed.hostname!=='nyavvwrsrxqfyhiygkgw.supabase.co')throw Error('External network blocked');
  const path=parsed.pathname+parsed.search,body=JSON.parse(options.body||'{}');calls.push({path,body:clone(body)});const r=rpc(path,body,!!options.headers?.Authorization);
  return new Response(JSON.stringify(r.data??null),{status:r.status||200,headers:{'Content-Type':'application/json'}});
 };
 window.supabase={createClient(){let callback=()=>{};return {auth:{onAuthStateChange(cb){callback=cb;return {data:{subscription:{unsubscribe(){}}}}},async getSession(){return {data:{session:clone(session)},error:null}},async getUser(){return {data:{user:session?user:null},error:session?null:Error('No session')}},async setSession(){return {data:{session:clone(session)},error:null}},async signOut(){session=null;callback('SIGNED_OUT',null);return {error:null}},stopAutoRefresh(){}},rpc:async()=>({data:null,error:{message:'Legacy requests blocked'}})}}};
 window.alert=m=>alerts.push(m);window.open=()=>null;
 window.IIGPreview={calls,alerts,get data(){return clone(groups)},setCount(n){groups['4827'].state.players=groups['4827'].state.players.slice(0,n);groups['4827'].revision++;}};
})();
