from pathlib import Path
import json,hashlib
root=Path(__file__).parent
rows=json.loads((root/'baseline/functions.json').read_text())
f={x['signature'].split('(')[0]:x['definition'] for x in rows}
def replace(text,old,new):
 assert text.count(old)==1, old
 return text.replace(old,new)
create=f['iig_create_owned_group']
create=replace(create,'where owner_id=v_uid;','where owner_id=v_uid AND request_id=p_request_id;')
create=replace(create,'  for v_try in 1..100 loop',"  IF EXISTS(SELECT 1 FROM iig_private.group_owners WHERE owner_id=v_uid) THEN RAISE EXCEPTION 'This organiser already has a group'; END IF;\n  for v_try in 1..100 loop")
additional=create.replace('public.iig_create_owned_group(', 'iig_private.create_additional_owned_group(',1)
additional=replace(additional,"  IF EXISTS(SELECT 1 FROM iig_private.group_owners WHERE owner_id=v_uid) THEN RAISE EXCEPTION 'This organiser already has a group'; END IF;", "  IF NOT EXISTS(SELECT 1 FROM iig_private.group_owners WHERE owner_id=v_uid) THEN RAISE EXCEPTION 'Create your first group before adding another'; END IF;")
read=f['iig_read_entry_group']
owner=read.replace('public.iig_read_entry_group(p_pin text DEFAULT NULL::text)','public.iig_read_owned_entry_group(p_pin text)',1)
start=owner.index(' IF p_pin IS NULL THEN')
end=owner.index(' SELECT * INTO r FROM', start)
owner=owner[:start]+''' IF p_pin IS NULL OR p_pin !~ '^[0-9]{4}$' THEN RAISE EXCEPTION 'Choose a group' USING ERRCODE='22023'; END IF;
 pin:=p_pin;
 SELECT * INTO g FROM iig_private.lock_release(pin,NULL,'owner');
 result:=jsonb_build_object('group_pin',pin,'revision',g.revision,'state',g.state,'invite_token',
   (SELECT invite_token FROM iig_private.group_owners WHERE group_id=g.group_id));
'''+owner[end:]
read=replace(read,' IF p_pin IS NULL THEN'," IF p_pin IS NULL THEN\n  IF (SELECT count(*) FROM iig_private.group_owners WHERE owner_id=uid)>1 THEN RAISE EXCEPTION 'Choose a group before opening organiser access' USING ERRCODE='22023'; END IF;") if read.count(' IF p_pin IS NULL THEN')==1 else read.replace(' IF p_pin IS NULL THEN'," IF p_pin IS NULL THEN\n  IF (SELECT count(*) FROM iig_private.group_owners WHERE owner_id=uid)>1 THEN RAISE EXCEPTION 'Choose a group before opening organiser access' USING ERRCODE='22023'; END IF;",1)
legacy=[]
for name,uid in [('iig_get_owned_group','v_uid'),('iig_my_group_identity','uid')]:
 text=f[name]
 text=replace(text,'begin\n',"begin\n IF (SELECT count(*) FROM iig_private.group_owners WHERE owner_id="+uid+")>1 THEN RAISE EXCEPTION 'Choose a group before opening organiser access' USING ERRCODE='22023'; END IF;\n")
 legacy.append(text)
playing=f['iig_create_owned_playing_group']
playing=replace(playing,'owned:=public.iig_read_entry_group();',"owned:=public.iig_read_owned_entry_group(created->>'group_pin');")
extra=playing.replace('public.iig_create_owned_playing_group(', 'public.iig_create_additional_playing_group(',1).replace(' LANGUAGE plpgsql',' LANGUAGE plpgsql\n SECURITY DEFINER',1).replace('public.iig_create_owned_group(p_name,p_organiser_name,p_request_id)','iig_private.create_additional_owned_group(p_name,p_organiser_name,p_request_id)',1)
listing='''CREATE FUNCTION public.iig_list_owned_groups()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE uid uuid=iig_private.verified_organiser(); result jsonb;
BEGIN
 SELECT coalesce(jsonb_agg(jsonb_build_object('group_pin',g.group_pin,'group_name',g.group_name,
   'retired',r.retired_at IS NOT NULL,'status',g.status) ORDER BY lower(g.group_name),g.id),'[]'::jsonb)
 INTO result FROM iig_private.group_owners o JOIN public.tens_in_groups g ON g.id=o.group_id
 LEFT JOIN iig_private.release_groups r ON r.group_id=g.id WHERE o.owner_id=uid;
 RETURN result;
END $$;
'''
changed={'iig_create_owned_group','iig_create_owned_playing_group','iig_read_entry_group','iig_get_owned_group','iig_my_group_identity'}
guards=[]
for row in rows:
 if row['signature'].split('(')[0] in changed:
  signature='public.'+row['signature'];digest=hashlib.md5(row['definition'].encode()).hexdigest()
  guards.append("IF md5(pg_get_functiondef('"+signature+"'::regprocedure)) IS DISTINCT FROM '"+digest+"' THEN RAISE EXCEPTION 'Audited function changed: "+signature+"'; END IF;")
preflight='DO $audit$ BEGIN\n'+'\n'.join(guards)+'\nEND $audit$;'
parts=['''-- PRIVATE PREVIEW CANDIDATE: do not install on LIVE without release approval.
-- Preserve the existing closed private schema and owner-checked RPC boundary.
-- New public definers expose only this verified account's own groups, with fixed
-- search paths and explicit EXECUTE grants; no table/schema access is broadened.
BEGIN;
SET LOCAL lock_timeout='2s';
''',preflight,'''
ALTER TABLE iig_private.group_owners DROP CONSTRAINT group_owners_owner_id_key;
ALTER TABLE iig_private.group_owners ADD CONSTRAINT group_owners_owner_request_key UNIQUE(owner_id,request_id);
''',create,additional,owner,read,*legacy,playing,extra,listing]
parts.append('''REVOKE ALL ON FUNCTION iig_private.create_additional_owned_group(text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.iig_list_owned_groups(),public.iig_read_owned_entry_group(text),public.iig_create_additional_playing_group(text,text,numeric,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.iig_list_owned_groups(),public.iig_read_owned_entry_group(text),public.iig_create_additional_playing_group(text,text,numeric,uuid) TO authenticated;
COMMIT;
''')
path=next((root/'supabase/migrations').glob('*.sql'))
path.write_text('\n;\n'.join(parts))
print(path)
