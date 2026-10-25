#!/usr/bin/env python3
"""Fictional prototype only. Creates its OWN ephemeral, network-none Docker PG.
Never accepts a DB URL, container argument, SQL argument or existing database.
Uses cached pinned official image; never pulls. Does not use Supabase services.
"""
import json
import os
from pathlib import Path
import subprocess
import time
import uuid

HERE=Path(__file__).resolve().parent
IMAGE='postgres@sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929'
NAME='iig-entry-prototype-'+uuid.uuid4().hex
ENV={k:v for k,v in os.environ.items() if k not in {'DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'}}
DOCKER=['docker','--host=unix:///var/run/docker.sock']

def docker(*args,**kw):
    return subprocess.run(DOCKER+list(args),env=ENV,text=True,capture_output=True,timeout=30,**kw)

def ensure_isolated():
    result=docker('inspect',NAME)
    if result.returncode:raise RuntimeError('Own fixture container missing')
    data=json.loads(result.stdout)[0]
    if (data['HostConfig']['NetworkMode']!='none' or data['HostConfig'].get('PortBindings')
        or data['Config'].get('Labels',{}).get('iig.incident.fixture')!=NAME
        or any(m['Type']!='tmpfs' for m in data['Mounts'])):
        raise RuntimeError('Isolation check failed')

def command(role='postgres'):
    if role not in {'postgres','fixture_actual_admin','fixture_actual_d'}:raise RuntimeError('Unapproved fixture role')
    return DOCKER+['exec','-i',NAME,'psql','-X','-w','-qAt','-v','ON_ERROR_STOP=1',
                   '--host=/var/run/postgresql','--username='+role,'--dbname=postgres']

def sql(text,check=True):
    result=subprocess.run(command(),input=text,env=ENV,text=True,capture_output=True,timeout=20)
    if check and result.returncode:raise RuntimeError('Fictional SQL test failed: '+result.stderr)
    return result

def fixture():
    return dict(roundId='round-old',roundOpen=True,course='Fictional Course',date='2026-10-24',
       stake=10,gameType='money',pointsCompetition='stableford',history=[{'id':'fictional-history'}],trip={},
       players=[dict(id=x,name='Fictional '+x,handicap=10,paid=i<3,playingThisRound=False,
                     stableford=None,netScore=None,noReturn=False,scoreSubmitted=False) for i,x in enumerate('abcd')])

def quote_state(s):return "'"+json.dumps(s).replace("'","''")+"'::jsonb"

def seed(g):
    sql("INSERT INTO iig_entry_prototype.groups(id,phase,state) VALUES ('"+g+"','open',"+quote_state(fixture())+");"
        "INSERT INTO iig_entry_prototype.principals VALUES('postgres','"+g+"','a',true);")

def save(g,state,rev=0):
    return "SELECT iig_entry_prototype.save('"+g+"','round-old',"+str(rev)+","+quote_state(state)+");"

def blocked(pid):
    # Poll ONLY this own fixture backend; wait for a real row-lock wait, not a guessed sleep.
    deadline=time.monotonic()+10
    while time.monotonic()<deadline:
        value=sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='"+pid+"' AND wait_event_type='Lock';").stdout.strip()
        if value=='1':return
        time.sleep(.05)
    raise RuntimeError('Expected independent-session lock wait not observed')

def contend(winner_sql,loser_sql,expected_error='STALE_ROUND_OR_REVISION'):
    # Session A holds actual row lock across its save and commit; no network socket.
    a=subprocess.Popen(command(),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=ENV,text=True)
    b=None
    try:
        a.stdin.write('BEGIN;'+winner_sql+"SELECT 'WINNER_SAVED';\n");a.stdin.flush()
        deadline=time.monotonic()+10
        # psql emits the known marker after save while keeping transaction open.
        while True:
            line=a.stdout.readline()
            if 'WINNER_SAVED' in line:break
            if not line or time.monotonic()>deadline:raise RuntimeError('Winner fixture did not reach marker')
        app='fixture_wait_'+uuid.uuid4().hex
        b=subprocess.Popen(command(),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=ENV,text=True)
        b.stdin.write("SET application_name='"+app+"';"+loser_sql+'\n');b.stdin.flush()
        blocked(app)
        a.stdin.write('COMMIT;\n');a.stdin.close();a.stdin=None
        a_out,a_err=a.communicate(timeout=10)
        if a.returncode:raise RuntimeError('Winner fixture failed')
        b.stdin.close();b.stdin=None;b_out,b_err=b.communicate(timeout=10)
        if expected_error is None:
            if b.returncode or '"replayed": true' not in b_out:raise RuntimeError('Racing receipt replay failed')
        elif b.returncode==0 or expected_error not in b_err:raise RuntimeError('Racing writer was not rejected as expected')
    finally:
        for process in [a,b]:
            if process and process.poll() is None:process.kill();process.communicate(timeout=5)

def summary(g):
    return json.loads(sql("SELECT jsonb_build_object('revision',revision,'closed',closed,'phase',phase,'paid',"
        "(SELECT count(*) FROM jsonb_array_elements(state->'players') p WHERE p->'paid'='true'::jsonb))"
        " FROM iig_entry_prototype.groups WHERE id='"+g+"';").stdout.strip())

def race(g,entry_first):
    seed(g);entry=fixture();entry['players'][3]['paid']=True
    scored=fixture();scored['players'][0]['stableford']=32;scored['players'][0]['scoreSubmitted']=True
    winner=entry if entry_first else scored;loser=scored if entry_first else entry
    contend(save(g,winner),save(g,loser))
    if summary(g)!={'revision':1,'closed':not entry_first,'paid':4 if entry_first else 3,'phase':'open'}:
        raise RuntimeError('Unexpected race outcome')
    print('PASS — real lock contention:', 'entry-before-score' if entry_first else 'score-before-entry')

def finish(g,rev):
    return "SELECT iig_entry_prototype.finish('"+g+"','round-old',"+str(rev)+");"

def lifecycle(g,kind):
    seed(g);scored=fixture();scored['players'][0]['stableford']=32;scored['players'][0]['scoreSubmitted']=True
    sql(save(g,scored));entry=json.loads(json.dumps(scored));entry['players'][3]['paid']=True
    extra=json.loads(json.dumps(scored));extra['players'][1]['stableford']=35;extra['players'][1]['scoreSubmitted']=True
    if kind=='finish-entry':contend(finish(g,1),save(g,entry,1))
    elif kind=='finish-score':contend(finish(g,1),save(g,extra,1))
    elif kind=='score-finish':
        contend(save(g,extra,1),finish(g,1));sql(finish(g,2))
    elif kind=='double-finish':contend(finish(g,1),finish(g,1))
    elif kind=='start-return':
        sql(finish(g,1))
        start="SELECT iig_entry_prototype.start('"+g+"','round-old',2,'Next fictional course','2026-10-25',10,'net');"
        contend(start,save(g,entry,2))
    snap=sql("SELECT snapshot::text FROM iig_entry_prototype.archives WHERE group_id='"+g+"';").stdout.strip()
    archived=json.loads(snap)
    expected=extra if kind=='score-finish' else scored
    if archived!=expected:raise RuntimeError('History/payment archive mismatch after race')
    state=summary(g)
    if kind=='start-return':
        if state['phase']!='open' or state['paid']!=0 or state['closed']:raise RuntimeError('Invalid new round')
    elif state['phase']!='finished' or state['paid']!=3 or not state['closed']:raise RuntimeError('Invalid finished round')
    count=sql("SELECT count(*) FROM iig_entry_prototype.archives WHERE group_id='"+g+"';").stdout.strip()
    if count!='1':raise RuntimeError('Duplicate/missing archive')
    print('PASS — real lock contention:',kind,'with preserved archive')

def real_role_checks():
    sql("CREATE ROLE fixture_actual_admin LOGIN; CREATE ROLE fixture_actual_d LOGIN;"
        "GRANT USAGE ON SCHEMA iig_entry_prototype TO fixture_actual_admin,fixture_actual_d;"
        "GRANT EXECUTE ON FUNCTION iig_entry_prototype.save(text,text,bigint,jsonb),"
        "iig_entry_prototype.finish(text,text,bigint) TO fixture_actual_admin,fixture_actual_d;")
    g='fictional-actual-logins';seed(g);scored=fixture();scored['players'][0]['stableford']=32
    sql(save(g,scored));late=json.loads(json.dumps(scored));late['players'][3]['paid']=True
    sql("INSERT INTO iig_entry_prototype.principals VALUES"
        "('fixture_actual_admin','"+g+"','a',true),('fixture_actual_d','"+g+"','d',false);")
    for role,text,error in [
      ('fixture_actual_d','SET ROLE fixture_actual_admin;','permission denied'),
      ('fixture_actual_d','UPDATE iig_entry_prototype.principals SET organiser=true;','permission denied'),
      ('fixture_actual_d','UPDATE iig_entry_prototype.groups SET closed=false;','permission denied'),
      ('fixture_actual_d',finish(g,1),'ORGANISER_REQUIRED'),
      ('fixture_actual_admin',save(g,late,1),'ENTRIES_CLOSED')]:
        result=subprocess.run(command(role),input=text,env=ENV,text=True,capture_output=True,timeout=10)
        if result.returncode==0 or error not in result.stderr:raise RuntimeError('Actual fixture login boundary failed')
    result=subprocess.run(command('fixture_actual_admin'),input=finish(g,1),env=ENV,text=True,capture_output=True,timeout=10)
    if result.returncode or summary(g)['phase']!='finished':raise RuntimeError('Actual organiser finish failed')
    print('PASS — 6 actual local-login authority/permission checks (no impersonated session role)')

def legacy_races():
    cap='f'*64
    for kind in ['legacy-score-entry','legacy-finish-entry','legacy-start-return']:
        g='fictional-'+kind;pin='pin-'+kind;seed(g)
        sql("INSERT INTO iig_legacy_fixture.tens_in_groups(id,group_pin,state) SELECT id,'"+pin+"',state FROM iig_entry_prototype.groups WHERE id='"+g+"';"
            "INSERT INTO iig_legacy_fixture.organiser_capabilities VALUES('"+g+"',iig_legacy_fixture.token_hash('"+cap+"'),'2099-01-01',false,ARRAY['finish','start']);")
        scored=fixture();scored['players'][0]['stableford']=32;scored['players'][0]['scoreSubmitted']=True
        late=json.loads(json.dumps(scored));late['players'][3]['paid']=True
        def legacy_save(state,rev):
            payload=json.loads(json.dumps(state));payload['_entry_revision']=rev
            return "SELECT iig_legacy_fixture.save_group_state('"+pin+"',"+quote_state(payload)+");"
        finish_sql="SELECT iig_legacy_fixture.finish_round('"+pin+"','round-old',1,'"+cap+"');"
        if kind=='legacy-score-entry':
            entry=fixture();entry['players'][3]['paid']=True
            contend(legacy_save(scored,0),legacy_save(entry,0))
        elif kind=='legacy-finish-entry':
            sql(legacy_save(scored,0));contend(finish_sql,legacy_save(late,1))
        else:
            sql(legacy_save(scored,0));sql(finish_sql)
            start_sql="SELECT iig_legacy_fixture.start_round('"+pin+"','round-old',2,'"+cap+"','Next Fictional','2026-10-25',10,'net');"
            contend(start_sql,legacy_save(late,2))
        result=summary(g)
        if kind=='legacy-score-entry':
            if result['paid']!=3 or not result['closed']:raise RuntimeError('Legacy entry race failed')
        else:
            archive=json.loads(sql("SELECT snapshot::text FROM iig_entry_prototype.archives WHERE group_id='"+g+"';").stdout.strip())
            if archive!=scored:raise RuntimeError('Legacy archive was altered')
            if kind=='legacy-start-return' and (result['paid']!=0 or result['closed']):raise RuntimeError('Legacy new round incorrect')
        projection=sql("SELECT g.state=l.state FROM iig_entry_prototype.groups g JOIN iig_legacy_fixture.tens_in_groups l ON l.id=g.id WHERE g.id='"+g+"';").stdout.strip()
        if projection!='t':raise RuntimeError('Legacy projection mismatch')
        print('PASS — real lock contention:',kind,'with guarded legacy RPC and synthetic triggers')

def source_result_races():
    # Source-produced fictional finish/setup payloads; Node executes extracted app
    # functions with mocked I/O. No existing DB/evidence files or real credentials.
    emitted=subprocess.run(['node',str(HERE/'test-source-finish.cjs'),'--emit-concurrency-fixture'],
        env=ENV,text=True,capture_output=True,timeout=15)
    if emitted.returncode:raise RuntimeError('Cannot generate fictional source payload')
    data=json.loads(emitted.stdout);cap='e'*64;round_id=data['before']['roundId']
    for kind in ['source-finish-entry','source-start-return']:
        g='fictional-'+kind;pin='pin-'+kind
        sql("INSERT INTO iig_entry_prototype.groups(id,phase,state) VALUES('"+g+"','open',"+quote_state(data['before'])+");"
            "INSERT INTO iig_legacy_fixture.tens_in_groups(id,group_pin,state) VALUES('"+g+"','"+pin+"',"+quote_state(data['before'])+");"
            "INSERT INTO iig_entry_prototype.principals VALUES('postgres','"+g+"','a',true);"
            "INSERT INTO iig_legacy_fixture.organiser_capabilities VALUES('"+g+"',iig_legacy_fixture.token_hash('"+cap+"'),'2099-01-01',false,ARRAY['finish','start']);")
        finish_sql="SELECT iig_legacy_fixture.finish_with_result('"+pin+"','"+round_id+"',0,'"+cap+"',"+quote_state(data['after'])+");"
        late=json.loads(json.dumps(data['before']));late['players'][-1]['paid']=True;late['_entry_revision']=0
        if kind=='source-finish-entry':
            contend(finish_sql,"SELECT iig_legacy_fixture.save_group_state('"+pin+"',"+quote_state(late)+");")
        else:
            sql(finish_sql);late['_entry_revision']=1
            start_sql="SELECT iig_legacy_fixture.start_with_setup('"+pin+"','"+round_id+"',1,'"+cap+"',"+quote_state(data['setup'])+");"
            contend(start_sql,"SELECT iig_legacy_fixture.save_group_state('"+pin+"',"+quote_state(late)+");")
        archived=json.loads(sql("SELECT snapshot::text FROM iig_entry_prototype.archives WHERE group_id='"+g+"';").stdout.strip())
        if archived!=data['before']:raise RuntimeError('Actual-source archive changed')
        state=json.loads(sql("SELECT state::text FROM iig_entry_prototype.groups WHERE id='"+g+"';").stdout.strip())
        if kind=='source-finish-entry':
            expected=dict(data['after']);expected.pop('_entry_revision',None)
            if state!=expected:raise RuntimeError('Actual-source result payload changed')
        else:
            expected=dict(data['setup']);expected.pop('_entry_revision',None);expected['roundId']=state['roundId']
            if state!=expected or state['roundId']==round_id:raise RuntimeError('Actual-source setup payload changed')
        print('PASS — real lock contention:',kind,'with actual app history/payout payload preserved')

def canonical_candidate_races():
    # OWN disposable local PG only. No real PIN resolver or private evidence.
    import copy
    sql("CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;"
        "CREATE TABLE public.tens_in_groups(id text PRIMARY KEY,fixture_pin text UNIQUE,state jsonb NOT NULL,updated_at timestamptz DEFAULT now());"
        "CREATE TABLE public.fixture_after_effects(group_id text PRIMARY KEY,n integer NOT NULL);"
        "CREATE FUNCTION public.fixture_after_hook() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN "
        "INSERT INTO public.fixture_after_effects VALUES(NEW.id,1) ON CONFLICT(group_id) DO UPDATE SET n=public.fixture_after_effects.n+1;RETURN NEW;END $$;"
        "CREATE TRIGGER fixture_after AFTER UPDATE ON public.tens_in_groups FOR EACH ROW EXECUTE FUNCTION public.fixture_after_hook();")
    candidate=HERE.parents[1]/'supabase/closed-entry-candidate'
    for name in ['core.sql','validators.sql','boundary.sql']:sql((candidate/name).read_text())
    sql("CREATE OR REPLACE FUNCTION iig_closed_entry.resolve_pin(p_pin text) RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT id FROM public.tens_in_groups WHERE fixture_pin=p_pin $$;REVOKE ALL ON FUNCTION iig_closed_entry.resolve_pin(text) FROM PUBLIC;")
    emitted=subprocess.run(['node',str(HERE/'test-source-finish.cjs'),'--emit-concurrency-fixture'],env=ENV,text=True,capture_output=True,timeout=15)
    if emitted.returncode:raise RuntimeError('Cannot generate candidate source fixture')
    source=json.loads(emitted.stdout)
    for v in source.values():v.pop('_entry_revision',None)
    cap='a'*64
    def seed_candidate(g,state):
        sql("INSERT INTO public.tens_in_groups(id,fixture_pin,state) VALUES('"+g+"','"+g+"',"+quote_state(state)+");"
            "SELECT iig_closed_entry.provision('"+g+"','"+cap+"',clock_timestamp()+interval '30 days',ARRAY['finish','start','correct','cancel','members','settle']);")
        return json.loads(sql("SELECT public.iig_entry_read('"+g+"')->'context';").stdout.strip())
    def write_candidate(g,c,op,state,nonce=None):
        nonce=nonce or str(uuid.uuid4())
        return "SELECT public.iig_entry_write('"+g+"','"+g+"','"+c['roundId']+"',"+str(c['revision'])+",'"+op+"',"+quote_state(state)+",'"+cap+"','"+nonce+"');"
    def meta(g):return json.loads(sql("SELECT iig_closed_entry.envelope('"+g+"');").stdout.strip())
    g='candidate-score-entry';before=fixture();c=seed_candidate(g,before)
    score=copy.deepcopy(before);score['players'][0]['stableford']=32;score['players'][0]['scoreSubmitted']=True
    late=copy.deepcopy(before);late['players'][3]['paid']=True
    contend(write_candidate(g,c,'save',score),write_candidate(g,c,'save',late))
    if not meta(g)['closed']:raise RuntimeError('Candidate closure not latched')
    print('PASS — canonical guard race: first score blocks stale payment')
    g='candidate-pin-rotation';seed_candidate(g,fixture())
    contend("UPDATE public.tens_in_groups SET fixture_pin='rotated-fictional-pin' WHERE id='"+g+"';",
            "SELECT public.iig_entry_read('"+g+"');",'GROUP_NOT_FOUND')
    print('PASS — canonical guard race: PIN predicate rechecked after group lock')
    for kind in ['finish-entry','double-finish','start-return','revoke-finish']:
        g='candidate-'+kind;c=seed_candidate(g,source['before']);nonce=str(uuid.uuid4())
        finish=write_candidate(g,c,'finish',source['after'],nonce)
        if kind=='finish-entry':
            late=copy.deepcopy(source['before']);late['players'][-1]['paid']=True
            contend(finish,write_candidate(g,c,'save',late))
        elif kind=='double-finish':
            contend(finish,finish,None)
            n=sql("SELECT n FROM public.fixture_after_effects WHERE group_id='"+g+"';").stdout.strip()
            if n!='1':raise RuntimeError('Duplicate candidate AFTER side effect')
        elif kind=='start-return':
            sql(finish);c=meta(g);late=copy.deepcopy(source['before']);late['players'][-1]['paid']=True
            contend(write_candidate(g,c,'start',source['setup']),write_candidate(g,c,'save',late))
        else:
            contend("SELECT iig_closed_entry.revoke('"+g+"','"+cap+"');",finish,'ORGANISER_CREDENTIAL_REQUIRED')
            if meta(g)['revision']!=0:raise RuntimeError('Revoked candidate committed a finish')
        print('PASS — canonical guard race:',kind)
    for kind in ['correction-entry','correction-finish','cancel-entry','double-cancel','revoke-correction','replace-correction','replace-replace']:
        g='candidate-'+kind;c=seed_candidate(g,source['before'])
        corrected=copy.deepcopy(source['before']);corrected['players'][0]['stableford']=31
        correction=write_candidate(g,c,'correct',corrected)
        late=copy.deepcopy(source['before']);late['players'][-1]['paid']=True
        cancelled=copy.deepcopy(source['before'])
        cancelled.update(course='',date='',gameType='money',pointsCompetition='stableford',pointsValue=10,roundOpen=False)
        for player in cancelled['players']:
            player.update(paid=False,competition=None,stableford=None,netScore=None,noReturn=False,scoreSubmitted=False)
        cancel=write_candidate(g,c,'cancel',cancelled)
        if kind=='correction-entry':contend(correction,write_candidate(g,c,'save',late))
        elif kind=='correction-finish':contend(correction,write_candidate(g,c,'finish',source['after']))
        elif kind=='cancel-entry':contend(cancel,write_candidate(g,c,'save',late))
        elif kind=='double-cancel':
            contend(cancel,cancel,None)
            n=sql("SELECT count(*) FROM iig_closed_entry.archives WHERE group_id='"+g+"';").stdout.strip()
            effects=sql("SELECT n FROM public.fixture_after_effects WHERE group_id='"+g+"';").stdout.strip()
            if n!='1' or effects!='1':raise RuntimeError('Duplicate cancellation archive/AFTER effect')
        elif kind=='revoke-correction':
            contend("SELECT iig_closed_entry.revoke('"+g+"','"+cap+"');",correction,'ORGANISER_CREDENTIAL_REQUIRED')
            if meta(g)['revision']!=0:raise RuntimeError('Revoked correction committed')
        else:
            def replace(token):
                return "SELECT iig_closed_entry.replace_credentials('"+g+"',ARRAY[iig_closed_entry.token_hash('"+cap+"')],'"+token+"',clock_timestamp()+interval '1 day',ARRAY['finish','start','correct','cancel']);"
            if kind=='replace-correction':contend(replace('b'*64),correction,'ORGANISER_CREDENTIAL_REQUIRED')
            else:contend(replace('b'*64),replace('c'*64),'CREDENTIAL_SET_CHANGED')
            if meta(g)['revision']!=0:raise RuntimeError('Replacement changed competition revision')
        if kind in ['cancel-entry','double-cancel']:
            archived=json.loads(sql("SELECT state FROM iig_closed_entry.archives WHERE group_id='"+g+"';").stdout.strip())
            if archived!=source['before']:raise RuntimeError('Cancellation archive mismatch')
        if not meta(g)['closed']:raise RuntimeError('Maintenance reopened entries')
        print('PASS — canonical guard maintenance race:',kind)

    for kind in ['member-profile-entry','member-revoke-profile','double-settlement','member-remove-profile','member-profile-remove']:
        g='candidate-'+kind
        base=copy.deepcopy(source['after'] if kind=='double-settlement' else source['before'])
        c=seed_candidate(g,base)
        if kind=='double-settlement':
            proposed=copy.deepcopy(base);proposed['history'][0]['payouts'][0].update(status='paid',paidAt='2099-01-01T00:00:00Z')
            settled=write_candidate(g,c,'settle',proposed)
            contend(settled,settled,None)
        else:
            member='b'*64
            sql("SELECT iig_closed_entry.provision_member('"+g+"','d','"+member+"',clock_timestamp()+interval '1 day',ARRAY['profile','sidegame','claim']);")
            proposed=copy.deepcopy(base);proposed['players'][3]['handicap']=12.3
            profile=write_candidate(g,c,'profile',proposed).replace("'"+cap+"'","'"+member+"'")
            if kind=='member-profile-entry':
                late=copy.deepcopy(base);late['players'][3]['paid']=True
                contend(profile,write_candidate(g,c,'save',late))
            elif kind=='member-revoke-profile':
                contend("SELECT iig_closed_entry.revoke_member('"+g+"','"+member+"');",profile,'MEMBER_CREDENTIAL_REQUIRED')
            else:
                removed=copy.deepcopy(base);removed['players'].pop(3)
                removal=write_candidate(g,c,'members',removed)
                if kind=='member-remove-profile':contend(removal,profile,'MEMBER_CREDENTIAL_REQUIRED')
                else:contend(profile,removal)
        print('PASS — canonical member/payout race:',kind)


def main():
    created=False
    try:
        if docker('image','inspect',IMAGE).returncode:raise RuntimeError('Pinned PostgreSQL image absent; no automatic pull')
        result=docker('run','--pull=never','--rm','--name',NAME,'--network','none',
          '--tmpfs','/var/lib/postgresql/data:rw,noexec,nosuid','--label','iig.incident.fixture='+NAME,
          '-e','POSTGRES_HOST_AUTH_METHOD=trust','-d',IMAGE,'postgres','-c','listen_addresses=')
        if result.returncode:raise RuntimeError('Cannot create own fixture container')
        created=True;ensure_isolated()
        deadline=time.monotonic()+20
        while ('PostgreSQL init process complete; ready for start up.' not in docker('logs',NAME).stdout
               or docker('exec',NAME,'pg_isready','-h','/var/run/postgresql','-U','postgres').returncode):
            if time.monotonic()>deadline:raise RuntimeError('Own fixture startup timed out')
            time.sleep(.1)
        sql((HERE/'prototype.sql').read_text())
        sql((HERE/'legacy-adapter.sql').read_text())
        sql((HERE/'legacy-finish-result.sql').read_text())
        sql((HERE/'legacy-start-result.sql').read_text())
        race('fictional-score-first',False);race('fictional-entry-first',True)
        for kind in ['finish-entry','finish-score','score-finish','double-finish','start-return']:
            lifecycle('fictional-'+kind,kind)
        real_role_checks()
        legacy_races()
        source_result_races()
        canonical_candidate_races()
        ensure_isolated()
        print('PASS — PostgreSQL 17.6 independent-session races; network none, no ports/mounts, fictional data only.')
    finally:
        if created:
            # Only our uniquely named, labelled disposable container. Never other services.
            ensure_isolated();docker('stop','--time','3',NAME)
if __name__=='__main__':main()
