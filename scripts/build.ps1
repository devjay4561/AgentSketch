param([switch]$SkipInstall, [switch]$SkipTests)
$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $projectRoot

function Invoke-Checked {
    param([string]$Executable, [string[]]$Arguments)
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Executable exited with $LASTEXITCODE" }
}

if (-not (Get-Command 'go' -ErrorAction SilentlyContinue)) { throw 'Go 1.26 이상을 설치하세요.' }
if (-not (Get-Command 'npm.cmd' -ErrorAction SilentlyContinue)) { throw 'Node.js 20.19+ 또는 22.12+를 설치하세요.' }
if (-not $SkipInstall) { Invoke-Checked 'npm.cmd' @('ci') }
Invoke-Checked 'npm.cmd' @('run', 'build')
if (-not $SkipTests) {
    Invoke-Checked 'npm.cmd' @('test')
    Invoke-Checked 'go' @('test', './...')
    Invoke-Checked 'go' @('test', 'github.com/wailsapp/go-webview2/pkg/edge', '-run', 'AgentSketch')
}
$toolDir = Join-Path $projectRoot '.tools\bin'
$wailsExe = Join-Path $toolDir 'wails.exe'
if (-not (Test-Path -LiteralPath $wailsExe)) {
    New-Item -ItemType Directory -Path $toolDir -Force | Out-Null
    $previousGoBin = $env:GOBIN
    try {
        $env:GOBIN = $toolDir
        Invoke-Checked 'go' @('install', 'github.com/wailsapp/wails/v2/cmd/wails@v2.17.0')
    } finally { $env:GOBIN = $previousGoBin }
}
Invoke-Checked $wailsExe @('build', '-platform', 'windows/amd64', '-s', '-skipbindings', '-webview2', 'error', '-trimpath')
Write-Host "실행 파일: $(Join-Path $projectRoot 'build\bin\AgentSketch.exe')"
