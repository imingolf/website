/* TEST-only transport policy. No mocks, credential defaults, SDK or production fallback. */
(() => {
 'use strict';
 const PROJECT='nyavvwrsrxqfyhiygkgw',BASE='https://'+PROJECT+'.supabase.co';
 const KEY_HASH='02ebf3de24b1d60df3c781e7cc0f0a1c0845b72a82c8132b80ec9185e709cac2';
 const DENIED_HOST_HASHES=['0882884bf6e320614e3b5e24a52cf5e180200319a162546dd6c7fecfa59cb908','2485d0e920fea524b70774c45317412035e47a2f1eae2c7a6d7d86d42b55432f'];
 const nativeFetch=window.fetch.bind(window),nativeOpen=window.open.bind(window);
 let ready=false,config=null,started=false,hardeningComplete=false;
 document.documentElement.classList.add('iig-beta-pending');
 const rpcNames=['get_group_access_status','iig_create_owned_group','iig_get_owned_group','iig_save_owned_group',
  'iig_join_owned_group','iig_get_player_group','iig_list_registered_groups','iig_my_group_identity',
  'iig_set_my_attendance','iig_submit_my_score','iig_player_action','iig_request_owner_transfer','iig_accept_owner_transfer'];
 const endpoints=new Map([['/auth/v1/otp','POST'],['/auth/v1/verify','POST'],['/auth/v1/logout','POST'],['/auth/v1/user','PUT'],
  ...rpcNames.map(name=>['/rest/v1/rpc/'+name,'POST'])]);
 const denied=()=>new Error('TEST beta blocked an unapproved request. No connection was made.');
 function notice(text){const el=document.getElementById('iig-beta-status');if(el)el.textContent=text;}
 function fail(){
  ready=false;document.documentElement.classList.remove('iig-beta-pending');document.documentElement.classList.add('iig-beta-blocked');
  const policy=document.createElement('meta');policy.httpEquiv='Content-Security-Policy';policy.content="connect-src 'none'; worker-src 'none'; form-action 'none'";document.head.append(policy);
  let box=document.getElementById('iig-beta-status');
  if(!box){box=document.createElement('section');box.id='iig-beta-status';box.setAttribute('role','alert');document.body.append(box);}
  box.textContent='TEST beta unavailable. Its TEST configuration, origin or security checks could not be verified. Sign-in is disabled; no database connection was made.';
 }
 async function hash(text){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
 async function checkedConfig(){
  if(!hardeningComplete)throw denied();
  const input=window.IIG_TEST_BETA_CONFIG;
  if(!input||Object.keys(input).sort().join(',')!=='betaOrigin,projectRef,publishableKey,supabaseUrl')throw denied();
  const c=JSON.parse(JSON.stringify(input));
  if(Object.values(c).some(v=>typeof v!=='string')||c.projectRef!==PROJECT||c.supabaseUrl!==BASE)throw denied();
  const origin=new URL(c.betaOrigin);
  if(origin.origin!==c.betaOrigin||origin.protocol!=='https:'||origin.origin!==location.origin||['localhost','supabase.co','supabase.com'].includes(origin.hostname)||/^[0-9]+(?:\.[0-9]+){3}$/.test(origin.hostname)||!origin.hostname.includes('.')||origin.hostname.endsWith('.supabase.co')||origin.hostname.endsWith('.supabase.com'))throw denied();
  const host=origin.hostname;
  if(host.length>253||host.split('.').some(label=>!(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/).test(label)))throw denied();
  const candidates=[host,host.split('.').slice(-3).join('.'),host.split('--').pop()];
  for(const value of candidates)if(DENIED_HOST_HASHES.includes(await hash(value)))throw denied();
  if(await hash(c.publishableKey)!==KEY_HASH)throw denied();
  if(navigator.serviceWorker?.controller)throw denied();
  return Object.freeze(c);
 }
 function jwtIsTest(token){
  try{
   const parts=token.split('.');if(parts.length!==3)return false;
   const raw=parts[1].replace(/-/g,'+').replace(/_/g,'/');const payload=JSON.parse(atob(raw.padEnd(Math.ceil(raw.length/4)*4,'=')));
   // This prevents credential confusion; Supabase still verifies signature, expiry and RLS.
   return payload.iss===BASE+'/auth/v1'&&payload.role==='authenticated';
  }catch(_){return false;}
 }
 async function transport(input,options={}){
  if(!ready||!config)throw denied();
  const url=new URL(typeof input==='string'?input:input.url,location.origin);
  const method=(options.method||input.method||'GET').toUpperCase();
  if(url.origin!==BASE||url.username||url.password||url.hash||endpoints.get(url.pathname)!==method)throw denied();
  if(url.search){
   if(url.pathname!=='/auth/v1/user'||[...url.searchParams.keys()].join(',')!=='redirect_to'||url.searchParams.get('redirect_to')!==config.betaOrigin+'/app/')throw denied();
  }
  const headers=new Headers(options.headers||input.headers);
  if(headers.get('apikey')!==config.publishableKey)throw denied();
  const bearer=headers.get('Authorization');
  const publicAuth=['/auth/v1/otp','/auth/v1/verify'].includes(url.pathname);
  if(bearer&&!jwtIsTest(bearer.replace(/^Bearer /,'')))throw denied();
  if(!publicAuth&&(!bearer?.startsWith('Bearer ')||!jwtIsTest(bearer.slice(7))))throw denied();
  return nativeFetch(url.href,{...options,method,headers,credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',mode:'cors'});
 }
 function approvedNavigation(value){
  if(!ready)return null;
  try{
   const url=new URL(value,location.origin);
   if(url.username||url.password)return null;
   if(url.origin===config.betaOrigin&&url.pathname.startsWith('/app/')&&!url.username&&!url.password)return url;
   if(url.origin==='https://wa.me'&&url.pathname==='/'&&[...url.searchParams.keys()].join(',')==='text'&&!url.hash)return url;
  }catch(_){}
  return null;
 }
 function open(value){
  const url=approvedNavigation(value);
  if(url)return nativeOpen(url.href,'_blank','noopener,noreferrer');
  notice('This link or payment action is not enabled in the isolated TEST beta.');
  return {closed:false,close(){}}; // No legacy blocked-popup fallback to location.assign.
 }
 function routePin(value){
  if(!ready){notice('TEST sign-in is unavailable until configuration is verified.');return false;}
  const pin=String(value||'').trim();
  if(!/^\d{4}$/.test(pin)){const el=document.getElementById('connectMsg');if(el)el.textContent='Enter a four-digit TEST group PIN.';return false;}
  location.assign('/app/#pin='+encodeURIComponent(pin));location.reload();return false;
 }
 function loadScript(path){return new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=path;script.onload=resolve;script.onerror=reject;document.body.append(script);});}
 async function start(modules){
  if(started)return;started=true;
  try{
   config=await checkedConfig();
   const owner=location.pathname==='/app/owner-dashboard.html';
   const expected=owner?['account-controls.js','self-service.js']:['secure-organiser.js','secure-player.js','account-controls.js','self-service.js'];
   if(!['/app/','/app/index.html','/app/owner-dashboard.html'].includes(location.pathname)||JSON.stringify(modules)!==JSON.stringify(expected))throw denied();
   if(!owner){
    const search=new URLSearchParams(location.search);
    if(search.has('adminsetup'))throw denied();
    if(search.has('pin')){
     const pin=search.get('pin');if(!/^\d{4}$/.test(pin))throw denied();
     history.replaceState(null,'','/app/#pin='+encodeURIComponent(pin));
    }
   }
   ready=true;
   if(!owner)await loadScript('/beta/legacy-gate.js');
   for(const name of expected)await loadScript('/app/'+name);
   const banner=document.createElement('aside');banner.id='iig-beta-status';banner.setAttribute('role','status');banner.textContent='ISOLATED TEST BETA — TEST accounts and data only. No production access.';document.body.append(banner);
   const resize=()=>document.documentElement.style.setProperty('--iig-beta-top',banner.getBoundingClientRect().height+'px');resize();window.addEventListener('resize',resize);
   document.documentElement.classList.remove('iig-beta-pending');
  }catch(_){fail();}
 }
 const api=Object.freeze({get ready(){return ready;},get config(){return ready?config:null;},fetch:transport,open,routePin,start,purchase:null});
 Object.defineProperty(window,'IIG_TEST_BETA',{value:api,writable:false,configurable:false});
 Object.defineProperty(window,'fetch',{value:transport,writable:false,configurable:false});
 Object.defineProperty(window,'open',{value:open,writable:false,configurable:false});
 Object.defineProperty(window,'TENS_IN_CONFIG',{value:Object.freeze({supabaseUrl:'',supabaseKey:''}),writable:false,configurable:false});
 Object.defineProperty(window,'supabase',{value:Object.freeze({createClient(){throw denied();}}),writable:false,configurable:false});
 for(const name of ['XMLHttpRequest','WebSocket','EventSource','Worker','SharedWorker'])Object.defineProperty(window,name,{value:function(){throw denied();},writable:false,configurable:false});
 try{Object.defineProperty(navigator,'sendBeacon',{value:()=>false,writable:false,configurable:false});}catch(_){}
 function guardLinks(){
  for(const link of document.querySelectorAll('a[href]')){
   const href=link.getAttribute('href');
   if(href!=='#beta-blocked'&&!approvedNavigation(href)){link.setAttribute('href','#beta-blocked');if(link.hasAttribute('target'))link.removeAttribute('target');}
  }
 }
 new MutationObserver(guardLinks).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['href','target']});
 window.addEventListener('click',event=>{
  const link=event.target.closest?.('a');if(!link)return;
  const url=approvedNavigation(link.getAttribute('href'));
  if(!url||link.getAttribute('href')==='#beta-blocked'){event.preventDefault();event.stopImmediatePropagation();notice('This destination is blocked in the isolated TEST beta.');}
 },true);
 hardeningComplete=true;
})();
