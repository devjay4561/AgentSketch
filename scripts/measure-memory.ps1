param([int]$ProcessId = 0, [int]$Seconds = 10, [string]$OutputPath = '')
$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $projectRoot
if ($Seconds -lt 1 -or $Seconds -gt 60) { throw 'Seconds는 1~60 범위로 지정하세요.' }
if ($ProcessId -eq 0) {
    $expected = Join-Path $projectRoot 'build\bin\AgentSketch.exe'
    $matches = @(Get-CimInstance Win32_Process -Filter "Name='AgentSketch.exe'" | Where-Object { $_.ExecutablePath -eq $expected })
    if ($matches.Count -ne 1) { throw '이 프로젝트의 AgentSketch 실행 인스턴스를 하나만 실행하거나 -ProcessId를 지정하세요.' }
    $ProcessId = [int]$matches[0].ProcessId
}
function Read-Tree {
    $all = @(Get-CimInstance Win32_Process)
    $ids = [System.Collections.Generic.HashSet[int]]::new()
    [void]$ids.Add($ProcessId)
    $changed = $true
    while ($changed) {
        $changed = $false
        foreach ($processInfo in $all) {
            if ($ids.Contains([int]$processInfo.ParentProcessId) -and -not $ids.Contains([int]$processInfo.ProcessId)) {
                [void]$ids.Add([int]$processInfo.ProcessId)
                $changed = $true
            }
        }
    }
    @($all | Where-Object { $ids.Contains([int]$_.ProcessId) } | ForEach-Object {
        $p = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
        if ($p) { [pscustomobject]@{ Id = $p.Id; Name = $p.ProcessName; WorkingSetMB = [math]::Round($p.WorkingSet64 / 1MB, 2); PrivateMB = [math]::Round($p.PrivateMemorySize64 / 1MB, 2); CpuSeconds = $p.TotalProcessorTime.TotalSeconds } }
    })
}
$first = @(Read-Tree)
$intervalWatch = [System.Diagnostics.Stopwatch]::StartNew()
Start-Sleep -Seconds $Seconds
$last = @(Read-Tree)
$actualSeconds = $intervalWatch.Elapsed.TotalSeconds
$idFilter = ($last | ForEach-Object { "IDProcess=$($_.Id)" }) -join ' OR '
$privateWorkingSet = @{}
if ($idFilter) {
    Get-CimInstance Win32_PerfRawData_PerfProc_Process -Filter $idFilter | ForEach-Object { $privateWorkingSet[[int]$_.IDProcess] = [math]::Round($_.WorkingSetPrivate / 1MB, 2) }
}
foreach ($p in $last) { $p | Add-Member -NotePropertyName PrivateWorkingSetMB -NotePropertyValue $privateWorkingSet[$p.Id] }
$cpuDelta = 0.0
foreach ($p in $last) {
    $old = $first | Where-Object { $_.Id -eq $p.Id } | Select-Object -First 1
    if ($old) { $cpuDelta += [math]::Max(0, $p.CpuSeconds - $old.CpuSeconds) }
}
$result = [pscustomobject]@{
    MeasuredAt = (Get-Date).ToString('o')
    RootProcessId = $ProcessId
    IntervalSeconds = $Seconds
    ActualIntervalSeconds = [math]::Round($actualSeconds, 3)
    Processes = $last
    TotalWorkingSetMB = [math]::Round(($last | Measure-Object WorkingSetMB -Sum).Sum, 2)
    TotalPrivateMB = [math]::Round(($last | Measure-Object PrivateMB -Sum).Sum, 2)
    TotalPrivateWorkingSetMB = [math]::Round(($last | Measure-Object PrivateWorkingSetMB -Sum).Sum, 2)
    CpuCorePercent = [math]::Round($cpuDelta / $actualSeconds * 100, 2)
    Note = '현재 보드와 WebView2 자식 프로세스 합계입니다. PrivateWorkingSet은 프로세스 전용 상주 RAM이며 공유 페이지를 제외합니다. WorkingSet 합계는 공유 메모리를 중복 계산할 수 있고 PrivateMB는 비상주 부분도 포함한 전용 커밋입니다. CpuCorePercent 100%는 논리 코어 하나입니다.'
}
$json = $result | ConvertTo-Json -Depth 5
if ($OutputPath) { [System.IO.File]::WriteAllText([System.IO.Path]::GetFullPath($OutputPath), $json, [System.Text.UTF8Encoding]::new($false)) }
$json
