// Matches the UPLOADED SYMBOLIC CONTROL-FLOW SHAPE, not the private raw SQL.
// Field/type/status choices below are fictional. No Supabase connections.
const {PGlite}=require('@electric-sql/pglite');
const {fixture,originalFinish}=require('./test-source-finish.cjs');
const assert=require('node:assert/strict');
(async()=>{
 const db=new PGlite();let checks=0;
 try{
  await db.exec(`CREATE SCHEMA observed_pattern_fixture;
   CREATE TABLE observed_pattern_fixture.groups(id text PRIMARY KEY,state jsonb NOT NULL);
   CREATE TABLE observed_pattern_fixture.settings(group_id text PRIMARY KEY,enabled boolean NOT NULL);
   CREATE TABLE observed_pattern_fixture.messages(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    group_id text NOT NULL,round_key text NOT NULL,kind text NOT NULL CHECK(kind IN ('opened','early','late','first')),
    status text NOT NULL DEFAULT 'pending',body text NOT NULL,due_at timestamptz NOT NULL,
    UNIQUE(group_id,round_key,kind));
   CREATE TABLE observed_pattern_fixture.faults(group_id text PRIMARY KEY,mode text NOT NULL);
   CREATE FUNCTION observed_pattern_fixture.message_fault() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN IF EXISTS(SELECT 1 FROM observed_pattern_fixture.faults WHERE group_id=NEW.group_id AND mode=lower(TG_OP))
    THEN RAISE EXCEPTION 'FICTIONAL_MESSAGE_WRITE_FAILURE';END IF;RETURN NEW;END $$;
   CREATE TRIGGER message_fault BEFORE INSERT OR UPDATE ON observed_pattern_fixture.messages
    FOR EACH ROW EXECUTE FUNCTION observed_pattern_fixture.message_fault();
   CREATE FUNCTION observed_pattern_fixture.after_update() RETURNS trigger LANGUAGE plpgsql AS $$
   DECLARE n jsonb:=NEW.state;o jsonb:=OLD.state;
    new_open boolean:=coalesce((n->>'roundOpen')::boolean,false);
    old_open boolean:=coalesce((o->>'roundOpen')::boolean,false);
    label text:=nullif(trim(n->>'course'),'');old_label text:=nullif(trim(o->>'course'),'');
    new_day date;old_day date;key text;history_length integer:=0;new_count integer;old_count integer;
   BEGIN
    IF NOT EXISTS(SELECT 1 FROM observed_pattern_fixture.settings WHERE group_id=NEW.id AND enabled) THEN RETURN NEW;END IF;
    IF NOT new_open THEN UPDATE observed_pattern_fixture.messages SET status='cancelled'
     WHERE group_id=NEW.id AND status='pending' AND kind IN ('early','late');RETURN NEW;END IF;
    BEGIN new_day:=nullif(n->>'date','')::date;EXCEPTION WHEN OTHERS THEN RETURN NEW;END;
    BEGIN old_day:=nullif(o->>'date','')::date;EXCEPTION WHEN OTHERS THEN old_day:=NULL;END;
    IF label IS NULL OR new_day IS NULL THEN RETURN NEW;END IF;
    IF jsonb_typeof(n->'history')='array' THEN history_length:=jsonb_array_length(n->'history');END IF;
    key:=concat(new_day::text,'|',lower(label),'|',history_length::text);
    IF NOT old_open OR old_day IS DISTINCT FROM new_day OR old_label IS DISTINCT FROM label THEN
     UPDATE observed_pattern_fixture.messages SET status='cancelled' WHERE group_id=NEW.id AND status='pending' AND round_key<>key;
     INSERT INTO observed_pattern_fixture.messages(group_id,round_key,kind,body,due_at)
      VALUES(NEW.id,key,'opened','fictional opening',now()) ON CONFLICT(group_id,round_key,kind) DO NOTHING;
     IF new_day::timestamptz-interval '2 days'>now() THEN
      INSERT INTO observed_pattern_fixture.messages(group_id,round_key,kind,body,due_at)
       VALUES(NEW.id,key,'early','fictional early reminder',new_day::timestamptz-interval '2 days') ON CONFLICT(group_id,round_key,kind) DO NOTHING;
     END IF;
     IF new_day::timestamptz-interval '1 day'>now() THEN
      INSERT INTO observed_pattern_fixture.messages(group_id,round_key,kind,body,due_at)
       VALUES(NEW.id,key,'late','fictional late reminder',new_day::timestamptz-interval '1 day') ON CONFLICT(group_id,round_key,kind) DO NOTHING;
     END IF;
    END IF;
    SELECT count(*) INTO new_count FROM jsonb_array_elements(coalesce(n->'players','[]')) p WHERE p->>'paid'='true' OR nullif(p->>'competition','') IS NOT NULL;
    SELECT count(*) INTO old_count FROM jsonb_array_elements(coalesce(o->'players','[]')) p WHERE p->>'paid'='true' OR nullif(p->>'competition','') IS NOT NULL;
    IF old_count=0 AND new_count>0 THEN
     INSERT INTO observed_pattern_fixture.messages(group_id,round_key,kind,body,due_at)
      VALUES(NEW.id,key,'first','fictional first participant',now()) ON CONFLICT(group_id,round_key,kind) DO NOTHING;
    END IF;
    RETURN NEW;
   END $$;
   CREATE TRIGGER observed_update AFTER UPDATE ON observed_pattern_fixture.groups FOR EACH ROW EXECUTE FUNCTION observed_pattern_fixture.after_update();`);
  function state(){return {...fixture({game:'money',format:'stableford'}),date:'2099-11-05',roundOpen:false,players:[]};}
  async function seed(g,s=state(),enabled=true){await db.query('INSERT INTO observed_pattern_fixture.settings VALUES($1,$2)',[g,enabled]);await db.query('INSERT INTO observed_pattern_fixture.groups VALUES($1,$2)',[g,s]);return s;}
  async function update(g,s){await db.query('UPDATE observed_pattern_fixture.groups SET state=$2 WHERE id=$1',[g,s]);}
  async function get(g){return (await db.query('SELECT state FROM observed_pattern_fixture.groups WHERE id=$1',[g])).rows[0].state;}
  async function messages(g){return (await db.query('SELECT * FROM observed_pattern_fixture.messages WHERE group_id=$1 ORDER BY id',[g])).rows;}
  const disabled={...await seed('disabled',state(),false),roundOpen:true};await update('disabled',disabled);
  assert.deepEqual(await messages('disabled'),[]);assert.deepEqual(await get('disabled'),disabled);checks++;
  const badNew={...await seed('bad-new'),roundOpen:true,date:'fictional-invalid'};await update('bad-new',badNew);
  assert.deepEqual(await get('bad-new'),badNew);assert.deepEqual(await messages('bad-new'),[]);checks++;
  const oldBad=await seed('bad-old',{...state(),roundOpen:true,date:'fictional-invalid'});
  await update('bad-old',{...oldBad,date:'2099-11-05'});assert.equal((await messages('bad-old')).length,3);checks++;
  const open={...await seed('open'),roundOpen:true};await update('open',open);assert.equal((await messages('open')).length,3);checks++;
  await update('open',open);assert.equal((await messages('open')).length,3);checks++;
  await update('open',{...open,players:[{id:'a',paid:true}]});assert.equal((await messages('open')).length,4);checks++;
  const scored={...open,players:[{id:'a',paid:true,stableford:32,scoreSubmitted:true}]};await update('open',scored);
  assert.equal((await messages('open')).length,4);checks++;
  await update('open',{...scored,roundOpen:false});assert.equal((await messages('open')).filter(x=>x.status==='cancelled').length,2);checks++;
  for(const mode of ['insert','update']){
   const g='unhandled-'+mode;const original={...await seed(g),roundOpen:true};await update(g,original);
   await db.query('INSERT INTO observed_pattern_fixture.faults VALUES($1,$2)',[g,mode]);
   const beforeMessages=await messages(g);
   await assert.rejects(()=>update(g,mode==='insert'?{...original,date:'2099-11-06'}:{...original,roundOpen:false}),/FICTIONAL_MESSAGE_WRITE_FAILURE/);
   assert.deepEqual(await get(g),original);assert.deepEqual(await messages(g),beforeMessages);checks++;
  }
  for(const [i,options] of [{game:'money',format:'stableford'},{game:'points',format:'net'},{game:'money',format:'stableford',trip:true,last:true}].entries()){
   const before=fixture(options),after=await originalFinish({...before,_entry_revision:0});delete after._entry_revision;
   await seed('source-'+i,before);await update('source-'+i,after);assert.deepEqual(await get('source-'+i),after);checks++;
  }
  console.log(`PASS: ${checks} uploaded-shape UPDATE tests: sibling conversion handlers, metadata-only writes/deduplication, propagated downstream failures, and unchanged actual-source Finish Round payloads. Private names/types/constants and LIVE equivalence remain unverified.`);
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
