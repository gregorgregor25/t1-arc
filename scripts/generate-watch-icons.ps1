Add-Type -AssemblyName System.Drawing

$outputDirectory = Join-Path $PSScriptRoot '..\wear\watchface-orbit\src\main\res\drawable-nodpi'
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

$cyan = [System.Drawing.Color]::FromArgb(255, 89, 215, 230)

function New-IconCanvas {
    $bitmap = New-Object System.Drawing.Bitmap 96, 96
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    return @($bitmap, $graphics)
}

function Save-Icon {
    param(
        [System.Drawing.Bitmap]$Bitmap,
        [System.Drawing.Graphics]$Graphics,
        [string]$Name
    )

    $Graphics.Dispose()
    $path = Join-Path $outputDirectory $Name
    $Bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $Bitmap.Dispose()
}

$calendarCanvas = New-IconCanvas
$calendarBitmap = $calendarCanvas[0]
$calendarGraphics = $calendarCanvas[1]
$calendarPen = New-Object System.Drawing.Pen $cyan, 7
$calendarPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$calendarPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$calendarGraphics.DrawRectangle($calendarPen, 19, 24, 58, 57)
$calendarGraphics.DrawLine($calendarPen, 19, 42, 77, 42)
$calendarGraphics.DrawLine($calendarPen, 32, 14, 32, 31)
$calendarGraphics.DrawLine($calendarPen, 64, 14, 64, 31)
$calendarBrush = New-Object System.Drawing.SolidBrush $cyan
foreach ($x in @(31, 48, 65)) {
    foreach ($y in @(55, 69)) {
        $calendarGraphics.FillEllipse($calendarBrush, $x - 3, $y - 3, 6, 6)
    }
}
$calendarPen.Dispose()
$calendarBrush.Dispose()
Save-Icon $calendarBitmap $calendarGraphics 'orbit_calendar_icon.png'

$stepCanvas = New-IconCanvas
$stepBitmap = $stepCanvas[0]
$stepGraphics = $stepCanvas[1]
$stepPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$stepPath.StartFigure()
$stepPath.AddBezier(15, 24, 23, 35, 27, 45, 39, 51)
$stepPath.AddBezier(50, 57, 66, 53, 80, 67, 84, 76)
$stepPath.AddBezier(87, 83, 83, 88, 75, 89, 50, 91)
$stepPath.AddBezier(35, 92, 25, 87, 18, 77, 10, 65)
$stepPath.AddBezier(6, 59, 7, 51, 10, 44, 15, 24)
$stepPath.CloseFigure()
$stepBrush = New-Object System.Drawing.SolidBrush $cyan
$stepGraphics.FillPath($stepBrush, $stepPath)
$solePen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 5, 25, 28)), 6
$solePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$solePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$stepGraphics.DrawLine($solePen, 23, 73, 72, 78)
$stepPath.Dispose()
$stepBrush.Dispose()
$solePen.Dispose()
Save-Icon $stepBitmap $stepGraphics 'orbit_step_icon.png'

$batteryCanvas = New-IconCanvas
$batteryBitmap = $batteryCanvas[0]
$batteryGraphics = $batteryCanvas[1]
$batteryPen = New-Object System.Drawing.Pen $cyan, 7
$batteryPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$batteryPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$batteryGraphics.DrawRectangle($batteryPen, 25, 22, 46, 63)
$batteryGraphics.DrawLine($batteryPen, 38, 12, 58, 12)
$batteryGraphics.DrawLine($batteryPen, 38, 12, 38, 22)
$batteryGraphics.DrawLine($batteryPen, 58, 12, 58, 22)
$batteryGraphics.DrawLine($batteryPen, 35, 72, 61, 72)
$batteryPen.Dispose()
Save-Icon $batteryBitmap $batteryGraphics 'orbit_battery_icon.png'
