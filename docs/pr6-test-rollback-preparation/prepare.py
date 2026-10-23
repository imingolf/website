#!/usr/bin/env python3
"""Offline preparation only. Never connects to PostgreSQL."""
import argparse
import json
from pathlib import Path

PROJECT = 'nyavvwrsrxqfyhiygkgw'
REQUIRED = [
 'public.iig_join_owned_group(text,uuid,text,numeric)',
 'public.iig_set_my_attendance(text,boolean,bigint)',
 'public.iig_submit_my_score(text,integer,text,bigint)',
 'public.iig_get_player_group(text)', 'public.iig_get_owned_group()',
 'iig_private.verified_organiser()',
]
OPTIONAL = ['iig_private.player_result(jsonb)', 'iig_private.golf_view(jsonb,integer)']
NEW = [
 'public.iig_player_action(text,text,jsonb,bigint)',
 'iig_private.protected_group_limits()', 'iig_private.recent_signin()',
 'public.iig_request_owner_transfer(text)', 'public.iig_accept_owner_transfer(uuid)',
 'public.iig_prepare_account_deletion()', 'iig_private.sync_owner_email()',
 'public.iig_my_group_identity()', 'public.iig_is_protected_group(text)',
 'public.iig_apply_verified_subscription(text,uuid,text,timestamp with time zone)',
]
TABLES = ['iig_private.subscription_bindings', 'iig_private.owner_transfers',
          'iig_private.account_deletions']
GUARDED = ['public.tens_in_groups', 'iig_private.group_owners',
           'iig_private.group_members', 'iig_private.platform_owners',
           'iig_private.setup_testers', 'iig_private.registration_settings',
           'auth.users', 'auth.identities']
TRIGGERS = [('auth.users','iig_sync_owner_email'),
            ('public.tens_in_groups','iig_protected_group_limits')]

def lit(s):
    return "'" + s.replace("'", "''") + "'"

def ident(s):
    return '"' + s.replace('"', '""') + '"'

def fingerprint(table):
    return f"(select jsonb_build_object('rows',count(*),'md5',md5(coalesce(string_agg(h,'' order by h),''))) from (select md5(to_jsonb(r)::text) h from {table} r) hashes)"

def capture_sql():
    sigs = ','.join(lit(s) for s in REQUIRED+OPTIONAL+NEW)
    fps = ',\n'.join(lit(t)+', '+fingerprint(t) for t in GUARDED)
    cols = "'schema',n.nspname,'name',p.proname,'signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl_raw',p.proacl::text,'security_definer',p.prosecdef,'settings',p.proconfig,'owner_membership',pg_has_role(current_user,p.proowner,'MEMBER'),'acl',coalesce((select jsonb_agg(jsonb_build_object('grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'grantor',pg_get_userbyid(a.grantor),'grantable',a.is_grantable,'privilege',a.privilege_type)) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a),'[]'::jsonb)"
    return f"""\\set ON_ERROR_STOP on
-- Invoke psql -X -qAt; output is one sensitive JSON capture. No application RPCs.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL timezone = 'UTC';
SET LOCAL datestyle = 'ISO, YMD';
SET LOCAL extra_float_digits = 3;
SET LOCAL row_security = off;
SELECT jsonb_build_object(
 'format',1,'commit','eadb495','project_attestation',{lit(PROJECT)},
 'captured_at',clock_timestamp(),'database',current_database(),'role',current_user,
 'server_address',inet_server_addr(),'server_version',version(),
 'project_setting',current_setting('supabase.project_ref',true),
 'installation_privileges',jsonb_build_object('database_create',has_database_privilege(current_database(),'CREATE'),'public_create',has_schema_privilege('public','CREATE'),'private_create',has_schema_privilege('iig_private','CREATE'),'auth_trigger',has_table_privilege('auth.users','TRIGGER')),
 'functions',(select jsonb_agg(jsonb_build_object('requested',s.sig,'exists',p.oid is not null,'meta',case when p.oid is not null then jsonb_build_object({cols}) end) order by s.sig)
 from unnest(array[{sigs}]::text[]) s(sig)
 left join pg_proc p on p.oid=to_regprocedure(s.sig) left join pg_namespace n on n.oid=p.pronamespace),
 'new_tables',(select jsonb_object_agg(t,to_regclass(t) is not null) from unnest(array[{','.join(lit(t) for t in TABLES)}]) t),
 'new_triggers',(select coalesce(jsonb_agg(jsonb_build_object('table',t.tgrelid::regclass::text,'name',t.tgname)),'[]') from pg_trigger t where (t.tgrelid='auth.users'::regclass and t.tgname='iig_sync_owner_email') or (t.tgrelid='public.tens_in_groups'::regclass and t.tgname='iig_protected_group_limits')),
 'fingerprints',jsonb_build_object({fps}),
 'inventory',jsonb_build_object(
 'triggers',(select coalesce(jsonb_agg(jsonb_build_object('table',tgrelid::regclass::text,'name',tgname,'enabled',tgenabled,'definition',pg_get_triggerdef(oid))),'[]') from pg_trigger where not tgisinternal),
 'event_triggers',(select coalesce(jsonb_agg(to_jsonb(e)),'[]') from pg_event_trigger e),
 'policies',(select coalesce(jsonb_agg(to_jsonb(p)),'[]') from pg_policies p),
 'default_acl',(select coalesce(jsonb_agg(to_jsonb(d)),'[]') from pg_default_acl d),
 'roles',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from pg_roles r),
 'role_memberships',(select coalesce(jsonb_agg(to_jsonb(m)),'[]') from pg_auth_members m),
 'extensions',(select coalesce(jsonb_agg(to_jsonb(e)),'[]') from pg_extension e),
 'schemas',(select coalesce(jsonb_agg(jsonb_build_object('name',nspname,'owner',pg_get_userbyid(nspowner),'acl',nspacl::text)),'[]') from pg_namespace where nspname in ('public','iig_private','auth')),
 'tables',(select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity)),'[]') from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and n.nspname in ('public','iig_private','auth')),
 'sessions',(select coalesce(jsonb_agg(jsonb_build_object('pid',pid,'user',usename,'application',application_name,'client',client_addr,'state',state,'transaction_start',xact_start)),'[]') from pg_stat_activity where datname=current_database())
 ));
COMMIT;
"""

def rollback(c):
    if c.get('format') != 1 or c.get('commit') != 'eadb495' or c.get('project_attestation') != PROJECT:
        raise ValueError('Wrong capture format, commit or project attestation')
    fs = {f['requested']: f for f in c['functions']}
    if set(fs) != set(REQUIRED+OPTIONAL+NEW):
        raise ValueError('Incomplete function inventory')
    for s in REQUIRED:
        if not fs[s]['exists']:
            raise ValueError('Missing prerequisite: '+s)
    if any(fs[s]['exists'] for s in NEW) or any(c['new_tables'].values()) or c['new_triggers']:
        raise ValueError('New-object collision: needs individual review')
    for f in fs.values():
        if f['exists'] and any(a['grantor'] != f['meta']['owner'] for a in f['meta']['acl']):
            raise ValueError('Non-owner ACL grantor: grant-chain restoration needs individual review')
    if c.get('project_setting') not in (None,'',PROJECT):
        raise ValueError('Project setting contradicts TEST identity')
    lines = ["\\set ON_ERROR_STOP on", "-- GENERATED FOR TEST ONLY. Review before use. No CASCADE or golf-row DML.",
      "-- Requires -v confirmed_project=nyavvwrsrxqfyhiygkgw; this is human attestation, not target discovery.",
      'BEGIN;', "SET LOCAL lock_timeout = '5s';", "SET LOCAL statement_timeout = '60s';",
      'SET LOCAL search_path = pg_catalog;',
      "SET LOCAL timezone = 'UTC';", "SET LOCAL datestyle = 'ISO, YMD';", 'SET LOCAL extra_float_digits = 3;',
      'SET LOCAL row_security = off;',
      "SELECT set_config('iig.rollback_project', :'confirmed_project', true);",
      "DO $guard$ BEGIN IF current_setting('iig.rollback_project') <> '"+PROJECT+"' THEN RAISE EXCEPTION 'Wrong project attestation'; END IF; IF coalesce(current_setting('supabase.project_ref',true),'') NOT IN ('','"+PROJECT+"') THEN RAISE EXCEPTION 'Wrong project setting'; END IF; END $guard$;",
      'LOCK TABLE '+','.join(GUARDED)+' IN ACCESS EXCLUSIVE MODE;']
    # A safe schema-only reversal requires all existing data and protected identity rows unchanged.
    for t in GUARDED:
        expected = lit(json.dumps(c['fingerprints'][t],sort_keys=True))+'::jsonb'
        lines.append(f"DO $guard$ BEGIN IF {fingerprint(t)} IS DISTINCT FROM {expected} THEN RAISE EXCEPTION 'Data changed: {t}; stop and reconcile'; END IF; END $guard$;")
    for t in TABLES:
        lines.append(f"DO $guard$ DECLARE used boolean; BEGIN IF to_regclass({lit(t)}) IS NOT NULL THEN EXECUTE 'LOCK TABLE {t} IN ACCESS EXCLUSIVE MODE'; EXECUTE 'SELECT EXISTS(SELECT 1 FROM {t})' INTO used; IF used THEN RAISE EXCEPTION 'New table is not empty: {t}; stop and reconcile'; END IF; END IF; END $guard$;")
    for t,n in TRIGGERS:
        lines.append(f'DROP TRIGGER IF EXISTS {n} ON {t} RESTRICT;')
    for s in REQUIRED+OPTIONAL:
        if not fs[s]['exists']:
            continue
        m = fs[s]['meta']; sig=m['signature']; owner=ident(m['owner'])
        lines += [m['definition'].rstrip(';')+';', f'ALTER FUNCTION {sig} OWNER TO {owner};',
          f'SET LOCAL ROLE {owner};',
          f"DO $acl$ DECLARE r record; BEGIN FOR r IN SELECT DISTINCT a.grantee FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid={lit(sig)}::regprocedure LOOP EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION {sig} FROM %s',CASE WHEN r.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(r.grantee)) END); END LOOP; END $acl$;"]
        for a in m['acl']:
            if a['privilege'] != 'EXECUTE':
                raise ValueError('Unexpected function privilege')
            grantee = 'PUBLIC' if a['grantee']=='PUBLIC' else ident(a['grantee'])
            lines.append(f'GRANT EXECUTE ON FUNCTION {sig} TO {grantee}'+(' WITH GRANT OPTION' if a['grantable'] else '')+';')
        lines += ['RESET ROLE;']
    # Public callers first, then private helpers; no forced dependency removal.
    for s in [s for s in NEW if s.startswith('public.')]+[s for s in NEW if not s.startswith('public.')]+OPTIONAL:
        if not fs[s]['exists']:
            lines.append(f'DROP FUNCTION IF EXISTS {s} RESTRICT;')
    for t in TABLES:
        lines.append(f'DROP TABLE IF EXISTS {t} RESTRICT;')
    lines += ['-- Verify data again before committing.']
    for t in GUARDED:
        expected = lit(json.dumps(c['fingerprints'][t],sort_keys=True))+'::jsonb'
        lines.append(f"DO $guard$ BEGIN IF {fingerprint(t)} IS DISTINCT FROM {expected} THEN RAISE EXCEPTION 'Unexpected rollback data change: {t}'; END IF; END $guard$;")
    lines += ['COMMIT;']
    return '\n'.join(lines)+'\n'

if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--write-capture',type=Path)
    p.add_argument('--capture',type=Path)
    p.add_argument('--rollback',type=Path)
    a=p.parse_args()
    if a.write_capture and not a.capture and not a.rollback:
        a.write_capture.write_text(capture_sql())
    elif a.capture and a.rollback and not a.write_capture:
        a.rollback.write_text(rollback(json.loads(a.capture.read_text())))
    else:
        p.error('Use --write-capture PATH or --capture JSON --rollback SQL')
