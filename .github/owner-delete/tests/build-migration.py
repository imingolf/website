from pathlib import Path
import json, hashlib

root = Path(__file__).resolve().parents[1]
guards = json.loads((Path(__file__).parent / 'guards.json').read_text())
target = next((root / 'supabase/migrations').glob('*_owner_permanent_group_delete.sql'))
relations = [
 ('public', 'iig_notification_settings', 'group_pin', 'pin'),
 ('public', 'iig_push_subscriptions', 'group_pin', 'pin'),
 ('public', 'iig_notification_events', 'group_pin', 'pin'),
 *[('iig_closed_entry', t, 'group_id', 'text') for t in ['rounds','credentials','permits','receipts','archives','member_credentials','operation_audit','identity_ids']],
 *[('iig_private', t, 'group_id', 'id') for t in ['group_owners','group_members','release_groups','player_links','relink_grants','release_audit','subscription_bindings']]
]
loose = [r for r in relations if r[0] != 'iig_private' or r[1] == 'release_audit']
sql = (Path(__file__).parent / 'migration-base.sql').read_text()
snapshot = []
locks = []
deletes = []
for schema, table, column, kind in relations:
    value = 'g.group_pin' if kind == 'pin' else 'g.id::text' if kind == 'text' else 'g.id'
    snapshot.append(f"'{schema}.{table}', (select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from {schema}.{table} x where x.{column}={value})")
    locks.append(f'PERFORM 1 FROM {schema}.{table} x WHERE x.{column}={value} FOR UPDATE;')
    if table != 'subscription_bindings': deletes.append(f'DELETE FROM {schema}.{table} x WHERE x.{column}={value};')
# Delete dependants before the owner row (group_members also has ON DELETE CASCADE).
deletes.sort(key=lambda s: 'iig_private.group_owners ' in s)
sql=sql.replace('-- SNAPSHOT_FIELDS', ',\n'.join(snapshot)).replace('-- LOCK_RELATED_ROWS', '\n'.join(locks)).replace('-- DELETE_RELATED_ROWS','\n'.join(deletes))
for schema, table, column, kind in loose:
    sql += f"\nCREATE TRIGGER iig_group_exists_before_write BEFORE INSERT OR UPDATE OF {column} ON {schema}.{table} FOR EACH ROW EXECUTE FUNCTION iig_private.group_exists_before_write('{column}', '{kind}');\n"
# Fail closed if the audited guards have changed since preparation. Only their DELETE branch changes.
for f in guards:
    if f['name'] not in ['guard_row','release_hold']: continue
    old = "IF TG_OP='DELETE' THEN RAISE EXCEPTION '" + ('PROTECTED_GROUP_DELETE_NOT_IMPLEMENTED' if f['name']=='guard_row' else 'Retire groups instead of deleting them') + "'; END IF;"
    if f['name']=='release_hold': old=old.replace("'; END", "';END")
    assert f['definition'].count(old)==1
    new="IF TG_OP='DELETE' THEN PERFORM iig_private.authorise_group_delete(OLD.id, OLD.group_pin); RETURN OLD; END IF;"
    digest=hashlib.md5(f['definition'].encode()).hexdigest()
    sql+=f"\nDO $patch$ DECLARE source text; BEGIN\n SELECT pg_get_functiondef('{f['schema']}.{f['name']}()'::regprocedure) INTO source;\n IF md5(source)<>'{digest}' THEN RAISE EXCEPTION 'Deletion guard changed; review before installing'; END IF;\n EXECUTE replace(source, $old${old}$old$, $new${new}$new$);\nEND $patch$;\n"
sql+='\nCOMMIT;\n'
target.write_text(sql)
print(target)
