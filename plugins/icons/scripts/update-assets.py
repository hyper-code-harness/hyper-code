#!/usr/bin/env python3
"""Refresh pinned Lucide SVGs and tags. Run from any directory; requires Python 3."""
import base64
import hashlib
import io
import json
import pathlib
import re
import shutil
import tarfile
import tempfile
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'assets'
source = json.loads((ASSETS / 'source.json').read_text())
version = source['version']
if not re.fullmatch(r'\d+\.\d+\.\d+', version):
    raise ValueError('Expected a pinned stable version in assets/source.json')
with urllib.request.urlopen('https://registry.npmjs.org/lucide-static/' + version, timeout=60) as response:
    package = json.load(response)
url = 'https://registry.npmjs.org/lucide-static/-/lucide-static-' + version + '.tgz'
with urllib.request.urlopen(url, timeout=60) as response:
    archive = response.read()
integrity = 'sha512-' + base64.b64encode(hashlib.sha512(archive).digest()).decode()
expected = source.get('integrity', package['dist']['integrity'])
if integrity != expected or integrity != package['dist']['integrity']:
    raise ValueError('Archive integrity mismatch')
with tempfile.TemporaryDirectory(dir=ROOT) as temp:
    stage = pathlib.Path(temp)
    (stage / 'icons').mkdir()
    rows = []
    with tarfile.open(fileobj=io.BytesIO(archive), mode='r:gz') as tar:
        tags = json.load(tar.extractfile('package/tags.json'))
        for member in tar.getmembers():
            match = re.fullmatch(r'package/icons/([a-z0-9]+(?:-[a-z0-9]+)*)\.svg', member.name)
            if member.isfile() and match:
                name = match[1]
                (stage / 'icons' / (name + '.svg')).write_bytes(tar.extractfile(member).read())
                rows.append({'name': name, 'tags': tags.get(name, [])})
        (stage / 'LICENSE').write_bytes(tar.extractfile('package/LICENSE').read())
    if not rows:
        raise ValueError('Archive has no icons')
    (stage / 'catalog.json').write_text(json.dumps(sorted(rows, key=lambda r: r['name'])))
    (stage / 'source.json').write_text(json.dumps({'package': 'lucide-static', 'version': version, 'url': url, 'integrity': integrity}, indent=2) + '\n')
    # Replace generated files only; the browser page is hand-authored.
    shutil.rmtree(ASSETS / 'icons')
    shutil.move(str(stage / 'icons'), str(ASSETS / 'icons'))
    for name in ('LICENSE', 'catalog.json', 'source.json'):
        shutil.copyfile(stage / name, ASSETS / name)
print(f'Updated {len(rows)} Lucide {version} SVGs; SHA-512 verified')
