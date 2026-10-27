"""Inspect the exact publish artifact, not a directory containing private data."""
import argparse,hashlib,json,re,tarfile
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('bundle',type=Path);a=p.parse_args();files=[]
forbidden=[r'\b[A-Za-z]:[\\/]',r'/Users/[A-Za-z0-9._ -]+/',r'/home/[A-Za-z0-9._ -]+/',r'\b(?:api[_-]?key|access[_-]?token)\s*[:=]\s*[\"\'][A-Za-z0-9_-]{20,}']
with tarfile.open(a.bundle,'r:gz') as tf:
 for m in tf.getmembers():
  if not m.isfile():continue
  name=m.name.removeprefix('package/');data=tf.extractfile(m).read()
  if name.startswith(('data/','imports/','backups/','models/','node_modules/')):raise ValueError('Private/runtime directory in package: '+name)
  text=data.decode('utf-8')
  for pattern in forbidden:
   if re.search(pattern,text):raise ValueError('Machine-specific path or credential in '+name)
  files.append({'path':name,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)})
root=Path(__file__).resolve().parents[1];out={'version':'0.1.0','package':a.bundle.name,'sha256':hashlib.sha256(a.bundle.read_bytes()).hexdigest(),'files':files,'privateDataIncluded':False,'machineSpecificPaths':False}
(root/'docs/release.json').write_text(json.dumps(out,indent=2)+'\n',encoding='utf-8');print(json.dumps({'package':out['package'],'sha256':out['sha256'],'files':len(files),'privacyScan':'passed'}))
