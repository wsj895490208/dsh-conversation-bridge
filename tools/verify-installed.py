import argparse,hashlib,json,os,tarfile
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--dsh-home',type=Path,default=Path(os.environ.get('DSH_HOME') or Path.home()/'.dsh'));p.add_argument('--profile',default='desktop');a=p.parse_args()
root=Path(__file__).resolve().parents[1];installed=a.dsh_home/'profiles'/a.profile/'node_modules/dsh-conversation-bridge';checked=0
with tarfile.open(root/'dist/dsh-conversation-bridge-0.1.0.tgz','r:gz') as tf:
 for member in tf.getmembers():
  if member.isfile():
   relative=member.name.removeprefix('package/');assert tf.extractfile(member).read()==(installed/relative).read_bytes(),relative;checked+=1
backup=sorted((root/'backups').glob('*-replacement-before'))[-1];manifest=json.loads((backup/'manifest.json').read_text(encoding='utf-8'));native_unchanged=0
for item in manifest['nativeFiles']:
 assert hashlib.sha256(Path(item['path']).read_bytes()).hexdigest()==item['sha256'],'Old native log changed';native_unchanged+=1
profile=json.loads((a.dsh_home/'profiles'/a.profile/'package.json').read_text(encoding='utf-8'))
report={'installedVersion':json.loads((installed/'package.json').read_text())['version'],'packageFilesVerified':checked,'nativeFilesUnchanged':native_unchanged,'backup':str(backup),'onlyGenericPlugin':list(profile['dependencies'])==['dsh-conversation-bridge'],'realModelCalls':0}
(root/'data/installation-validation.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps(report))
