"""Build a standalone static preview bundle, without production app/config/services.

Usage: python scripts/package-society-v8.py [output-directory]
Deploy the extracted ZIP contents to a NEW Netlify project, never the live site.
"""
from pathlib import Path
import sys
import zipfile

root = Path(__file__).resolve().parents[1]
destination = Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'work'
destination.mkdir(parents=True, exist_ok=True)
files = ['society-v8.html', 'society-v8.css', 'society-v8.js', 'society-v8-model.mjs']
landing = '''<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Society Mode v8 preview</title>
<link rel="stylesheet" href="app/society-v8.css"><main class="player">
<h1>I'm In Golf · Society Mode v8</h1><div class="card">
<p>Fictional demonstration. Changes stay in this browser only.</p>
<p><a href="app/society-v8.html">Open Society Admin demo</a></p>
<p><a href="app/society-v8.html?view=player">Open Player demo</a></p>
<p>Choose Alfie Noakes Society from the Admin example selector if desired.</p>
</div></main></html>'''
with zipfile.ZipFile(destination / 'society-v8-preview.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
    archive.writestr('index.html', landing)
    archive.writestr('_headers', '/*\n  X-Robots-Tag: noindex, nofollow\n  X-Content-Type-Options: nosniff\n')
    for name in files:
        archive.write(root / 'app' / name, 'app/' + name)
print(destination / 'society-v8-preview.zip')
