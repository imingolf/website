// Local DDL rollback rehearsal ONLY. No online project, SQL editor or real backup.
const {PGlite}=require('@electric-sql/pglite');const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const db=new PGlite();try{
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
   CREATE TABLE public.tens_in_groups(id text PRIMARY KEY,state jsonb NOT NULL,updated_at timestamptz DEFAULT now());
   ALTER TABLE public.tens_in_groups ENABLE ROW LEVEL SECURITY;REVOKE ALL ON public.tens_in_groups FROM PUBLIC,anon,authenticated;
   INSERT INTO public.tens_in_groups VALUES('fictional', '{"players":[],"history":[{"id":"kept"}]}',now());
   CREATE FUNCTION public.get_group_state(p_pin text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT state FROM public.tens_in_groups WHERE id=p_pin $$;
   REVOKE ALL ON FUNCTION public.get_group_state(text) FROM PUBLIC;GRANT EXECUTE ON FUNCTION public.get_group_state(text) TO anon;`);
  async function before(){return (await db.query(`SELECT jsonb_build_object(
   'data',(SELECT jsonb_agg(to_jsonb(t)) FROM public.tens_in_groups t),
   'table',(SELECT jsonb_build_object('owner',relowner,'acl',relacl,'rls',relrowsecurity,'force',relforcerowsecurity) FROM pg_class WHERE oid='public.tens_in_groups'::regclass),
   'function',(SELECT jsonb_build_object('definition',pg_get_functiondef(oid),'owner',proowner,'acl',proacl,'config',proconfig) FROM pg_proc WHERE oid='public.get_group_state(text)'::regprocedure),
   'triggers',(SELECT coalesce(jsonb_agg(pg_get_triggerdef(oid)),'[]') FROM pg_trigger WHERE tgrelid='public.tens_in_groups'::regclass AND NOT tgisinternal)
  ) AS baseline`)).rows[0].baseline;}
  const baseline=await before();
  const sql=['core.sql','validators.sql','boundary.sql'].map(f=>fs.readFileSync(__dirname+'/../../supabase/closed-entry-candidate/'+f,'utf8')).join('\n');
  await db.exec('BEGIN');await db.exec(sql);await assert.rejects(()=>db.exec('SELECT 1/0'),/division by zero/);await db.exec('ROLLBACK');
  assert.deepEqual(await before(),baseline);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_namespace WHERE nspname='iig_closed_entry'")).rows[0].n,0);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_proc WHERE proname IN ('iig_entry_read','iig_entry_write','iig_entry_receipt','iig_entry_check_credential','iig_entry_check_member')")).rows[0].n,0);
  console.log('PASS: candidate installation error rolls back new schema/RPCs/trigger/grants while preserving original JSON/history, RLS, ownership and function ACL/config/definition. Local fictional DDL only.');
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
