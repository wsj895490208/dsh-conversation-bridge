param([string]$HarnessRoot=(Split-Path -Parent (Split-Path -Parent $PSScriptRoot)),[string]$NpmCli='')
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'Runtime.ps1')
$runtime=Resolve-BridgeRuntime -HarnessRoot $HarnessRoot -NpmCli $NpmCli -NeedNpm
$nodePath=$runtime.Node
$npmScript=$runtime.NpmCli
Push-Location (Join-Path $projectRoot 'plugin')
try {
  & $nodePath $npmScript ci --ignore-scripts --no-audit --no-fund --cache '..\data\npm-cache'
  if($LASTEXITCODE -ne 0){throw '依赖准备失败'}
} finally {Pop-Location}
& $nodePath (Join-Path $PSScriptRoot 'prepare-model.mjs')
if($LASTEXITCODE -ne 0){throw '本地模型准备失败'}
