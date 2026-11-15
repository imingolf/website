/* Supabase owns refresh-token rotation and persistent storage. No custom token cache. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.IIGAccountSession=api;})(typeof globalThis!=='undefined'?globalThis:this,()=>{
 'use strict';
 function create({createClient,access,storage,onChange=()=>{}}){
  if(typeof createClient!=='function'||!storage||!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(access?.url||''))throw Error('Secure account storage is unavailable.');
  const storageKey='iig-account-v1-'+new URL(access.url).hostname;
  const client=createClient(access.url,access.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,
   flowType:'pkce',storage,storageKey}});
  let generation=0,accepting=false,knownUserId=null;
  const subscription=client.auth.onAuthStateChange((event,next)=>{
   const nextUserId=next?.user?.id||null,sameAccount=!!nextUserId&&nextUserId===knownUserId;
   knownUserId=nextUserId;
   if((event==='INITIAL_SESSION'&&sameAccount)||(accepting&&event==='SIGNED_IN'))return;
   // Refreshing tokens for the same identity must not invalidate an in-flight
   // getUser check. Sign-out and a different identity still invalidate it.
   if(!sameAccount||event==='SIGNED_OUT')generation++;
   if(event==='INITIAL_SESSION')return;
   // Supabase callbacks must return before another Auth call runs.
   Promise.resolve().then(()=>onChange(event,next));
  }).data.subscription;
  async function verified(data){
   if(!data?.access_token||!data.refresh_token||!data.user?.id||!Number.isFinite(data.expires_at)||data.expires_at*1000<=Date.now())throw Error('Sign in again to continue.');
   const {data:identity,error}=await client.auth.getUser(data.access_token);
   if(error||identity?.user?.id!==data.user.id||!identity.user.email||!identity.user.email_confirmed_at||identity.user.is_anonymous)throw Error('Verify your email before continuing.');
   return {...data,user:identity.user};
  }
  return {
   async restore(){const {data,error}=await client.auth.getSession();if(error)throw error;const epoch=generation;
    if(!data?.session)return null;
    if(knownUserId&&knownUserId!==data.session.user?.id)throw Error('Account changed. Sign in again.');
    knownUserId=data.session.user?.id||null;
    const value=await verified(data.session);if(epoch!==generation||knownUserId!==value.user.id)throw Error('Account changed. Sign in again.');return value;},
   async accept(tokens){const epoch=++generation;accepting=true;
    try{const {data,error}=await client.auth.setSession({access_token:tokens.access_token,refresh_token:tokens.refresh_token});if(error)throw error;
     const value=await verified(data.session);if(epoch!==generation)throw Error('Account changed. Sign in again.');return value;
    }catch(error){await client.auth.signOut({scope:'local'});throw error;}finally{accepting=false;}},
   async signout(){generation++;const {error}=await client.auth.signOut({scope:'local'});if(error)throw Error('Sign-out could not be confirmed. Retry while connected.');},
   async forgetDeleted(){generation++;try{await client.auth.signOut({scope:'local'});}finally{storage.removeItem(storageKey);storage.removeItem(storageKey+'-code-verifier');}},
   close(){generation++;subscription.unsubscribe();client.auth.stopAutoRefresh();}
  };
 }
 return {create};
});
