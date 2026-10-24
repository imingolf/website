-- DRAFT REVIEW ONLY: not an authorised migration or part of the rehearsed four.
-- No current runner executes this file. Requires a separately reviewed TEST-only
-- installer, original-baseline validation, new rehearsal and explicit approval.
-- The session marker is an interlock, NOT proof of project identity.
begin;
set local search_path=pg_catalog;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $guard$
begin
 if current_setting('iig.reviewed_acl_target',true) is distinct from 'nyavvwrsrxqfyhiygkgw'
 then raise exception 'STOP: draft has no approved installer/target verification'; end if;
 if current_user<>'postgres' or current_database()<>'postgres'
 or current_setting('server_version_num')::integer<>170011
 or coalesce(current_setting('supabase.project_ref',true),'') not in ('','nyavvwrsrxqfyhiygkgw')
 then raise exception 'STOP: TEST connection identity requires review'; end if;
 if (select ssl from pg_stat_ssl where pid=pg_backend_pid()) is distinct from true
 then raise exception 'STOP: database-side TLS is required'; end if;
 if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='iig_private' and c.relname in ('account_deletions','owner_transfers','subscription_bindings')
 and c.relkind='r' and c.relrowsecurity and pg_get_userbyid(c.relowner)='postgres')<>3
 then raise exception 'STOP: expected new RLS tables/owners are missing'; end if;
 if exists(select 1 from iig_private.account_deletions)
 or exists(select 1 from iig_private.owner_transfers)
 or exists(select 1 from iig_private.subscription_bindings)
 then raise exception 'STOP: new tables are in use; guarded schema rollback needs review'; end if;
end;
$guard$;

-- Only tables absent from the original capture and created by the four migrations.
-- No direct API consumer is needed: the function owner performs table operations.
revoke all on table iig_private.account_deletions,iig_private.owner_transfers,iig_private.subscription_bindings
from public,anon,authenticated,service_role;

-- Only newly created RPCs: explicitly deny inherited/default execution first.
revoke all on function public.iig_player_action(text,text,jsonb,bigint),
public.iig_request_owner_transfer(text),public.iig_accept_owner_transfer(uuid),
public.iig_prepare_account_deletion(),public.iig_my_group_identity(),
public.iig_is_protected_group(text),public.iig_apply_verified_subscription(text,uuid,text,timestamptz)
from public,anon,authenticated,service_role;
grant execute on function public.iig_player_action(text,text,jsonb,bigint),
public.iig_request_owner_transfer(text),public.iig_accept_owner_transfer(uuid),
public.iig_prepare_account_deletion(),public.iig_my_group_identity() to authenticated;
grant execute on function public.iig_is_protected_group(text),
public.iig_apply_verified_subscription(text,uuid,text,timestamptz) to service_role;
revoke all on function iig_private.protected_group_limits(),iig_private.recent_signin(),iig_private.sync_owner_email()
from public,anon,authenticated,service_role;
commit;
