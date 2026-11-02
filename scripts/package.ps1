$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $projectRoot
& node (Join-Path $PSScriptRoot 'package.mjs')
if ($LASTEXITCODE -ne 0) { throw "Package preparation exited with $LASTEXITCODE" }

$releaseRoot = Join-Path $projectRoot 'release'
$stageRoot = Join-Path $releaseRoot ('.source-' + [guid]::NewGuid().ToString('N'))
$sourceRoot = Join-Path $stageRoot 'AgentSketch-source'
New-Item -ItemType Directory -Path $sourceRoot | Out-Null
try {
    foreach ($directory in @('src', 'public', 'third_party', 'scripts', 'docs', 'ai', 'skills', '.github')) {
        Copy-Item -LiteralPath (Join-Path $projectRoot $directory) -Destination $sourceRoot -Recurse
    }
    $rootFiles = @('go.mod', 'go.sum', 'wails.json', 'index.html', 'render.html', 'vite.config.ts', 'agentsketch', 'agentsketch.cmd', 'tsconfig.json', 'package.json', 'package-lock.json', 'README.md', 'README.en.md', 'LICENSE','AGENTS.md', 'PRODUCT.md', 'DESIGN.md', '.gitignore')
    foreach ($file in $rootFiles) {
        Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination $sourceRoot
    }
    Get-ChildItem -LiteralPath $projectRoot -Filter '*.go' -File | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $sourceRoot
    }
    $buildRoot = Join-Path $sourceRoot 'build'
    $playwrightRoot = Join-Path $sourceRoot '.playwright'
    New-Item -ItemType Directory -Path $buildRoot, $playwrightRoot | Out-Null
    Copy-Item -LiteralPath (Join-Path $projectRoot 'build\appicon.png') -Destination $buildRoot
    Copy-Item -LiteralPath (Join-Path $projectRoot 'build\windows') -Destination $buildRoot -Recurse
    Copy-Item -LiteralPath (Join-Path $projectRoot 'build\darwin') -Destination $buildRoot -Recurse
    Copy-Item -LiteralPath (Join-Path $projectRoot '.playwright\cli.config.json') -Destination $playwrightRoot

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $sourceZip = Join-Path $releaseRoot 'AgentSketch-source.zip'
    if (Test-Path -LiteralPath $sourceZip) { Remove-Item -LiteralPath $sourceZip }
    [System.IO.Compression.ZipFile]::CreateFromDirectory($stageRoot, $sourceZip)
    $archive = [System.IO.Compression.ZipFile]::OpenRead($sourceZip)
    try {
        $names = @($archive.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })
        foreach ($required in @('main.go', 'build/appicon.png', 'build/windows/icon.ico', 'build/darwin/Info.plist', 'scripts/build.sh', 'scripts/package-macos.sh', '.playwright/cli.config.json', 'third_party/go-webview2/go.mod')) {
            if ($names -notcontains "AgentSketch-source/$required") { throw "Source package missing: $required" }
        }
        if ($names -match '/(node_modules|output|\.tools|build/bin)/') { throw 'Source package contains generated artifacts' }
    } finally { $archive.Dispose() }

    Compress-Archive -LiteralPath (Join-Path $releaseRoot 'AgentSketch') -DestinationPath (Join-Path $releaseRoot 'AgentSketch-Windows.zip') -Force
    Get-Item -LiteralPath $sourceZip, (Join-Path $releaseRoot 'AgentSketch-Windows.zip') | Select-Object Name, Length
} finally {
    $resolvedStage = [System.IO.Path]::GetFullPath($stageRoot)
    $releasePrefix = [System.IO.Path]::GetFullPath($releaseRoot) + [System.IO.Path]::DirectorySeparatorChar
    if (-not $resolvedStage.StartsWith($releasePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'Temporary package directory is outside release'
    }
    Remove-Item -LiteralPath $resolvedStage -Recurse -Force
}
