"""Extract the checked package under an ignored test directory, then run offline admission."""
import argparse
import subprocess
import tarfile
import tempfile
from pathlib import Path

parser=argparse.ArgumentParser();parser.add_argument('bundle',type=Path);parser.add_argument('--node',required=True,type=Path);args=parser.parse_args()
root=Path(__file__).resolve().parents[1]
parent=root/'plugin/.tmp';parent.mkdir(parents=True,exist_ok=True)
destination=Path(tempfile.mkdtemp(prefix='release-',dir=parent)).resolve()
with tarfile.open(args.bundle,'r:gz') as archive:
    for member in archive.getmembers():
        final=(destination/member.name).resolve()
        if not final.is_relative_to(destination) or not member.name.startswith('package/'):
            raise SystemExit('Unsafe package member')
    archive.extractall(destination,filter='data')
result=subprocess.run([str(args.node),str(root/'tools/check-offline.mjs'),str(destination/'package')],cwd=root)
raise SystemExit(result.returncode)
