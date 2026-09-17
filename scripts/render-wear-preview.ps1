param(
    [string]$OutputPath = (
        Join-Path $PSScriptRoot '..\wear\watchface-meridian\src\main\res\drawable-nodpi\meridian_picker_preview.png'
    ),
    [string]$TileOutputPath = (
        Join-Path $PSScriptRoot '..\wear\companion\src\main\res\drawable-nodpi\t1arc_tile_preview.png'
    )
)

Add-Type -AssemblyName System.Drawing

function New-RoundedRectanglePath {
    param(
        [System.Drawing.RectangleF]$Bounds,
        [float]$Radius
    )

    $diameter = $Radius * 2
    $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $path.AddArc($Bounds.Left, $Bounds.Top, $diameter, $diameter, 180, 90)
    $path.AddArc($Bounds.Right - $diameter, $Bounds.Top, $diameter, $diameter, 270, 90)
    $path.AddArc(
        $Bounds.Right - $diameter,
        $Bounds.Bottom - $diameter,
        $diameter,
        $diameter,
        0,
        90
    )
    $path.AddArc($Bounds.Left, $Bounds.Bottom - $diameter, $diameter, $diameter, 90, 90)
    $path.CloseFigure()
    return $path
}

function Draw-CentredText {
    param(
        [System.Drawing.Graphics]$Graphics,
        [string]$Text,
        [System.Drawing.Font]$Font,
        [System.Drawing.Brush]$Brush,
        [System.Drawing.RectangleF]$Bounds
    )

    $format = [System.Drawing.StringFormat]::new()
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    $Graphics.DrawString($Text, $Font, $Brush, $Bounds, $format)
    $format.Dispose()
}

$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
$outputDirectory = Split-Path -Parent $resolvedOutput
[System.IO.Directory]::CreateDirectory($outputDirectory) | Out-Null
$resolvedTileOutput = [System.IO.Path]::GetFullPath($TileOutputPath)
$tileOutputDirectory = Split-Path -Parent $resolvedTileOutput
[System.IO.Directory]::CreateDirectory($tileOutputDirectory) | Out-Null

$bitmap = [System.Drawing.Bitmap]::new(450, 450)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$graphics.Clear([System.Drawing.Color]::Black)

$white = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 255, 255))
$cyan = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(101, 210, 231))
$soft = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(169, 189, 194))
$muted = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(120, 148, 154))
$card = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(13, 32, 37))
$edgePen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(24, 53, 60), 2)
$accentPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(101, 210, 231), 5)
$cardPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(24, 53, 60), 2)
$accentPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$accentPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

$timeFont = [System.Drawing.Font]::new('Segoe UI', 58, [System.Drawing.FontStyle]::Regular)
$eyebrowFont = [System.Drawing.Font]::new('Segoe UI', 12, [System.Drawing.FontStyle]::Bold)
$valueFont = [System.Drawing.Font]::new('Segoe UI', 48, [System.Drawing.FontStyle]::Bold)
$unitFont = [System.Drawing.Font]::new('Segoe UI', 11, [System.Drawing.FontStyle]::Regular)
$statusFont = [System.Drawing.Font]::new('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
$detailFont = [System.Drawing.Font]::new('Segoe UI', 12, [System.Drawing.FontStyle]::Regular)
$tileTitleFont = [System.Drawing.Font]::new('Segoe UI', 19, [System.Drawing.FontStyle]::Bold)
$tileValueFont = [System.Drawing.Font]::new('Segoe UI', 59, [System.Drawing.FontStyle]::Regular)
$tileUnitFont = [System.Drawing.Font]::new('Segoe UI', 19, [System.Drawing.FontStyle]::Regular)
$tileStatusFont = [System.Drawing.Font]::new('Segoe UI', 15, [System.Drawing.FontStyle]::Bold)

try {
    $graphics.DrawArc($edgePen, [System.Drawing.RectangleF]::new(28, 28, 394, 394), 208, 124)
    $graphics.DrawArc($accentPen, [System.Drawing.RectangleF]::new(28, 28, 394, 394), 208, 42)

    Draw-CentredText $graphics '10:08' $timeFont $white (
        [System.Drawing.RectangleF]::new(0, 34, 450, 100)
    )

    $cardBounds = [System.Drawing.RectangleF]::new(55, 147, 340, 170)
    $cardPath = New-RoundedRectanglePath $cardBounds 28
    $graphics.FillPath($card, $cardPath)
    $graphics.DrawPath($cardPen, $cardPath)
    $cardPath.Dispose()

    Draw-CentredText $graphics 'GLUCOSE' $eyebrowFont $muted (
        [System.Drawing.RectangleF]::new(55, 160, 340, 26)
    )
    Draw-CentredText $graphics ('6.8 ' + [char]0x2192) $valueFont $cyan (
        [System.Drawing.RectangleF]::new(55, 183, 340, 82)
    )
    Draw-CentredText $graphics 'mmol/L' $unitFont $soft (
        [System.Drawing.RectangleF]::new(55, 257, 340, 24)
    )
    Draw-CentredText $graphics 'CURRENT' $statusFont $white (
        [System.Drawing.RectangleF]::new(55, 281, 340, 22)
    )

    Draw-CentredText $graphics 'SUN 26' $detailFont $soft (
        [System.Drawing.RectangleF]::new(72, 338, 145, 52)
    )
    Draw-CentredText $graphics '82%' $detailFont $soft (
        [System.Drawing.RectangleF]::new(233, 338, 145, 52)
    )

    $bitmap.Save($resolvedOutput, [System.Drawing.Imaging.ImageFormat]::Png)

    $tileBitmap = [System.Drawing.Bitmap]::new(400, 400)
    $tileGraphics = [System.Drawing.Graphics]::FromImage($tileBitmap)
    try {
        $tileGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $tileGraphics.TextRenderingHint =
            [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
        $tileGraphics.Clear([System.Drawing.Color]::Black)

        Draw-CentredText $tileGraphics 'GLUCOSE' $tileTitleFont $soft (
            [System.Drawing.RectangleF]::new(20, 52, 360, 45)
        )
        Draw-CentredText $tileGraphics ('6.8 ' + [char]0x2192) $tileValueFont $cyan (
            [System.Drawing.RectangleF]::new(20, 105, 360, 105)
        )
        Draw-CentredText $tileGraphics 'mmol/L' $tileUnitFont $soft (
            [System.Drawing.RectangleF]::new(20, 208, 360, 40)
        )
        Draw-CentredText $tileGraphics 'CURRENT NOW' $tileStatusFont $white (
            [System.Drawing.RectangleF]::new(20, 312, 360, 42)
        )
        $tileBitmap.Save($resolvedTileOutput, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $tileGraphics.Dispose()
        $tileBitmap.Dispose()
    }
}
finally {
    $graphics.Dispose()
    $bitmap.Dispose()
    @(
        $white,
        $cyan,
        $soft,
        $muted,
        $card,
        $edgePen,
        $accentPen,
        $cardPen,
        $timeFont,
        $eyebrowFont,
        $valueFont,
        $unitFont,
        $statusFont,
        $detailFont,
        $tileTitleFont,
        $tileValueFont,
        $tileUnitFont,
        $tileStatusFont
    ) | ForEach-Object { $_.Dispose() }
}

Write-Output $resolvedOutput
Write-Output $resolvedTileOutput
