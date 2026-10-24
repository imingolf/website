#!/usr/bin/env python3
"""Offline-only static demonstration builder. No deploy, service, database or network code."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
from urllib.parse import urlsplit

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('isolated_local_demo',HERE/'serve.py')
demo=importlib.util.module_from_spec(spec);spec.loader.exec_module(demo)
CSP=demo.CSP
GUARD="if(window.IIG_HOSTED_DEMO_ALLOWED!==true)throw Error('Demonstration origin is not approved');\n"


def checked_origin(value):
    u=urlsplit(value)
    if u.scheme!='https' or not u.hostname or u.username or u.password or u.port not in (None,443) or u.path not in ('','/') or u.query or u.fragment:
        raise ValueError('An explicit isolated HTTPS origin is required')
    host=u.hostname.lower()
    if not re.fullmatch(r'[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?',host) or '..' in host or host=='localhost':raise ValueError('Invalid demo hostname')
    if host in ('imingolf.co.uk','www.imingolf.co.uk','super-quokka-51747d.netlify.app','supabase.co','supabase.com') or host.endswith(('.imingolf.co.uk','--super-quokka-51747d.netlify.app','.supabase.co','.supabase.com')):
        raise ValueError('Production, preview-of-production and database origins are forbidden')
    return 'https://'+host


def assets(origin):
    origin=checked_origin(origin);source=demo.build_assets();result={}
    for route,(kind,body) in source.items():
        if route=='/app/':continue
        if kind.startswith(('text/','application/javascript')):
            text=body.decode()
            # Remove dormant production URL literals as well as the executable clients.
            text=text.replace('imingolf.co.uk','example.invalid')
            text=text.replace('super-quokka-51747d.netlify.app','blocked-original-site.invalid')
            text=text.replace('window.location.assign(link)','window.IIG_DEMO.open(link)')
            if route=='/app/secure-organiser.js':
                text=text.replace('Saved to your test group.','Saved in this tab only.').replace('Test group','Demonstration group').replace('test group','practice group')
                text=text.replace('Share on WhatsApp','Preview WhatsApp invitation').replace('Copy invitation message','Preview invitation text').replace('Open invitation in a new tab','Preview invitation destination')
            if route=='/app/secure-player.js':
                text=text.replace('Test group','Demonstration group')
            if route=='/app/self-service.js':
                text=text.replace('Check your inbox and junk folder. Keep this page open.','No email is sent. Enter demonstration code 123456.')
                text=text.replace('Enter the latest code sent to ','Demo code 123456 for ')
                text=text.replace('Email me a sign-in code','Get demonstration code').replace('Code from your email','Demonstration code')
            if kind.startswith('text/html'):
                text=text.replace('<head>','<head><meta name="robots" content="noindex,nofollow,noarchive"><meta name="iig-hosted-demo" content="isolated-static-v1"><script src="/demo/host-boundary.js"></script><meta http-equiv="Content-Security-Policy" content="'+CSP.replace("frame-ancestors 'none'; ",'')+'">',1)
                text=text.replace('(local)</title>','(fictional practice)</title>')
                text=text.replace('</head>','<script src="/demo/hosted-review.js"></script><link rel="stylesheet" href="/demo/hosted-review.css"></head>')
                text=re.sub(r'(<script\b(?![^>]*\bsrc=)[^>]*>)([\s\S]*?)(</script>)',lambda m:m[1]+GUARD+m[2]+m[3],text)
            elif route.endswith('.js'):text=GUARD+text
            body=text.encode()
        result[route.lstrip('/')]=body
    # An exact origin is required; a misplaced upload locks before app scripts run.
    bootstrap="'use strict';\nconst allowed=location.origin==="+json.dumps(origin)+"&&location.protocol==='https:';\nObject.defineProperty(window,'IIG_HOSTED_DEMO_ALLOWED',{value:allowed,writable:false,configurable:false});\nif(!allowed)document.addEventListener('DOMContentLoaded',()=>{document.body.textContent='DEMONSTRATION unavailable: this is not the approved isolated HTTPS site. No account or database connection is available.';});\n"
    result['demo/host-boundary.js']=bootstrap.encode()
    for name in ('hosted-review.js','hosted-review.css'):result['demo/'+name]=(GUARD if name.endswith('.js') else '').encode()+demo.read_approved(HERE,name)
    # Reuse only the actual opening artwork/animation, never released PIN/config code.
    app=demo.read_approved(demo.REPO/'app','index.html').decode()
    start=app.index('<div id="openingSplash"');end=app.index('</script>',start)+len('</script>')
    splash=app[start:end]
    css_start=app.index('#openingSplash{');css_end=app.index('@media (prefers-reduced-motion:reduce){#openingSplash{transition:none}}')+len('@media (prefers-reduced-motion:reduce){#openingSplash{transition:none}}')
    splash_css=app[css_start:css_end]
    if hashlib.sha256(splash.encode()).hexdigest()!='df383076505ebc1e98d962e42dfaac7c0b6d1d69c0c72732aefc0b628418b43c' or hashlib.sha256(splash_css.encode()).hexdigest()!='9f40d9465be517b3da4e167fe3843364e01f11b78de8a621e86270fdc721c951':
        raise ValueError('Released opening reference changed; review before building')
    result['demo/welcome.js']=GUARD.encode()+demo.read_approved(HERE,'welcome.js')
    landing=demo.read_approved(HERE,'landing.html').decode().replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="'+CSP.replace("frame-ancestors 'none'; ",'')+'">',1)
    landing=landing.replace('<!--RELEASED_SPLASH-->',splash).replace('<!--RELEASED_SPLASH_CSS-->',splash_css)
    landing=re.sub(r'(<script\b(?![^>]*\bsrc=)[^>]*>)([\s\S]*?)(</script>)',lambda m:m[1]+GUARD+m[2]+m[3],landing)
    result['index.html']=landing.encode()
    result['404.html']=b'<!doctype html><meta name="robots" content="noindex,nofollow"><title>Demonstration only</title><p>This page is not part of the fictional demonstration.</p>'
    result['robots.txt']=b'User-agent: *\nDisallow: /\n'
    result['_headers']=('/*\n  Content-Security-Policy: '+CSP+'\n  Cache-Control: no-store\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Referrer-Policy: no-referrer\n  X-DNS-Prefetch-Control: off\n  Cross-Origin-Resource-Policy: same-origin\n  X-Robots-Tag: noindex, nofollow, noarchive\n  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), clipboard-write=()\n').encode()
    # No SPA fallback exposing unrecognised routes as app pages.
    result['_redirects']=b'/app /app/ 301\n/* /404.html 404\n'
    for name,body in result.items():
        if any(b in body for b in (b'sb_publishable_',b'sb_secret_',b'kzzzputsqxdntfqpprnz',b'nyavvwrsrxqfyhiygkgw',b'imingolf.co.uk',b'super-quokka-51747d')):
            raise ValueError('Forbidden online endpoint/configuration in demonstration asset: '+name)
    return result


def build(out,origin):
    origin=checked_origin(origin);out=out.expanduser().absolute()
    if out.exists() or out.is_symlink() or demo.REPO.resolve()==out.resolve() or demo.REPO.resolve() in out.resolve().parents:
        raise ValueError('Choose a NEW output directory outside the repository')
    files=assets(origin)
    branch=subprocess.run(['git','-C',str(demo.REPO),'branch','--show-current'],capture_output=True,text=True,check=True).stdout.strip()
    if branch!='improve-new-user-registration':raise ValueError('Wrong development branch')
    out.mkdir(parents=True,mode=0o700)
    for name,body in files.items():
        path=out/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(body)
    manifest={'kind':'FICTIONAL_STATIC_DEMONSTRATION','origin':origin,'deployed':False,'database_connections':False,'source_app_commit':'a5b1b6a125f0609dfe8827136a8ef0c7857e6819','sha256':{name:hashlib.sha256(body).hexdigest() for name,body in files.items()}}
    (out/'demo-build-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    return manifest


def verify(out,origin):
    origin=checked_origin(origin);out=out.expanduser().absolute()
    if not out.is_dir() or out.is_symlink():raise ValueError('Missing or symlinked demonstration output')
    expected=assets(origin);manifest=json.loads((out/'demo-build-manifest.json').read_text())
    paths=list(out.rglob('*'))
    if any(p.is_symlink() for p in paths):raise ValueError('Symlink in demonstration output')
    actual={str(p.relative_to(out)) for p in paths if p.is_file()}
    if actual!=set(expected)|{'demo-build-manifest.json'}:raise ValueError('Unexpected/missing files; do not publish this folder')
    if manifest!={'kind':'FICTIONAL_STATIC_DEMONSTRATION','origin':origin,'deployed':False,'database_connections':False,'source_app_commit':'a5b1b6a125f0609dfe8827136a8ef0c7857e6819','sha256':{name:hashlib.sha256(body).hexdigest() for name,body in expected.items()}}:raise ValueError('Demonstration manifest mismatch')
    for name,body in expected.items():
        if (out/name).read_bytes()!=body:raise ValueError('Changed demonstration asset: '+name)
    return manifest


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--out',type=Path,required=True);p.add_argument('--origin',required=True);p.add_argument('--verify',action='store_true');a=p.parse_args()
    (verify if a.verify else build)(a.out,a.origin);print('PASS: fictional static files prepared. NOT DEPLOYED. Upload only this generated folder after separate approval: '+str(a.out))

if __name__=='__main__':main()
