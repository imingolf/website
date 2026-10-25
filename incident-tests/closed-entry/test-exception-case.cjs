// Local fictional PostgreSQL only. No saved LIVE body is executed.
const {PGlite}=require('@electric-sql/pglite');
const assert=require('node:assert/strict');
(async()=>{
 const db=new PGlite();
 try{
  await db.exec(`CREATE SCHEMA fixture_exception_case;
   CREATE TABLE fixture_exception_case.events(id integer PRIMARY KEY,kind text);
   CREATE TABLE fixture_exception_case.groups(id integer PRIMARY KEY,state jsonb);
   CREATE FUNCTION fixture_exception_case.caught() RETURNS integer LANGUAGE plpgsql AS $$
   DECLARE marker integer:=0; BEGIN
    BEGIN INSERT INTO fixture_exception_case.events VALUES(1,'protected');marker:=marker+1;
     INSERT INTO fixture_exception_case.events VALUES(1,'duplicate');
    EXCEPTION WHEN unique_violation THEN INSERT INTO fixture_exception_case.events VALUES(2,'handler'); END;
    RETURN marker;
   END $$;
   CREATE FUNCTION fixture_exception_case.propagated() RETURNS void LANGUAGE plpgsql AS $$
   BEGIN BEGIN INSERT INTO fixture_exception_case.events VALUES(3,'inner');
    RAISE EXCEPTION 'fictional failure';
   EXCEPTION WHEN OTHERS THEN INSERT INTO fixture_exception_case.events VALUES(4,'inner-handler');RAISE; END;
   EXCEPTION WHEN OTHERS THEN INSERT INTO fixture_exception_case.events VALUES(5,'outer-handler');END $$;
   CREATE FUNCTION fixture_exception_case.simple_case(x integer) RETURNS integer LANGUAGE plpgsql AS $$
   BEGIN CASE x WHEN 1,2 THEN RETURN 10; ELSE RETURN 20; END CASE; END $$;
   CREATE FUNCTION fixture_exception_case.searched_case(x integer) RETURNS integer LANGUAGE plpgsql AS $$
   BEGIN CASE WHEN x=1 THEN RETURN 10; END CASE;
   EXCEPTION WHEN case_not_found THEN RETURN 30; END $$;
   CREATE FUNCTION fixture_exception_case.after_update() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN CASE WHEN OLD.state->'roundOpen'='true'::jsonb AND NEW.state->'roundOpen'='false'::jsonb THEN
     BEGIN INSERT INTO fixture_exception_case.events VALUES(10,'history');
      INSERT INTO fixture_exception_case.events VALUES(10,'duplicate');
     EXCEPTION WHEN unique_violation THEN INSERT INTO fixture_exception_case.events VALUES(11,'caught-history-failure');END;
    ELSE RETURN NEW; END CASE;RETURN NEW; END $$;
   CREATE TRIGGER fixture_update AFTER UPDATE ON fixture_exception_case.groups FOR EACH ROW EXECUTE FUNCTION fixture_exception_case.after_update();
   INSERT INTO fixture_exception_case.groups VALUES(1,'{"roundOpen":true}');`);
  assert.equal((await db.query('SELECT fixture_exception_case.caught() AS n')).rows[0].n,1);
  await db.query('SELECT fixture_exception_case.propagated()');
  assert.deepEqual((await db.query('SELECT id FROM fixture_exception_case.events ORDER BY id')).rows.map(x=>x.id),[2,5]);
  assert.equal((await db.query('SELECT fixture_exception_case.simple_case(2) AS n')).rows[0].n,10);
  assert.equal((await db.query('SELECT fixture_exception_case.simple_case(NULL) AS n')).rows[0].n,20);
  assert.equal((await db.query('SELECT fixture_exception_case.searched_case(NULL) AS n')).rows[0].n,30);
  await db.exec(`UPDATE fixture_exception_case.groups SET state='{"roundOpen":false}' WHERE id=1;`);
  assert.deepEqual((await db.query('SELECT id FROM fixture_exception_case.events WHERE id>=10 ORDER BY id')).rows.map(x=>x.id),[11]);
  assert.equal((await db.query("SELECT state->>'roundOpen' AS value FROM fixture_exception_case.groups")).rows[0].value,'false');
  console.log('PASS: fictional exception/CASE execution: protected writes roll back, locals survive, handler writes persist or unwind to outer handler, CASE null/no-ELSE behaviour, and UPDATE success despite caught history-write failure. NOT actual LIVE trigger semantics.');
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
