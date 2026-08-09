Add-Type -AssemblyName System.Drawing

function New-MonochromeScoreboardIcon {
    param([int]$Size, [string]$OutputPath)

    $bitmap = New-Object System.Drawing.Bitmap($Size, $Size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([System.Drawing.Color]::Black)

    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, ($Size * 0.052))
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

    # Simple joystick on the left.
    $graphics.DrawEllipse($pen, $Size * 0.19, $Size * 0.22, $Size * 0.16, $Size * 0.16)
    $graphics.DrawLine($pen, $Size * 0.27, $Size * 0.38, $Size * 0.27, $Size * 0.66)
    $graphics.DrawLine($pen, $Size * 0.16, $Size * 0.72, $Size * 0.40, $Size * 0.72)

    # Simple microphone on the right.
    $micX = $Size * 0.57
    $micY = $Size * 0.24
    $micW = $Size * 0.18
    $micH = $Size * 0.31
    $graphics.DrawArc($pen, $micX, $micY, $micW, $micH, 180, 180)
    $graphics.DrawLine($pen, $micX, $micY + $micH / 2, $micX, $micY + $micH * 0.67)
    $graphics.DrawLine($pen, $micX + $micW, $micY + $micH / 2, $micX + $micW, $micY + $micH * 0.67)
    $graphics.DrawArc($pen, $Size * 0.51, $Size * 0.40, $Size * 0.30, $Size * 0.24, 0, 180)
    $graphics.DrawLine($pen, $Size * 0.66, $Size * 0.64, $Size * 0.66, $Size * 0.72)
    $graphics.DrawLine($pen, $Size * 0.57, $Size * 0.72, $Size * 0.75, $Size * 0.72)

    $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $pen.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
}

New-MonochromeScoreboardIcon -Size 192 -OutputPath (Join-Path $PSScriptRoot '..\public\pwa-192.png')
New-MonochromeScoreboardIcon -Size 512 -OutputPath (Join-Path $PSScriptRoot '..\public\pwa-512.png')
New-MonochromeScoreboardIcon -Size 180 -OutputPath (Join-Path $PSScriptRoot '..\public\apple-touch-icon.png')
