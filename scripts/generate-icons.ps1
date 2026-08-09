Add-Type -AssemblyName System.Drawing

function New-ScoreboardIcon {
    param([int]$Size, [string]$OutputPath)

    $bitmap = New-Object System.Drawing.Bitmap($Size, $Size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#173f35'))

    $coral = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#d96c50'))
    $gold = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#e8a94a'))
    $creamPen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml('#fff8e9'), ($Size * 0.055))
    $creamPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $creamPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

    $graphics.FillEllipse($coral, $Size * 0.19, $Size * 0.19, $Size * 0.62, $Size * 0.62)
    $graphics.FillEllipse($gold, $Size * 0.66, $Size * 0.16, $Size * 0.16, $Size * 0.16)

    $micX = $Size * 0.41
    $micY = $Size * 0.31
    $micW = $Size * 0.18
    $micH = $Size * 0.30
    $graphics.DrawArc($creamPen, $micX, $micY, $micW, $micH, 180, 180)
    $graphics.DrawLine($creamPen, $micX, $micY + $micH / 2, $micX, $micY + $micH * 0.66)
    $graphics.DrawLine($creamPen, $micX + $micW, $micY + $micH / 2, $micX + $micW, $micY + $micH * 0.66)
    $graphics.DrawArc($creamPen, $Size * 0.34, $Size * 0.43, $Size * 0.32, $Size * 0.27, 0, 180)
    $graphics.DrawLine($creamPen, $Size * 0.50, $Size * 0.70, $Size * 0.50, $Size * 0.77)
    $graphics.DrawLine($creamPen, $Size * 0.40, $Size * 0.77, $Size * 0.60, $Size * 0.77)

    $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $creamPen.Dispose()
    $coral.Dispose()
    $gold.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
}

New-ScoreboardIcon -Size 192 -OutputPath (Join-Path $PSScriptRoot '..\public\pwa-192.png')
New-ScoreboardIcon -Size 512 -OutputPath (Join-Path $PSScriptRoot '..\public\pwa-512.png')
New-ScoreboardIcon -Size 180 -OutputPath (Join-Path $PSScriptRoot '..\public\apple-touch-icon.png')
