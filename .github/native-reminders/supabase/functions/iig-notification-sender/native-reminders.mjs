// Firebase 17 targets a registered Installation ID (message.fid).
// No keys, account IDs or phone identifiers are returned or logged.
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FCM_ROOT = 'https://fcm.googleapis.com/v1/projects/i-m-in-golf/messages:send';
const encoder = new TextEncoder();
const b64 = bytes => btoa(String.fromCharCode(...bytes)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
const json64 = value => b64(encoder.encode(JSON.stringify(value)));
let cachedToken = null;

export function payloadFor(item, now = Date.now()) {
 if (!/^[A-Za-z0-9_-]{20,128}$/.test(item.fid || '') || !/^\d{4}$/.test(item.group_pin || '')) throw Error('Invalid recipient');
 const expiry = Math.min(Date.parse(item.expires_at), now + 12 * 3600 * 1000);
 if (!Number.isFinite(expiry) || expiry <= now) throw Error('Expired reminder');
 return { message: { fid: item.fid,
  notification: { title: item.title || "I'm In Golf", body: item.body || 'Your golf competition is open.' },
  data: { group_pin: item.group_pin, event_id: item.event_id },
  apns: { headers: { 'apns-push-type':'alert', 'apns-priority':'10',
   'apns-expiration':String(Math.floor(expiry / 1000)), 'apns-collapse-id':item.event_id },
   payload: { aps: { sound:'default' } } }
 } };
}

export function classifyResponse(status, body) {
 const invalid = body?.error?.details?.some(d => d['@type'] === 'type.googleapis.com/google.firebase.fcm.v1.FcmError' && d.errorCode === 'UNREGISTERED') === true;
 return { status: status >= 200 && status < 300 ? 'sent' : status === 429 || status >= 500 ? 'retry' : 'failed', invalid };
}

export async function accessToken(serviceAccount, fetcher = fetch, cryptoApi = crypto, now = Date.now()) {
 if (serviceAccount.project_id !== 'i-m-in-golf' || serviceAccount.type !== 'service_account' ||
     !serviceAccount.client_email?.endsWith('.iam.gserviceaccount.com') || !serviceAccount.private_key) throw Error('Invalid server configuration');
 if (cachedToken?.email === serviceAccount.client_email && cachedToken.expires > now + 60000) return cachedToken.token;
 const iat = Math.floor(now/1000);
 const unsigned = json64({ alg:'RS256', typ:'JWT' }) + '.' + json64({
  iss: serviceAccount.client_email, scope:'https://www.googleapis.com/auth/firebase.messaging', aud:TOKEN_URL, iat, exp:iat+3600
 });
 const pem = serviceAccount.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,'');
 const bytes = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
 const key = await cryptoApi.subtle.importKey('pkcs8', bytes, { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' }, false, ['sign']);
 const signature = await cryptoApi.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(unsigned));
 const response = await fetcher(TOKEN_URL, { method:'POST', signal:AbortSignal.timeout(8000),
  headers:{'content-type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:unsigned+'.'+b64(new Uint8Array(signature))}) });
 const data = await response.json();
 if (!response.ok || typeof data.access_token !== 'string') throw Error('Notification authorization unavailable');
 cachedToken = { email:serviceAccount.client_email, token:data.access_token, expires:now+Math.min(Number(data.expires_in)||3600,3600)*1000 };
 return cachedToken.token;
}

export async function sendNativeReminders({db, env, fetcher=fetch, tokenProvider=accessToken}) {
 const counts = { claimed:0, sent:0, retry:0, failed:0, skipped:0 };
 if (env('IIG_NATIVE_REMINDERS_ENABLED') !== 'true') return {status:'disabled',...counts};
 try {
  const raw = env('IIG_FIREBASE_SERVICE_ACCOUNT');
  if (!raw) return {status:'not_configured',...counts};
  const token = await tokenProvider(JSON.parse(raw),fetcher);
  const call = async (name,body) => { const result=await db.rpc(name,body);if(result.error)throw Error('Reminder database unavailable');return result.data; };
  const claimed = await call('iig_claim_native_reminders',{p_limit:20});
  if (!Array.isArray(claimed)) throw Error('Invalid reminder queue');
  counts.claimed=claimed.length;
  // Four workers bound duration and provider load; each delivery rechecks access.
  let index=0;
  await Promise.all(Array.from({length:Math.min(4,claimed.length)},async()=>{
   while(index<claimed.length) {
    const item=claimed[index++];
    const args={p_event:item.event_id,p_fid:item.fid,p_claim:item.claim_id};
    const ready=await call('iig_authorize_native_reminder',args);
    if (!ready) {counts.skipped++;continue;}
    let outcome;
    try {
     const payload=payloadFor(ready);
     const response=await fetcher(FCM_ROOT,{method:'POST',signal:AbortSignal.timeout(8000),
      headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(payload)});
     let data={};try{data=await response.json();}catch(_){}
     outcome=classifyResponse(response.status,data);
     if(response.status===401)cachedToken=null;
    } catch(_) { outcome={status:'retry',invalid:false}; }
    await call('iig_finish_native_reminder',{...args,p_status:outcome.status,p_invalid_device:outcome.invalid});
    counts[outcome.status]++;
   }
  }));
  return {status:'complete',...counts};
 } catch (_) { return {status:'unavailable',...counts}; }
}
