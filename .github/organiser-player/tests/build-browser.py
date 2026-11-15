"""Isolated browser QA copy, blocked from contacting the live backend."""
from pathlib import Path
import shutil,json,sys
root=Path(__file__).resolve().parents[3]
qa=Path(sys.argv[1]).resolve()
qa.mkdir(parents=True,exist_ok=True)
dist=qa/'dist'
if dist.exists():shutil.rmtree(dist)
shutil.copytree(root/'app',dist/'app')
app=dist/'app'
html=(app/'index.html').read_text().replace('<head>',"""<head>
<meta http-equiv="Content-Security-Policy" content="default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'none'; worker-src 'none'; frame-src 'none'; form-action 'none'; object-src 'none'; base-uri 'none'">
<meta name="robots" content="noindex,nofollow">
<style>#privatePreviewBar{position:fixed;top:0;left:0;right:0;z-index:30000;background:#163b2b;color:#fff;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 16px;font-size:12px;line-height:1.4}#privatePreviewBar button{background:#fff;color:#163b2b;border:0;border-radius:8px;padding:8px 12px;font-size:12px;min-width:82px}#setupOverlay{padding-top:96px!important}body{padding-top:70px}.welcome-shell{padding-bottom:20px}</style>""",1)
html=html.replace('<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4"></script>','<script src="preview-adapter.js"></script>')
(app/'index.html').write_text(html)
shutil.copyfile(Path(__file__).parent/'preview-adapter.js',app/'preview-adapter.js')
config=(app/'config.js').read_text();end=config.index('};')+2
(app/'config.js').write_text('window.TENS_IN_CONFIG={supabaseUrl:"https://nyavvwrsrxqfyhiygkgw.supabase.co",supabaseKey:"preview-only-no-real-key"};'+config[end:])
(app/'full-release.production.js').write_text("window.IIG_ACCOUNT_BUILD=Object.freeze({release:'focused-v1',mode:'test-only',projectRef:'nyavvwrsrxqfyhiygkgw',origin:location.origin});")
p=app/'entry-guard-client.js';p.write_text(p.read_text().replace('!/^https:\\/\\//.test(origin)','!/^https?:\\/\\//.test(origin)'))
(app/'owner-dashboard.html').unlink(missing_ok=True);(app/'notification-sw.js').unlink(missing_ok=True)
shutil.copyfile(Path(__file__).parent/'browser-runner.html',dist/'index.html')
(qa/'.openai').mkdir(exist_ok=True)
(qa/'.openai/hosting.json').write_text(json.dumps({'static':{'directory':'dist'}}))
print('Isolated QA built at '+str(qa))
