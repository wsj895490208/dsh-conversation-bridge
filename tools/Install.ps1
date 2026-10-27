param(
  [string]$HarnessRoot=(Split-Path -Parent (Split-Path -Parent $PSScriptRoot)),
  [string]$Profile='desktop',
  [string]$ReplacePackage='',
  [string]$PreviousProject='',
  [string]$DataDir=''
)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
if(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue){throw '请先正常退出 Harness，等待正在执行的任务完成。'}
$packageVersion=(Get-Content -LiteralPath (Join-Path $projectRoot 'plugin/package.json') -Raw | ConvertFrom-Json).version
$bundle=Join-Path $projectRoot ("dist\dsh-conversation-bridge-"+$packageVersion+".tgz")
if(-not(Test-Path -LiteralPath $bundle)){throw '请先构建插件。'}
$digest=(Get-FileHash -LiteralPath $bundle -Algorithm SHA256).Hash.ToLowerInvariant()
$installBundle=Join-Path $projectRoot ('dist\dsh-conversation-bridge-'+$packageVersion+'-'+$digest.Substring(0,12)+'.tgz')
if(-not(Test-Path -LiteralPath $installBundle)){Copy-Item -LiteralPath $bundle -Destination $installBundle}
$cliPath=Join-Path $HarnessRoot 'resources\runtime\cli\bin\dsh.cmd'
if($ReplacePackage){
  if(-not$PreviousProject){throw '替换旧插件需要提供 PreviousProject 以建立备份。'}
  $pythonPath=Join-Path $HarnessRoot 'resources\runtime\primary-runtime\dependencies\python\python.exe'
  & $pythonPath (Join-Path $PSScriptRoot 'backup-replacement.py') $PreviousProject --profile $Profile
  if($LASTEXITCODE -ne 0){throw '备份未完成，没有卸载旧插件。'}
}
# Stage the new dependency first. Existing sessions are not opened during replacement.
& $cliPath plugin --profile $Profile add $installBundle --ignore-scripts
if($LASTEXITCODE -ne 0){throw '新插件安装失败，旧插件尚未卸载。'}
if($ReplacePackage){
  & $cliPath plugin --profile $Profile remove $ReplacePackage --config.ignore-scripts=true
  if($LASTEXITCODE -ne 0){throw '旧插件尚未移除，请查看官方 CLI 输出；旧数据与备份保留。'}
}
if($DataDir){
  $nodePath=Join-Path $HarnessRoot 'resources\runtime\primary-runtime\dependencies\node\bin\node.exe'
  & $nodePath (Join-Path $PSScriptRoot 'configure-location.mjs') $DataDir $Profile
  if($LASTEXITCODE -ne 0){throw '插件启动目录设置未保存。宿主登记与会话数据未改写。'}
}
Write-Output '安装完成。启动 Harness 后点击“导入网页对话”。'
