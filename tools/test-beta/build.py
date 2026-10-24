#!/usr/bin/env python3
"""Build an unpublished TEST-only web artifact. No network, SQL or deployment operations."""
import argparse
import hashlib
import ipaddress
import json
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import urlsplit

HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
PROJECT='nyavvwrsrxqfyhiygkgw'
TEST_URL='https://'+PROJECT+'.supabase.co'
KEY_SHA256='02ebf3de24b1d60df3c781e7cc0f0a1c0845b72a82c8132b80ec9185e709cac2'
FIELDS={'projectRef','supabaseUrl','publishableKey','betaOrigin'}
APP_FILES=('index.html','owner-dashboard.html','handicap-input.js','secure-organiser.js','secure-player.js','account-controls.js','self-service.js','icon-192.png','apple-touch-icon.png')
RPC_NAMES=('get_group_access_status','iig_create_owned_group','iig_get_owned_group','iig_save_owned_group',
           'iig_join_owned_group','iig_get_player_group','iig_list_registered_groups','iig_my_group_identity',
           'iig_set_my_attendance','iig_submit_my_score','iig_player_action','iig_request_owner_transfer','iig_accept_owner_transfer')
API_PATHS=('/auth/v1/otp','/auth/v1/verify','/auth/v1/logout','/auth/v1/user')+tuple('/rest/v1/rpc/'+name for name in RPC_NAMES)
CSP=("default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
     "img-src 'self' data:; connect-src "+' '.join(TEST_URL+p for p in API_PATHS)+"; worker-src 'none'; frame-src 'none'; "
     "frame-ancestors 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; manifest-src 'none'; media-src 'none'; font-src 'none'")

def require(ok,message):
    if not ok: raise ValueError(message)

def validate_config(c):
    require(isinstance(c,dict) and set(c)==FIELDS,'Require exactly the four documented TEST configuration fields')
    require(all(isinstance(v,str) for v in c.values()),'Configuration fields must be strings')
    require(c['projectRef']==PROJECT and c['supabaseUrl']==TEST_URL,'Only the exact approved TEST project and HTTPS endpoint are permitted')
    require(hashlib.sha256(c['publishableKey'].encode()).hexdigest()==KEY_SHA256,
            'Publishable key does not match the reviewed TEST key; never use service-role/secret/production credentials')
    u=urlsplit(c['betaOrigin'])
    require(u.scheme=='https' and bool(u.hostname) and u.netloc==u.hostname and not u.path and not u.query and not u.fragment,
            'Require an exact HTTPS beta origin, without credentials, port, path, query or fragment')
    host=u.hostname
    require(len(host)<=253 and all(re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?',label) for label in host.split('.')),'Require a canonical ASCII DNS hostname')
    require(c['betaOrigin']=='https://'+host,'Beta origin must be canonical HTTPS')
    require(host not in ('localhost','supabase.co','supabase.com') and '.' in host and not host.endswith('.supabase.co') and not host.endswith('.supabase.com'),
            'A separate HTTPS beta website origin is required')
    require(not (host=='imingolf.co.uk' or host.endswith('.imingolf.co.uk') or 'super-quokka-51747d' in host),
            'Production domains and the production Netlify site/previews cannot host this isolated beta')
    try: ipaddress.ip_address(host)
    except ValueError: pass
    else: raise ValueError('Require a dedicated beta DNS hostname, not an IP address')
    return dict(c)

def replace_once(source,old,new):
    require(source.count(old)==1,'Approved source marker changed; review beta adapter')
    return source.replace(old,new,1)

def pinned_sources():
    pins=json.loads((HERE/'source-sha256.json').read_text())
    require(pins.get('source_commit')=='a5b1b6a125f0609dfe8827136a8ef0c7857e6819' and set(pins['sha256'])==set(APP_FILES),'Unreviewed source manifest')
    inputs={}
    for name in APP_FILES:
        path=REPO/'app'/name
        require(not path.is_symlink() and not (REPO/'app').is_symlink(),'Refuse symlink assets')
        data=path.read_bytes()
        require(hashlib.sha256(data).hexdigest()==pins['sha256'][name],'Approved application asset changed: '+name)
        inputs[name]=data
    return inputs

def isolated_code(source):
    # References cannot accidentally invoke native production purchases or unrestricted navigation.
    source=source.replace('window.open(', 'window.IIG_TEST_BETA.open(')
    source=source.replace('window.location.assign(link);','window.IIG_TEST_BETA.open(link);')
    source=source.replace('window.IigPurchase', 'window.IIG_TEST_BETA.purchase')
    source=source.replace('https://imingolf.co.uk/app/', '__IIG_BETA_ORIGIN__/app/')
    source=source.replace('https://imingolf.co.uk', '__IIG_BETA_ORIGIN__')
    source=source.replace('hello@imingolf.co.uk','your beta organiser')
    return source

def html_shell(source,owner=False):
    for tag in ('<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>','<script src="./config.js"></script>'):
        source=replace_once(source,tag,'')
    source=source.replace('<link rel="manifest" href="manifest.webmanifest">','')
    source=replace_once(source,'<meta charset="utf-8">','')
    source=replace_once(source,'<head>','<head>\n<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="'+CSP+'">\n'
                        '<link rel="stylesheet" href="/beta/isolation.css"><script src="/beta/config.js"></script><script src="/beta/isolation.js"></script>')
    modules=['account-controls.js','self-service.js'] if owner else ['secure-organiser.js','secure-player.js','account-controls.js','self-service.js']
    for module in modules: source=replace_once(source,'<script src="'+module+'"></script>','')
    if owner:
        scripts=list(re.finditer(r'<script>([\s\S]*?)</script>',source))
        old=[m for m in scripts if 'supabase.createClient' in m.group(1)]
        require(len(old)==1,'Expected one legacy owner dashboard program')
        source=source[:old[0].start()]+source[old[0].end():]
    else:
        demo_start=source.index('function ensureDemoMoneyHistory(){')
        demo_end=source.index('let lastWinnerRecord=null;',demo_start)
        source=source[:demo_start]+'function ensureDemoMoneyHistory(){}\n'+source[demo_end:]
        state_start=source.index('let state={\n course:')
        state_end=source.index('const $=id=>document.getElementById(id);',state_start)
        source=source[:state_start]+"let state={players:[],history:[],course:'',date:'',roundOpen:false,gameType:'points',pointsCompetition:'stableford'};\n\n"+source[state_end:]
        source=source.replace('pin==="2026"','false').replace('pin!=="2026"','true')
        start=source.index('function configured(){')
        end=source.index('function cancelProtectedDialogs(){',start)
        # Removes production client construction, saved-PIN auto-connect, legacy owner setup and activity writes.
        source=source[:start]+'''function configured(){return false;}
async function connect(){return window.IIG_TEST_BETA.routePin(document.getElementById('pinInput').value);}
'''+source[end:]
        source,n=re.subn(r'const IIG_VAPID_PUBLIC_KEY="[^"\n]+";','const IIG_VAPID_PUBLIC_KEY="";',source)
        require(n==1,'Notification configuration changed')
    source=replace_once(source,'</body>','<script>window.IIG_TEST_BETA.start('+json.dumps(modules)+');</script>\n</body>')
    source=source.replace("<title>I'm In Golf", "<title>TEST BETA — I'm In Golf")
    return isolated_code(source)

def output_files():
    return {'index.html','_headers','build-manifest.json','beta/config.js','beta/isolation.js','beta/isolation.css','beta/legacy-gate.js'}|{'app/'+x for x in APP_FILES}

def audit_assets(assets):
    require(set(assets)==output_files(),'Unexpected beta output files')
    for name,body in assets.items():
        if name.endswith('.png'): continue
        text=body.decode()
        for banned in ('kzzzputsqxdntfqpprnz','imingolf.co.uk','super-quokka-51747d','sb_secret_','service_role','DEMONSTRATION_ONLY','IIG_DEMO','supabase.createClient','cdn.jsdelivr.net','c2JfcHVibGlzaGFibGVfOF9zT2drVGJUaUt5'):
            require(banned not in text,'Prohibited production/demo/legacy content in '+name)
        require('src="./config.js"' not in text,'Production configuration referenced')

def build_assets(config=None):
    c=validate_config(config) if config is not None else None
    inputs=pinned_sources();assets={}
    for name,body in inputs.items():
        if name.endswith('.png'): assets['app/'+name]=body;continue
        source=body.decode()
        if name.endswith('.html'): source=html_shell(source,owner=name=='owner-dashboard.html')
        elif name in ('secure-organiser.js','secure-player.js'):
            source=replace_once(source,"if(location.hostname!=='deploy-preview-6--super-quokka-51747d.netlify.app' && !['localhost','127.0.0.1'].includes(location.hostname))return;",'if(window.IIG_TEST_BETA?.ready!==true)return;')
        elif name=='account-controls.js':
            source=replace_once(source,"if(!['deploy-preview-6--super-quokka-51747d.netlify.app','localhost','127.0.0.1'].includes(location.hostname))return;",'if(window.IIG_TEST_BETA?.ready!==true)return;')
        elif name=='self-service.js':
            source=replace_once(source,"const allowed = location.hostname === 'deploy-preview-6--super-quokka-51747d.netlify.app' || ['localhost', '127.0.0.1'].includes(location.hostname);",'const allowed = window.IIG_TEST_BETA?.ready === true;')
            source=replace_once(source,"const base = 'https://nyavvwrsrxqfyhiygkgw.supabase.co';",'const base = window.IIG_TEST_BETA.config.supabaseUrl;')
            source=replace_once(source,"const key = 'sb_publishable_fDGji75-j3GP5VeAAIAdZg_f9TNmtWL';",'const key = window.IIG_TEST_BETA.config.publishableKey;')
        source=isolated_code(source)
        # Legacy invitation text is bound to the configured beta, never a production site.
        source=source.replace('__IIG_BETA_ORIGIN__',c['betaOrigin'] if c else 'https://beta-not-configured.invalid')
        assets['app/'+name]=source.encode()
    for name in ('isolation.js','isolation.css','legacy-gate.js'):
        assets['beta/'+name]=(HERE/name).read_bytes()
    assets['beta/config.js']=('window.IIG_TEST_BETA_CONFIG='+('Object.freeze('+json.dumps(c)+')' if c else 'null')+';\n').encode()
    headers={'Content-Security-Policy':CSP,'Cache-Control':'no-store','Referrer-Policy':'no-referrer',
             'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','X-DNS-Prefetch-Control':'off',
             'Cross-Origin-Resource-Policy':'same-origin','Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=()'}
    assets['_headers']=('/*\n'+''.join('  '+k+': '+v+'\n' for k,v in headers.items())).encode()
    assets['index.html']=('<!doctype html><meta charset="utf-8"><title>TEST beta</title><a href="/app/">Open isolated TEST beta</a>').encode()
    manifest={'mode':'TEST_ONLY','project':PROJECT,'configured':c is not None,'deployed':False,
              'source_commit':'a5b1b6a125f0609dfe8827136a8ef0c7857e6819',
              'files':{n:hashlib.sha256(v).hexdigest() for n,v in assets.items()}}
    assets['build-manifest.json']=(json.dumps(manifest,indent=2)+'\n').encode()
    audit_assets(assets)
    return assets

def verify_artifact(out):
    out=Path(out)
    require(out.is_dir() and not out.is_symlink(),'Missing or symlinked beta output')
    found=set()
    for path in out.rglob('*'):
        require(not path.is_symlink(),'Symlink in beta output')
        if path.is_file(): found.add(path.relative_to(out).as_posix())
    require(found==output_files(),'Unexpected or missing files in beta output; never upload the repository root')
    text=(out/'beta/config.js').read_text()
    if text=='window.IIG_TEST_BETA_CONFIG=null;\n': config=None
    else:
        prefix='window.IIG_TEST_BETA_CONFIG=Object.freeze(';suffix=');\n'
        require(text.startswith(prefix) and text.endswith(suffix),'Unrecognised beta configuration program')
        config=validate_config(json.loads(text[len(prefix):-len(suffix)]))
    expected=build_assets(config)
    for name,body in expected.items():
        require((out/name).read_bytes()==body,'Beta output changed or stale: '+name)
    return json.loads(expected['build-manifest.json'])


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config',type=Path,help='Explicit TEST public configuration. Omit to build a deliberately disabled package.')
    parser.add_argument('--out',type=Path,required=True,help='New output directory; never deploy or serve the repository root')
    parser.add_argument('--verify',action='store_true',help='Read-only verification of an existing output against approved sources and policy')
    args=parser.parse_args()
    branch=subprocess.run(['git','-C',str(REPO),'branch','--show-current'],check=True,capture_output=True,text=True).stdout.strip()
    require(branch=='improve-new-user-registration','Wrong development branch')
    if args.verify:
        require(args.config is None,'Verify uses the artifact configuration, never an override')
        manifest=verify_artifact(args.out)
        print('PASS — existing TEST-only artifact verified; NOT DEPLOYED')
        print('Configured: '+str(manifest['configured']))
        return
    config=json.loads(args.config.read_text()) if args.config else None
    assets=build_assets(config)
    out=args.out.resolve()
    require(not out.exists(),'Output already exists; refuse overwrite')
    require(out!=REPO and REPO not in out.parents,'Choose a build output outside the source repository')
    out.mkdir(parents=True,mode=0o700)
    for name,body in assets.items():
        target=out/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(body)
    verify_artifact(out)
    print('PASS — isolated TEST-only build prepared; NOT DEPLOYED')
    print('Configuration: '+('explicit TEST only' if config else 'MISSING — deliberately locked; cannot sign in or connect'))
    print('Output: '+str(out))
    print('No databases contacted, SQL executed, permissions changed or hosting modified.')

if __name__=='__main__':
    try: main()
    except (ValueError,OSError,subprocess.CalledProcessError) as error:
        print('FAIL — '+str(error),file=sys.stderr);sys.exit(1)
