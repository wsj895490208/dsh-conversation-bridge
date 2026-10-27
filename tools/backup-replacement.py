"""Snapshot a selected previous project while Harness is fully exited."""
import argparse,hashlib,json,os,shutil,sqlite3,time
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('previous',type=Path);p.add_argument('--dsh-home',type=Path,default=Path(os.environ.get('DSH_HOME') or Path.home()/'.dsh'));p.add_argument('--profile',default='desktop');a=p.parse_args()
root=Path(__file__).resolve().parents[1];out=root/'backups'/f'{int(time.time()*1000)}-replacement-before';out.mkdir(parents=True,exist_ok=False)
previous=a.previous.resolve();session_ids=set();db=previous/'data/registry.sqlite'
if db.exists():
 with sqlite3.connect(db.as_uri()+'?mode=ro',uri=True) as con:
  for row in con.execute("SELECT body FROM records WHERE kind='run'"):
   session_ids.add(json.loads(row[0]).get('sessionId'))
def copy(src,dst):
 dst.parent.mkdir(parents=True,exist_ok=True)
 if src.suffix in ['.sqlite','.db']:
  with sqlite3.connect(src.as_uri()+'?mode=ro',uri=True) as source,sqlite3.connect(dst) as target:source.backup(target)
 else:shutil.copy2(src,dst)
for name in ['plugin','tools','docs','tests','data','imports','dist','README.md','.gitignore']:
 base=previous/name
 if not base.exists():continue
 for file in ([base] if base.is_file() else base.rglob('*')):
  if not file.is_file() or any(x in file.relative_to(previous).parts for x in ['node_modules','.tmp','npm-cache','__pycache__']) or file.name.endswith(('-wal','-shm')):continue
  copy(file,out/'previous-project'/file.relative_to(previous))
profile=a.dsh_home/'profiles'/a.profile
for name in ['cordis.yml','cordis.patch.yml','package.json','pnpm-lock.yaml','pnpm-workspace.yaml']:
 if (profile/name).exists():copy(profile/name,out/'profile'/name)
native=a.dsh_home/'sessions';native_files=[]
if native.exists():
 for file in native.rglob('*'):
  if file.is_file() and any(s and s in file.parts for s in session_ids):
   copy(file,out/'native-sessions'/file.relative_to(native));native_files.append({'path':str(file),'sha256':hashlib.sha256(file.read_bytes()).hexdigest()})
manifest={'previousProject':str(previous),'profile':a.profile,'credentialsIncluded':False,'nativeFiles':native_files,'files':[{'path':str(f.relative_to(out)),'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in out.rglob('*') if f.is_file()]}
(out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps({'backup':str(out),'files':len(manifest['files']),'nativeFiles':len(native_files)}))
