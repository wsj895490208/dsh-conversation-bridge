"""Inspect public archives for accidental private paths, data and credentials."""
import argparse
import hashlib
import json
import re
import tarfile
import zipfile
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('archives', nargs='+', type=Path)
parser.add_argument('--deny-pattern', action='append', default=[], help='Additional local-only content checks; patterns are never saved.')
args = parser.parse_args()
private_parts = {'data', 'backups', 'imports', 'models', 'node_modules', '.tmp', '.git', '__pycache__'}
patterns = {
    'machine path': r'\b[A-Za-z]:[\\/]|/Users/[A-Za-z0-9._ -]+/|/home/[A-Za-z0-9._ -]+/',
    'GitHub credential': r'\b(?:ghp_|gho_|ghu_|ghs_|ghr_)[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{30,}',
    'API credential': r'\bsk-[A-Za-z0-9_-]{24,}',
    'private key': r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
    'assigned credential': r'''\b(?:api[_-]?key|access[_-]?token|password)\s*[=:]\s*["'][A-Za-z0-9._-]{24,}["']''',
}

def inspect(name, data):
    parts = Path(name).parts
    if any(part in private_parts or part == '..' for part in parts):
        raise ValueError('Private directory in archive: ' + name)
    if name.endswith(('.onnx', '.sqlite', '.db', '.exe', '.dll')):
        raise ValueError('Runtime/binary data in archive: ' + name)
    text = data.decode('utf-8')
    for label, pattern in patterns.items():
        if re.search(pattern, text):
            raise ValueError(label + ' in ' + name)
    for pattern in args.deny_pattern:
        if re.search(pattern, text):
            raise ValueError('Additional private content check in ' + name)

reports = []
for archive in args.archives:
    count = 0
    if archive.suffix == '.zip':
        with zipfile.ZipFile(archive) as opened:
            for item in opened.infolist():
                if not item.is_dir():
                    inspect(item.filename, opened.read(item))
                    count += 1
    else:
        with tarfile.open(archive, 'r:gz') as opened:
            for item in opened.getmembers():
                if item.isfile():
                    inspect(item.name, opened.extractfile(item).read())
                    count += 1
    reports.append({'archive': archive.name, 'files': count, 'sha256': hashlib.sha256(archive.read_bytes()).hexdigest()})
print(json.dumps({'privacyScan': 'passed', 'archives': reports}))
