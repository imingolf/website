#!/usr/bin/env python3
"""Local registration demonstration. Standard library only; no outbound network or database code."""
import argparse
import hashlib
import json
import ipaddress
import re
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
CSP = ("default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
       "img-src 'self' data:; connect-src 'none'; worker-src 'none'; child-src 'none'; "
       "frame-src 'none'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'; "
       "object-src 'none'; manifest-src 'none'; media-src 'none'; font-src 'none'")
PRIVATE = [ipaddress.ip_network(n) for n in ('127.0.0.0/8','10.0.0.0/8','172.16.0.0/12','192.168.0.0/16')]


def private_ipv4(value):
    try:
        address = ipaddress.IPv4Address(value)
        return any(address in network for network in PRIVATE)
    except ipaddress.AddressValueError:
        return False


def local_address():
    # Read local interface configuration only. Never probe an Internet address.
    if sys.platform == 'darwin':
        for interface in ('en0','en1','en2','en3','en4','en5','en6','en7'):
            result = subprocess.run(['/usr/sbin/ipconfig','getifaddr',interface], capture_output=True, text=True)
            candidate = result.stdout.strip()
            if private_ipv4(candidate) and not candidate.startswith('127.'):
                return candidate
    return '127.0.0.1'


def replace_once(source, old, new):
    if source.count(old) != 1:
        raise ValueError('App source changed; review the demonstration adapter before serving')
    return source.replace(old, new, 1)


def read_approved(directory, name):
    path = directory / name
    if directory.is_symlink() or path.is_symlink() or path.resolve().parent != directory.resolve():
        raise ValueError('Refuse symlink or unreviewed asset path: '+name)
    return path.read_bytes()


def isolated_copy(source):
    for old,new in [('localStorage','window.IIG_DEMO.storage'),('sessionStorage','window.IIG_DEMO.storage'),
                    ('navigator.share','window.IIG_DEMO.share'),('navigator.clipboard','window.IIG_DEMO.clipboard'),
                    ('window.open(','window.IIG_DEMO.open('),('window.IigPurchase','window.IIG_DEMO.purchase')]:
        source=source.replace(old,new)
    return source


def build_assets():
    app = REPO / 'app'
    assets = {}
    names=('index.html','handicap-input.js','secure-organiser.js','secure-player.js','account-controls.js','self-service.js','icon-192.png','apple-touch-icon.png')
    inputs={name:read_approved(app,name) for name in names}
    pins=json.loads(read_approved(HERE,'source-sha256.json'))
    if pins.get('source_commit')!='a5b1b6a125f0609dfe8827136a8ef0c7857e6819' or set(pins.get('sha256',{}))!=set(names):
        raise ValueError('Unreviewed demonstration source manifest')
    for name,body in inputs.items():
        if hashlib.sha256(body).hexdigest()!=pins['sha256'][name]:
            raise ValueError('Approved app asset changed; review demo adapter and source manifest: '+name)
    html = inputs['index.html'].decode()
    html = replace_once(html, "<title>I'm In Golf</title>", "<title>DEMONSTRATION — I'm In Golf (local)</title>")
    html = replace_once(html, '<head>', '<head>\n<meta name="iig-local-demo" content="isolated-v1">\n'
                        '<script src="/demo/notice.js"></script><link rel="stylesheet" href="/demo/notice.css"><script src="/demo/review.js"></script><link rel="stylesheet" href="/demo/review.css">')
    for tag in ('<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>',
                '<script src="./config.js"></script>', '<link rel="manifest" href="manifest.webmanifest">'):
        html = replace_once(html, tag, '')
    html, count = re.subn(r'const IIG_VAPID_PUBLIC_KEY="[^"\n]+";', 'const IIG_VAPID_PUBLIC_KEY="";', html)
    if count != 1:
        raise ValueError('Notification configuration changed; refuse unreviewed demo build')
    html = isolated_copy(html)
    assets['/app/'] = ('text/html; charset=utf-8', html.encode())
    assets['/app/index.html'] = assets['/app/']
    host_guard = "if(location.hostname!=='deploy-preview-6--super-quokka-51747d.netlify.app' && !['localhost','127.0.0.1'].includes(location.hostname))return;"
    for name in ('handicap-input.js','secure-organiser.js','secure-player.js','account-controls.js','self-service.js'):
        source = inputs[name].decode()
        if name in ('secure-organiser.js','secure-player.js'):
            source = replace_once(source,host_guard,"if(window.IIG_DEMO?.isolated!==true)return;")
        elif name == 'account-controls.js':
            source = replace_once(source,"if(!['deploy-preview-6--super-quokka-51747d.netlify.app','localhost','127.0.0.1'].includes(location.hostname))return;",
                                  "if(window.IIG_DEMO?.isolated!==true)return;")
        elif name == 'self-service.js':
            source = replace_once(source,"const allowed = location.hostname === 'deploy-preview-6--super-quokka-51747d.netlify.app' || ['localhost', '127.0.0.1'].includes(location.hostname);",
                                  'const allowed = window.IIG_DEMO?.isolated === true;')
            source = replace_once(source,"const base = 'https://nyavvwrsrxqfyhiygkgw.supabase.co';",'const base = location.origin;')
            source = replace_once(source,"const key = 'sb_publishable_fDGji75-j3GP5VeAAIAdZg_f9TNmtWL';","const key = 'DEMONSTRATION-NOT-A-CREDENTIAL';")
            source = source.replace('crypto.randomUUID()', 'window.IIG_DEMO.uuid()')
            source = source.replace('Preview: creates real groups in the test database only.', 'DEMONSTRATION: no account, email or real group is created.')
            source = source.replace('Your group has been registered with I’m In Golf.', 'This fictional group exists only in this browser demonstration.')
            source = source.replace('Your name and email are shared with I’m In Golf to manage your group and trial.', 'Use made-up details only. They stay in this browser demonstration.')
        if name=='secure-organiser.js':
            source=replace_once(source,"'https://wa.me/?text='+encodeURIComponent(message)","'#iig-demo-whatsapp='+encodeURIComponent(message)")
        source = isolated_copy(source)
        assets['/app/'+name] = ('application/javascript; charset=utf-8',source.encode())
    for name in ('icon-192.png','apple-touch-icon.png'):
        assets['/app/'+name] = ('image/png',inputs[name])
    for name,content_type in (('notice.js','application/javascript; charset=utf-8'),('notice.css','text/css; charset=utf-8'),('review.js','application/javascript; charset=utf-8'),('review.css','text/css; charset=utf-8')):
        assets['/demo/'+name] = (content_type,read_approved(HERE,name))
    # No config.js, manifests, service workers, database files, repo tree or directory listing.
    for _, body in assets.values():
        if b'sb_publishable_' in body or b'sb_secret_' in body or b'https://nyavvwrsrxqfyhiygkgw.supabase.co' in body:
            raise ValueError('Refuse credentials/online TEST target in demo bundle')
    return assets


def make_server(host, port, assets):
    if not private_ipv4(host):
        raise ValueError('Bind only a specific private LAN IPv4 address or loopback, never 0.0.0.0/public hosts')
    class Handler(BaseHTTPRequestHandler):
        server_version = 'IIG-Local-Demonstration'
        sys_version = ''
        def log_message(self, *_args):
            pass  # No request/body/credential logging.
        def headers_for(self, status, length, content_type='text/plain; charset=utf-8'):
            self.send_response(status)
            for key,value in {'Content-Type':content_type,'Content-Length':str(length),
                    'Content-Security-Policy':CSP,'Cache-Control':'no-store',
                    'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY',
                    'Referrer-Policy':'no-referrer','X-DNS-Prefetch-Control':'off',
                    'Cross-Origin-Resource-Policy':'same-origin',
                    'Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=()'}.items():
                self.send_header(key,value)
        def reply(self, status, body=b'Not available in this demonstration.\n', content_type='text/plain; charset=utf-8'):
            self.headers_for(status,len(body),content_type); self.end_headers()
            if self.command != 'HEAD': self.wfile.write(body)
        def valid_request(self):
            expected = host+':'+str(self.server.server_port)
            allowed = {expected}
            if host == '127.0.0.1': allowed.add('localhost:'+str(self.server.server_port))
            # Host checking prevents DNS rebinding; no wildcard hosts or forwarded identities.
            return (private_ipv4(self.client_address[0]) and self.headers.get('Host') in allowed
                    and self.headers.get('Sec-Fetch-Site') != 'cross-site'
                    and self.headers.get('Origin', 'http://'+expected) in {'http://'+h for h in allowed})
        def do_GET(self):
            if not self.valid_request(): self.reply(403); return
            path = urlsplit(self.path).path
            if path == '/':
                self.headers_for(302,0); self.send_header('Location','/app/'); self.end_headers(); return
            asset = assets.get(path)
            if asset is None: self.reply(404); return
            content_type,body = asset; self.reply(200,body,content_type)
        def do_HEAD(self): self.do_GET()
        def do_POST(self): self.reply(405)
        do_PUT = do_POST
        do_DELETE = do_POST
        do_PATCH = do_POST
        do_OPTIONS = do_POST
    server = ThreadingHTTPServer((host,port), Handler)
    server.daemon_threads = True
    return server


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host',default='auto',help='auto selects a Mac private en interface, otherwise loopback')
    parser.add_argument('--port',type=int,default=0,help='0 chooses a fresh available port (recommended)')
    args = parser.parse_args()
    branch = subprocess.run(['git','-C',str(REPO),'branch','--show-current'],check=True,capture_output=True,text=True).stdout.strip()
    if branch != 'improve-new-user-registration':
        raise ValueError('Switch to improve-new-user-registration before starting this demo')
    if not 0 <= args.port <= 65535:
        raise ValueError('Port must be between 0 and 65535')
    host = local_address() if args.host == 'auto' else args.host
    assets = build_assets()
    server = make_server(host,args.port,assets)
    print('\nDEMONSTRATION — fictional data only; no online services or database access.',flush=True)
    print('Open on your Mac: http://'+host+':'+str(server.server_port)+'/app/',flush=True)
    if host.startswith('127.'):
        print('Loopback only: iPhone access is unavailable. Use --host with your Mac’s private Wi-Fi IPv4 address.',flush=True)
    else:
        print('On your iPhone, join the same trusted Wi-Fi and open that exact address in Safari.',flush=True)
    print('Demo email: alex@example.test   Demo code: 123456',flush=True)
    print('Use Review controls for returning users, friend joining and errors. Each browser has its own fictional data.',flush=True)
    print('Stop: press Control+C in this Terminal. No files are saved. No public tunnel is created.\n',flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: print('\nDemonstration stopped.',flush=True)
    finally: server.server_close()

if __name__ == '__main__':
    try: main()
    except (OSError,ValueError,subprocess.CalledProcessError) as error:
        print('STOP: '+str(error),file=sys.stderr); sys.exit(1)
