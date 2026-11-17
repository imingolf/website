import {PGlite} from '../../sidegame-invites/node_modules/@electric-sql/pglite/dist/index.js';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();
try {
 await db.exec(readFileSync(new URL('baseline.sql',import.meta.url),'utf8'));
 await db.exec(`
 CREATE SCHEMA iig_private;
 CREATE TABLE public.tens_in_groups(id bigint,plan_type text);
 INSERT INTO public.tens_in_groups VALUES(1,'plus');
 CREATE TABLE iig_closed_entry.rounds(group_id text,closed boolean);
 CREATE TABLE public.fixture(state jsonb,revision bigint,actor text);
 CREATE FUNCTION iig_private.lock_release(text,bigint,text) RETURNS TABLE(group_id bigint,revision bigint,player_id text,state jsonb) LANGUAGE sql AS 'SELECT 1::bigint,revision,actor,state FROM public.fixture';
 CREATE FUNCTION iig_closed_entry.initialise(text,jsonb) RETURNS void LANGUAGE sql AS 'SELECT';
 CREATE FUNCTION iig_closed_entry.write_authenticated(gid bigint,rev bigint,kind text,s jsonb,pid text) RETURNS bigint LANGUAGE plpgsql AS $$ BEGIN
 PERFORM iig_closed_entry.validate_sidegame((SELECT state FROM public.fixture),s,pid);
 UPDATE public.fixture SET state=s,revision=rev+1; RETURN rev+1; END $$;
 `);
 const day=(await db.query("select to_char(now() at time zone 'Europe/London','YYYY-MM-DD') value")).rows[0].value;
 const bet={id:'invite',date:day,player1Id:'sender',player1Name:'Sender',player2Id:'recipient',player2Name:'Recipient',status:'pending',setup:'challenge',stake:5,format:'stableford'};
 const prior={...bet,id:'prior',date:'2020-01-01',status:'resolved',result:'win',winnerId:'recipient',loserId:'sender',amount:4};
 const state={players:[{id:'sender',name:'Sender'},{id:'recipient',name:'Recipient'}],roundId:'unchanged',history:[],sideGame:{bets:[prior,bet],scores:[],settlements:[]}};
 const reset=async(actor='recipient')=>{await db.exec('delete from public.fixture');await db.query('insert into public.fixture values($1,1,$2)',[state,actor]);};
 const act=name=>db.query("select public.iig_player_action('7771',$1,'{\"id\":\"invite\"}',1) revision",[name]);
 await reset();await assert.rejects(()=>act('side_decline'),/INVALID_CHALLENGE_RESPONSE/);
 console.log('PASS reproduced original Decline failure through actual action and validator');
 await db.exec(readFileSync(new URL('../supabase/migrations/20261117152000_side_game_response_timestamp.sql',import.meta.url),'utf8'));
 for(const [name,status,stamp,absent] of [['side_accept','active','acceptedAt','declinedAt'],['side_decline','declined','declinedAt','acceptedAt']]){
  await reset();assert.equal((await act(name)).rows[0].revision,2);
  const saved=(await db.query('select state from public.fixture')).rows[0].state;
  assert.equal(saved.sideGame.bets[1].status,status);assert.equal(typeof saved.sideGame.bets[1][stamp],'string');assert.equal(saved.sideGame.bets[1][absent],undefined);
  const expected=structuredClone(state);expected.sideGame.bets[1]={...bet,status,[stamp]:saved.sideGame.bets[1][stamp]};assert.deepEqual(saved,expected);
  console.log('PASS '+name+' preserves competition, previous £4 result and all unrelated fields');
 }
 await reset('sender');await assert.rejects(()=>act('side_accept'),/No pending challenge/);await assert.rejects(()=>act('side_decline'),/No pending challenge/);
 await reset();await assert.rejects(()=>db.query("select public.iig_player_action('7771','side_accept','{\"id\":\"invite\"}',0)"),/Group changed/);
 console.log('PASS recipient-only and revision protections retained');
} finally {await db.close();}
