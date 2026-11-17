import {test} from 'node:test';import assert from 'node:assert/strict';import {sendSideInvites} from '../../native-reminders/supabase/functions/iig-notification-sender/side-invites.mjs';
const item={event_id:'event',fid:'synthetic-phone-1234567890',claim_id:'claim'};
function setup({enabled=true,authorized=true,failFetch=false}={}){
 const calls=[],requests=[];
 return {calls,requests,options:{env:n=>n==='IIG_SIDEGAME_INVITES_ENABLED'?(enabled?'true':'false'):n==='IIG_FIREBASE_SERVICE_ACCOUNT'?'{}':undefined,
 tokenProvider:async()=> 'test-token',db:{rpc:async(name,args)=>{calls.push({name,args});return {data:name==='iig_claim_side_invites'?[item]:name==='iig_authorize_side_invite'?(authorized?{...item,group_pin:'7771',expires_at:new Date(Date.now()+60000).toISOString()}:null):true};}},
 fetcher:async(url,args)=>{requests.push(JSON.parse(args.body));if(failFetch)throw Error('timeout');return {ok:true};}}};
}
test('disabled path does not query database or contact Firebase',async()=>{const s=setup({enabled:false});assert.equal((await sendSideInvites(s.options)).status,'disabled');assert.equal(s.calls.length,0);assert.equal(s.requests.length,0);});
test('recipient-only payload opens group; finish follows authorization',async()=>{const s=setup();assert.equal((await sendSideInvites(s.options)).sent,1);assert.equal(s.requests[0].message.fid,item.fid);assert.equal(s.requests[0].message.data.group_pin,'7771');assert.equal(s.calls.at(-1).args.p_status,'sent');});
test('revoked recipient sends nothing',async()=>{const s=setup({authorized:false});assert.equal((await sendSideInvites(s.options)).skipped,1);assert.equal(s.requests.length,0);});
test('ambiguous provider timeout records failure without retries',async()=>{const s=setup({failFetch:true});assert.equal((await sendSideInvites(s.options)).failed,1);assert.equal(s.requests.length,1);assert.equal(s.calls.at(-1).args.p_status,'failed');});
