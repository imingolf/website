from pathlib import Path
import subprocess,sys,shutil,json
root=Path(__file__).resolve().parents[3]
qa=Path(sys.argv[1]).resolve()
identity=json.loads((qa/'.openai/hosting.json').read_text()).get('project_id') if (qa/'.openai/hosting.json').exists() else None
subprocess.run([sys.executable,str(root/'.github/organiser-player/tests/build-browser.py'),str(qa)],check=True)
shutil.copyfile(Path(__file__).with_name('preview-adapter.js'),qa/'dist/app/preview-adapter.js')
shutil.copyfile(Path(__file__).with_name('browser-runner.html'),qa/'dist/checks.html')
(qa/'dist/index.html').write_text('<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=app/"><title>I’m In Golf — private review</title><a href="app/">Open the private preview</a>')

if identity:(qa/'.openai/hosting.json').write_text(json.dumps({'project_id':identity,'static':{'directory':'dist'}})+'\n')
