"""Create a source-only archive from an explicit public directory allowlist."""
import json,zipfile
from pathlib import Path
root=Path(__file__).resolve().parents[1];files=[]
for name in ['plugin','tools','tests','docs','.github','README.md','README.en.md','LICENSE','NOTICE','.gitignore','.gitattributes']:
 base=root/name
 for file in ([base] if base.is_file() else base.rglob('*')):
  if file.is_file() and not any(x in file.relative_to(root).parts for x in ['node_modules','.tmp','__pycache__']):files.append(file)
out=root/'dist/dsh-conversation-bridge-0.1.0-source.zip';out.parent.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
 for file in files:z.write(file,file.relative_to(root))
print(json.dumps({'sourceZip':out.name,'files':len(files),'runtimeDataIncluded':False}))
