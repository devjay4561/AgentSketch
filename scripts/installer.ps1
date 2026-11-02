param([string]$SourceDirectory = '', [switch]$DownloadCompiler)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $projectRoot
$toolRoot = Join-Path $projectRoot '.tools'
$compiler = Join-Path $toolRoot 'nsis-3.11/makensis.exe'
if (-not (Test-Path -LiteralPath $compiler)) {
    $installed = Get-Command 'makensis.exe' -ErrorAction SilentlyContinue
    if ($installed) { $compiler = $installed.Source }
    elseif ($DownloadCompiler) {
        New-Item -ItemType Directory -Path $toolRoot -Force | Out-Null
        $archive = Join-Path $toolRoot 'nsis-3.11.zip'
        # Official NSIS distribution. Some mirrors return the download page first.
        Invoke-WebRequest -Uri 'https://downloads.sourceforge.net/project/nsis/NSIS%203/3.11/nsis-3.11.zip' -OutFile $archive
        $bytes = [IO.File]::ReadAllBytes($archive)
        if ($bytes.Length -lt 4 -or $bytes[0] -ne 80 -or $bytes[1] -ne 75) {
            $html = [Text.Encoding]::UTF8.GetString($bytes)
            $match = [regex]::Match($html, 'https://downloads\.sourceforge\.net/project/nsis/[^"<> ]+')
            if (-not $match.Success) { throw 'NSIS 공식 ZIP 링크를 찾지 못했습니다.' }
            $download = [Net.WebUtility]::HtmlDecode($match.Value)
            Invoke-WebRequest -Uri $download -OutFile $archive
        }
        $hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
        if ($hash -ne 'C7D27F780DDB6CFFB4730138CD1591E841F4B7EDB155856901CDF5F214394FA1') {
            throw 'NSIS ZIP SHA256이 고정된 공식 배포본과 다릅니다. 실행하지 않습니다.'
        }
        Expand-Archive -LiteralPath $archive -DestinationPath $toolRoot -Force
    } else {
        throw 'NSIS가 없습니다. ./scripts/installer.ps1 -DownloadCompiler로 공식 도구를 프로젝트 안에만 내려받을 수 있습니다.'
    }
}
if (-not $SourceDirectory) { $SourceDirectory = Join-Path $projectRoot 'release/AgentSketch' }
$source = (Resolve-Path -LiteralPath $SourceDirectory).Path
foreach ($file in @('AgentSketch.exe','사용안내.md','검증결과.md','업그레이드범위.md','THIRD-PARTY-NOTICES.txt')) {
    if (-not (Test-Path -LiteralPath (Join-Path $source $file))) { throw "설치 원본 누락: $file. 먼저 package.ps1을 실행하세요." }
}
$builtExecutable = Join-Path $projectRoot 'build/bin/AgentSketch.exe'
if ((Get-FileHash -LiteralPath $builtExecutable).Hash -ne (Get-FileHash -LiteralPath (Join-Path $source 'AgentSketch.exe')).Hash) {
    throw '빌드 실행 파일과 배포 실행 파일이 다릅니다. 최신 빌드를 package.ps1로 포장한 뒤 설치 파일을 만드세요.'
}
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw '설치 버전은 숫자 3자리 형식이어야 합니다.' }
$release = Join-Path $projectRoot 'release'
$output = Join-Path $projectRoot 'output'
New-Item -ItemType Directory -Path $release, $output, $toolRoot -Force | Out-Null
$rollback = Join-Path $toolRoot 'AgentSketch-Rollback.exe'
& $compiler '/INPUTCHARSET' 'UTF8' '/OUTPUTCHARSET' 'UTF8' '/V3' "/DOUTPUT=$rollback" (Join-Path $PSScriptRoot 'rollback.nsi')
if ($LASTEXITCODE -ne 0) { throw "Rollback compiler exited with $LASTEXITCODE" }
$installer = Join-Path $release 'AgentSketch-Setup.exe'
$aiSource = Join-Path $source 'AI'
$aiUninstall = Join-Path $toolRoot 'ai-uninstall.nsh'
$aiPrefix = [IO.Path]::GetFullPath($aiSource) + [IO.Path]::DirectorySeparatorChar
$aiLines = [System.Collections.Generic.List[string]]::new()
foreach ($entry in Get-ChildItem -LiteralPath $aiSource -Recurse -File) {
    if (-not $entry.FullName.StartsWith($aiPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'AI payload path escaped its directory' }
    $relative = $entry.FullName.Substring($aiPrefix.Length)
    if ($relative -match '["$\r\n]') { throw 'Unsupported installer payload filename' }
    $aiLines.Add('Delete "$INSTDIR\AI\' + $relative + '"')
}
foreach ($entry in Get-ChildItem -LiteralPath $aiSource -Recurse -Directory | Sort-Object { $_.FullName.Length } -Descending) {
    $relative = $entry.FullName.Substring($aiPrefix.Length)
    if ($relative -match '["$\r\n]') { throw 'Unsupported installer payload directory' }
    $aiLines.Add('RMDir "$INSTDIR\AI\' + $relative + '"')
}
$aiLines.Add('RMDir "$INSTDIR\AI"')
$aiLines | Set-Content -LiteralPath $aiUninstall -Encoding UTF8
& $compiler '/INPUTCHARSET' 'UTF8' '/OUTPUTCHARSET' 'UTF8' '/V4' "/DSOURCE=$source" "/DAI_UNINSTALL=$aiUninstall" "/DOUTPUT=$installer" "/DROLLBACK=$rollback" "/DVERSION=$version" "/DICON=$(Join-Path $projectRoot 'build/windows/icon.ico')" (Join-Path $PSScriptRoot 'installer.nsi') 2>&1 |
    Tee-Object -FilePath (Join-Path $output 'installer-build.log')
if ($LASTEXITCODE -ne 0) { throw "Installer compiler exited with $LASTEXITCODE" }
$manifest = [ordered]@{
    version = $version
    installer = $installer
    installerSHA256 = (Get-FileHash -LiteralPath $installer).Hash
    applicationSHA256 = (Get-FileHash -LiteralPath $builtExecutable).Hash
    installerBytes = (Get-Item -LiteralPath $installer).Length
    signed = (Get-AuthenticodeSignature -LiteralPath $installer).Status.ToString()
    scope = 'Current user; LOCALAPPDATA/Programs/AgentSketch; HKCU only'
    rollback = 'Optional previous executable only; user documents are not reverted'
    installedOnHost = $false
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $output 'installer-build.json') -Encoding UTF8
$guide = @'
AgentSketch 사용자별 설치

AgentSketch-Setup.exe를 실행하면 현재 사용자 계정에 설치합니다.
설치 위치: %LOCALAPPDATA%\Programs\AgentSketch
설치 전에 AgentSketch 작업을 저장하고 창을 닫으세요.

선택 항목:
- 시작 메뉴 바로가기
- .agentsketch 파일 열기 등록 (Windows 기존 기본앱 선택이 있으면 설정에서 변경 필요)
- 업데이트 전 실행 파일 1개 보관 (기본 해제)

이전 실행 파일을 보관했다면 시작 메뉴의 '이전 버전으로 되돌리기'로 전환합니다.
문서는 되돌리지 않습니다. 새 기능으로 저장한 문서를 예전 앱에서 다시 저장하지 마세요.
프로그램 제거는 설치 파일만 제거하며 %APPDATA%\AgentSketch와 사용자 문서는 보존합니다.
Windows WebView2 런타임이 필요합니다. 설치 프로그램은 런타임을 내려받지 않습니다.

코드 서명이 없는 배포본입니다. 자동 업데이트 서버는 설정되어 있지 않습니다.
빌드와 포함 파일 검사는 수행했지만 이 PC의 사용자 환경에 설치·제거 시험은 하지 않았습니다.
'@
$guide | Set-Content -LiteralPath (Join-Path $release 'AgentSketch-Setup-안내.txt') -Encoding UTF8
$manifest | ConvertTo-Json -Depth 5
