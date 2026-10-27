param([string]$HarnessRoot=(Split-Path -Parent (Split-Path -Parent $PSScriptRoot)),[string]$NpmCli='')
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'Runtime.ps1')
$runtime=Resolve-BridgeRuntime -HarnessRoot $HarnessRoot -NpmCli $NpmCli -NeedPython -NeedNpm
$nodePath=$runtime.Node
$pythonPath=$runtime.Python
$npmScript=$runtime.NpmCli
Push-Location $projectRoot
try {
  & $pythonPath tools/collect-notices.py
  if($LASTEXITCODE -ne 0){throw 'Third-party notice collection failed'}
  & $nodePath --test 'tests/*.test.mjs'
  if($LASTEXITCODE -ne 0){throw '单元测试失败'}
  foreach($script in @('check-native.mjs','check-interaction.mjs','check-image.mjs','check-api.mjs')){
    & $pythonPath tools/run-native.py $script --harness $HarnessRoot
    if($LASTEXITCODE -ne 0){throw "原生验收失败：$script"}
  }
  Push-Location plugin
  try {
    & $nodePath $npmScript pack --ignore-scripts --pack-destination '..\dist' --cache '..\data\npm-cache'
    if($LASTEXITCODE -ne 0){throw '打包失败'}
  } finally {Pop-Location}
  & $pythonPath tools/verify-package.py 'dist/dsh-conversation-bridge-0.1.0.tgz'
  if($LASTEXITCODE -ne 0){throw '发布包检查失败'}
  & $pythonPath tools/source-package.py
  if($LASTEXITCODE -ne 0){throw '源码打包失败'}
} finally {Pop-Location}
