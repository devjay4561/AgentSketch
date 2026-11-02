$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Add-Type -AssemblyName System.Drawing
$bitmap = [System.Drawing.Bitmap]::new(256, 256)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $scale = 256.0 / 34.0
    $graphics.ScaleTransform($scale, $scale)
    $tile = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $tile.AddArc(0, 0, 20, 20, 180, 90)
    $tile.AddArc(14, 0, 20, 20, 270, 90)
    $tile.AddArc(14, 14, 20, 20, 0, 90)
    $tile.AddArc(0, 14, 20, 20, 90, 90)
    $tile.CloseFigure()
    $accent = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#f76b15'))
    $graphics.FillPath($accent, $tile)
    $points = [System.Drawing.PointF[]]@(
        [System.Drawing.PointF]::new(10,9), [System.Drawing.PointF]::new(24,9),
        [System.Drawing.PointF]::new(24,14), [System.Drawing.PointF]::new(15,14),
        [System.Drawing.PointF]::new(15,18), [System.Drawing.PointF]::new(22,18),
        [System.Drawing.PointF]::new(22,23), [System.Drawing.PointF]::new(15,23),
        [System.Drawing.PointF]::new(15,27), [System.Drawing.PointF]::new(10,27)
    )
    $graphics.FillPolygon([System.Drawing.Brushes]::White, $points)
    $line = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#1c2024'), 3)
    $line.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $line.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $graphics.DrawLine($line, 23,23,27,27)
    $destination = Join-Path $projectRoot 'build\appicon.png'
    New-Item -ItemType Directory -Path (Split-Path $destination) -Force | Out-Null
    $bitmap.Save($destination, [System.Drawing.Imaging.ImageFormat]::Png)
    $png = [System.IO.File]::ReadAllBytes($destination)
    $iconPath = Join-Path $projectRoot 'build\windows\icon.ico'
    New-Item -ItemType Directory -Path (Split-Path $iconPath) -Force | Out-Null
    $stream = [System.IO.File]::Create($iconPath)
    $writer = [System.IO.BinaryWriter]::new($stream)
    try {
        $writer.Write([uint16]0)
        $writer.Write([uint16]1)
        $writer.Write([uint16]1)
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([uint16]1)
        $writer.Write([uint16]32)
        $writer.Write([uint32]$png.Length)
        $writer.Write([uint32]22)
        $writer.Write($png)
    } finally { $writer.Dispose(); $stream.Dispose() }
    $line.Dispose()
    $accent.Dispose()
    $tile.Dispose()
} finally {
    $graphics.Dispose()
    $bitmap.Dispose()
}
