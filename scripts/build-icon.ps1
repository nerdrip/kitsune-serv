param(
  [string]$InputPng = (Join-Path $PSScriptRoot '..\assets\icon.png'),
  [string]$OutputIco = (Join-Path $PSScriptRoot '..\assets\icon.ico')
)

$ErrorActionPreference = 'Stop'
$ffmpeg = Get-Command ffmpeg -ErrorAction Stop
$sizes = @(16, 24, 32, 48, 64, 128, 256)
$generated = @()

try {
  foreach ($size in $sizes) {
    $pngPath = Join-Path ([System.IO.Path]::GetDirectoryName($OutputIco)) ".icon-$size.png"
    & $ffmpeg.Source -y -hide_banner -loglevel error -i $InputPng -vf "scale=$size`:$size`:flags=lanczos" -frames:v 1 $pngPath
    if ($LASTEXITCODE -ne 0) { throw "ffmpeg failed while creating the $size px icon" }
    $generated += $pngPath
  }

  $images = @($generated | ForEach-Object { ,([System.IO.File]::ReadAllBytes($_)) })
  $stream = [System.IO.File]::Open($OutputIco, [System.IO.FileMode]::Create)
  $writer = [System.IO.BinaryWriter]::new($stream)
  try {
    $writer.Write([UInt16]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]$images.Count)
    $offset = 6 + (16 * $images.Count)
    for ($index = 0; $index -lt $images.Count; $index++) {
      $size = $sizes[$index]
      $writer.Write([Byte]($(if ($size -eq 256) { 0 } else { $size })))
      $writer.Write([Byte]($(if ($size -eq 256) { 0 } else { $size })))
      $writer.Write([Byte]0)
      $writer.Write([Byte]0)
      $writer.Write([UInt16]1)
      $writer.Write([UInt16]32)
      $writer.Write([UInt32]$images[$index].Length)
      $writer.Write([UInt32]$offset)
      $offset += $images[$index].Length
    }
    foreach ($imageBytes in $images) { $writer.Write($imageBytes) }
  } finally {
    $writer.Dispose()
    $stream.Dispose()
  }

  Write-Output "Created $OutputIco with sizes: $($sizes -join ', ')"
} finally {
  foreach ($generatedPath in $generated) {
    if (Test-Path -LiteralPath $generatedPath) { Remove-Item -LiteralPath $generatedPath -Force }
  }
}
