"""Developer-only: freeze and stage the publisher's Apache-2.0 ONNX model."""
import hashlib
import json
import urllib.request
from pathlib import Path

root = Path(__file__).resolve().parents[1]
model = 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2'
revision = 'e8f8c211226b894fcb81acc59f3b34ba3efd5f42'
base = 'https://huggingface.co/' + model
selection = {
    'config.json': 'config.json',
    'tokenizer.json': 'tokenizer.json',
    'tokenizer_config.json': 'tokenizer_config.json',
    'special_tokens_map.json': 'special_tokens_map.json',
    'onnx/model_quantized.onnx': 'onnx/model_quint8_avx2.onnx',
}

def read_json(url):
    with urllib.request.urlopen(url, timeout=45) as response:
        return json.load(response)

metadata = read_json('https://huggingface.co/api/models/' + model + '/revision/' + revision)
if metadata.get('sha') != revision or metadata.get('cardData', {}).get('license') != 'apache-2.0':
    raise SystemExit('Publisher revision/license differs from the frozen source')
files = {}
for directory in ['', '/onnx']:
    for entry in read_json('https://huggingface.co/api/models/' + model + '/tree/' + revision + directory):
        if entry['type'] == 'file':
            files[entry['path']] = entry

folder = root / 'plugin/models/multilingual-minilm'
folder.mkdir(parents=True, exist_ok=True)
pin = {'id': model, 'revision': revision, 'license': 'Apache-2.0', 'files': {}}
for local, source in selection.items():
    entry = files[source]
    expected = entry.get('lfs', {}).get('oid')
    target = folder / local
    target.parent.mkdir(parents=True, exist_ok=True)
    valid = target.is_file() and target.stat().st_size == entry['size']
    if valid:
        with target.open('rb') as existing:
            actual = hashlib.file_digest(existing, 'sha256').hexdigest()
        if expected:
            valid = actual == expected
        else:
            valid = hashlib.sha1(b'blob ' + str(entry['size']).encode() + b'\0' + target.read_bytes()).hexdigest() == entry['oid']
    if not valid:
        temporary = target.with_name(target.name + '.part')
        digest = hashlib.sha256()
        received = 0
        try:
            with urllib.request.urlopen(base + '/resolve/' + revision + '/' + source, timeout=60) as response, temporary.open('wb') as output:
                while chunk := response.read(1024 * 1024):
                    output.write(chunk)
                    digest.update(chunk)
                    received += len(chunk)
                    if received % (8 * 1024 * 1024) == 0:
                        print(json.dumps({'file': source, 'bytes': received, 'total': entry['size']}), flush=True)
            actual = digest.hexdigest()
            if received != entry['size'] or expected and actual != expected:
                raise ValueError('Publisher file integrity mismatch: ' + source)
            if not expected:
                git_blob = hashlib.sha1(b'blob ' + str(received).encode() + b'\0' + temporary.read_bytes()).hexdigest()
                if git_blob != entry['oid']:
                    raise ValueError('Publisher Git object mismatch: ' + source)
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
    pin['files'][local] = {'bytes': entry['size'], 'sha256': actual, 'source': source}
    print(json.dumps({'verified': local, 'bytes': entry['size']}), flush=True)

notices = root / 'plugin/notices/model'
notices.mkdir(parents=True, exist_ok=True)
with urllib.request.urlopen(base + '/resolve/' + revision + '/README.md', timeout=30) as response:
    card = response.read()
(notices / 'MODEL-CARD.md').write_bytes(card)
with urllib.request.urlopen('https://www.apache.org/licenses/LICENSE-2.0.txt', timeout=30) as response:
    license_text = response.read()
(notices / 'LICENSE-APACHE-2.0.txt').write_bytes(license_text)
provenance = {'publisher': model, 'revision': revision, 'license': 'Apache-2.0', 'modelCard': base + '/blob/' + revision + '/README.md', 'modelCardSha256': hashlib.sha256(card).hexdigest(), 'modification': 'ONNX file renamed to model_quantized.onnx for the local loader; file bytes unchanged.', 'files': pin['files']}
(notices / 'SOURCE.json').write_text(json.dumps(provenance, indent=2) + '\n', encoding='utf-8')
(root / 'plugin/locks/model.json').write_text(json.dumps(pin, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'model': model, 'revision': revision, 'license': 'Apache-2.0', 'bytes': sum(item['bytes'] for item in pin['files'].values())}), flush=True)
