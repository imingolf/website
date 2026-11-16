from pathlib import Path
import subprocess,sys,shutil
root=Path(__file__).resolve().parents[3]
qa=Path(sys.argv[1]).resolve()
subprocess.run([sys.executable,str(root/'.github/organiser-player/tests/build-browser.py'),str(qa)],check=True)
for name in ['preview-adapter.js','browser-runner.html']:
 shutil.copyfile(Path(__file__).with_name(name),qa/('dist/app/preview-adapter.js' if name.endswith('.js') else 'dist/index.html'))
