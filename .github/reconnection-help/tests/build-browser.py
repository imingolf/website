from pathlib import Path
import subprocess,sys,shutil
root=Path(__file__).resolve().parents[3]
qa=Path(sys.argv[1]).resolve()
subprocess.run([sys.executable,str(root/'.github/organiser-player/tests/build-browser.py'),str(qa)],check=True)
shutil.copyfile(Path(__file__).with_name('preview-adapter.js'),qa/'dist/app/preview-adapter.js')
shutil.copyfile(Path(__file__).with_name('browser-runner.html'),qa/'dist/index.html')
