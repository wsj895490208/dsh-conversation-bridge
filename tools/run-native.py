"""Offline native checks; use an explicitly selected installed Electron runtime."""
import argparse,os,subprocess,sys
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('script');p.add_argument('--harness',type=Path,default=Path(__file__).resolve().parents[2]);a=p.parse_args()
root=Path(__file__).resolve().parents[1];script=(root/'tools'/a.script).resolve()
if script.parent!=root/'tools' or not script.name.startswith('check-'):raise SystemExit('Expected tools/check-*.mjs')
env=dict(os.environ,ELECTRON_RUN_AS_NODE='1',PYTHONIOENCODING='utf-8')
r=subprocess.run([str(a.harness/'DeepSeek Harness.exe'),'--expose-internals',str(script),str(a.harness)],env=env,capture_output=True,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
sys.stdout.buffer.write(r.stdout);sys.stderr.buffer.write(r.stderr);raise SystemExit(r.returncode)
