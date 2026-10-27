"""Verify the exact package, allowing only hash-pinned public model assets."""
import argparse,hashlib,json,re,tarfile
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('bundle',type=Path);a=p.parse_args();files=[]
root=Path(__file__).resolve().parents[1]
pin=json.loads((root/'plugin/locks/model.json').read_text(encoding='utf-8'))
version=json.loads((root/'plugin/package.json').read_text(encoding='utf-8'))['version']
approved={'models/multilingual-minilm/'+name:spec for name,spec in pin['files'].items()};found=set()
forbidden=[r'\b[A-Za-z]:[\\/]',r'/Users/[A-Za-z0-9._ -]+/',r'/home/[A-Za-z0-9._ -]+/',r'\b(?:api[_-]?key|access[_-]?token)\s*[:=]\s*[\"\'][A-Za-z0-9_-]{20,}']
with tarfile.open(a.bundle,'r:gz') as tf:
 for m in tf.getmembers():
  if not m.isfile():continue
  name=m.name.removeprefix('package/')
  if name.startswith(('data/','imports/','backups/','node_modules/')):raise ValueError('Private/runtime directory in package: '+name)
  if name.startswith('models/'):
   expected=approved.get(name)
   if not expected:raise ValueError('Unapproved model asset: '+name)
   digest=hashlib.file_digest(tf.extractfile(m),'sha256').hexdigest()
   if m.size!=expected['bytes'] or digest!=expected['sha256']:raise ValueError('Bundled model hash mismatch: '+name)
   found.add(name)
  else:
   data=tf.extractfile(m).read();text=data.decode('utf-8');digest=hashlib.sha256(data).hexdigest()
   for pattern in forbidden:
    if re.search(pattern,text):raise ValueError('Machine-specific path or credential in '+name)
  files.append({'path':name,'sha256':digest,'bytes':m.size})
if found!=set(approved):raise ValueError('Bundled model is incomplete')
out={'version':version,'package':a.bundle.name,'sha256':hashlib.sha256(a.bundle.read_bytes()).hexdigest(),'files':files,'privateDataIncluded':False,'machineSpecificPaths':False,'modelWeightsIncluded':True,'bundledModel':{'id':pin['id'],'revision':pin['revision'],'license':pin['license'],'bytes':sum(f['bytes'] for f in pin['files'].values())}}
(root/'docs/release.json').write_text(json.dumps(out,indent=2)+'\n',encoding='utf-8');print(json.dumps({'package':out['package'],'sha256':out['sha256'],'files':len(files),'modelFiles':len(found),'privacyScan':'passed'}))
