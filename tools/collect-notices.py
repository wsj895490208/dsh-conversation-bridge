"""Preserve available installed dependency notices without bundling implementation."""
import json
import re
from pathlib import Path

root = Path(__file__).resolve().parents[1]
dependencies = json.loads((root / 'plugin/locks/runtime-dependencies.json').read_text(encoding='utf-8'))
destination = root / 'plugin/notices/dependencies'
destination.mkdir(parents=True, exist_ok=True)
records = []
for dependency in dependencies:
    package = root / 'plugin/node_modules' / dependency['name']
    metadata = package / 'package.json'
    record = {key: dependency[key] for key in ('name', 'version', 'license')}
    record.update(installedForBuild=metadata.is_file(), licenseFiles=[])
    if metadata.is_file():
        info = json.loads(metadata.read_text(encoding='utf-8'))
        record['repository'] = info.get('repository')
        for original in sorted(package.rglob('*')):
            relative = original.relative_to(package)
            if not original.is_file() or 'node_modules' in relative.parts:
                continue
            if not re.match(r'^(?:licen[cs]e|copying|notice|third[-_. ]?party[-_. ]?notices?)(?:$|\.)', original.name, re.I):
                continue
            filename = re.sub(r'[^A-Za-z0-9._-]', '_', dependency['name'] + '__' + relative.as_posix())
            target = destination / filename
            target.write_bytes(original.read_bytes())
            record['licenseFiles'].append(filename)
    records.append(record)

index = {
    'scope': 'Package-declared metadata and available installed notices; no binaries or model files included.',
    'absentTextMeaning': 'An empty licenseFiles list is not permission to omit upstream terms. Dependencies are installed separately; retain their notices when redistributing.',
    'dependencies': records,
}
(destination / 'index.json').write_text(json.dumps(index, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
print(json.dumps({'dependencyEntries': len(records), 'preservedTexts': sum(len(item['licenseFiles']) for item in records)}))
