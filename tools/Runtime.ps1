function Resolve-BridgeRuntime {
    param(
        [Parameter(Mandatory=$true)][string]$HarnessRoot,
        [string]$NpmCli='',
        [switch]$NeedPython,
        [switch]$NeedNpm
    )
    $resolvedRoot=(Resolve-Path -LiteralPath $HarnessRoot -ErrorAction Stop).Path
    $nodePath=Join-Path $resolvedRoot 'resources\runtime\primary-runtime\dependencies\node\bin\node.exe'
    if(-not(Test-Path -LiteralPath $nodePath)){
        throw 'Harness runtime not found. Pass -HarnessRoot with the supported Harness installation directory.'
    }
    $pythonPath=Join-Path $resolvedRoot 'resources\runtime\primary-runtime\dependencies\python\python.exe'
    if($NeedPython -and -not(Test-Path -LiteralPath $pythonPath)){throw 'Harness Python runtime not found.'}
    $npmScript=$null
    if($NeedNpm){
        if($NpmCli){
            $npmScript=(Resolve-Path -LiteralPath $NpmCli -ErrorAction Stop).Path
        }else{
            $candidates=@(Join-Path (Split-Path -Parent $nodePath) 'node_modules\npm\bin\npm-cli.js')
            foreach($command in @(Get-Command -Name @('npm.cmd','npm') -ErrorAction SilentlyContinue)){
                if($command.Source){$candidates+=Join-Path (Split-Path -Parent $command.Source) 'node_modules\npm\bin\npm-cli.js'}
            }
            if($env:ProgramFiles){$candidates+=Join-Path $env:ProgramFiles 'nodejs\node_modules\npm\bin\npm-cli.js'}
            $npmScript=$candidates | Select-Object -Unique | Where-Object {Test-Path -LiteralPath $_ -PathType Leaf} | Select-Object -First 1
        }
        if(-not$npmScript){throw 'npm-cli.js not found. Install Node.js/npm or pass -NpmCli with its full path.'}
    }
    [pscustomobject]@{Node=$nodePath;Python=$pythonPath;NpmCli=$npmScript;HarnessRoot=$resolvedRoot}
}
