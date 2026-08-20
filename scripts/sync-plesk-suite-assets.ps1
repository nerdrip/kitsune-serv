[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$projects = Split-Path -Parent $workspace
$androidNerd = Join-Path (Split-Path -Parent $projects) 'Android\Nerd'
$sourceCss = Join-Path $workspace 'plesk-extension\kitsuneserv-bridge\htdocs\css\kitsune-platform.css'
$sourceJs = Join-Path $workspace 'plesk-extension\kitsuneserv-bridge\htdocs\js\kitsune-platform.js'
$targets = @(
    @{ Path = Join-Path $projects 'kitsune-irc\tools\plesk-extension\kitsuneirc-manager'; Label = 'kitsune-irc\tools\plesk-extension\kitsuneirc-manager' },
    @{ Path = Join-Path $projects 'KitsuneArtifactory\tools\plesk-extension\kitsuneartifactory-manager'; Label = 'KitsuneArtifactory\tools\plesk-extension\kitsuneartifactory-manager' },
    @{ Path = Join-Path $projects 'KitsuneColab\tools\plesk-extension\kitsunecolab-manager'; Label = 'KitsuneColab\tools\plesk-extension\kitsunecolab-manager' },
    @{ Path = Join-Path $projects 'KitsunePaint\tools\plesk-extension\kitsunepaint-manager'; Label = 'KitsunePaint\tools\plesk-extension\kitsunepaint-manager' },
    @{ Path = Join-Path $projects 'KitsunePNC\tools\plesk-extension\kitsunepnc-manager'; Label = 'KitsunePNC\tools\plesk-extension\kitsunepnc-manager' },
    @{ Path = Join-Path $projects 'KitsuneTab\tools\plesk-extension\kitsunetab-manager'; Label = 'KitsuneTab\tools\plesk-extension\kitsunetab-manager' },
    @{ Path = Join-Path $projects 'KitsuneTest\tools\plesk-extension\kitsunetest-manager'; Label = 'KitsuneTest\tools\plesk-extension\kitsunetest-manager' },
    @{ Path = Join-Path $projects 'NailIT\tools\plesk-extension\nailit-manager'; Label = 'NailIT\tools\plesk-extension\nailit-manager' },
    @{ Path = Join-Path $projects 'kitsune-git\deploy\plesk'; Label = 'kitsune-git\deploy\plesk' },
    @{ Path = Join-Path $androidNerd 'wpkit\tools\plesk-extension\wpkit-parse-manager'; Label = 'Android\Nerd\wpkit\tools\plesk-extension\wpkit-parse-manager' },
    @{ Path = Join-Path $androidNerd 'dicex\tools\plesk-extension\nerd-apps-runtime-manager'; Label = 'Android\Nerd\dicex\tools\plesk-extension\nerd-apps-runtime-manager' }
)

foreach ($source in @($sourceCss, $sourceJs)) {
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Missing canonical suite asset: $source" }
}

foreach ($target in $targets) {
    $extension = $target.Path
    if (-not (Test-Path -LiteralPath (Join-Path $extension 'meta.xml') -PathType Leaf)) { throw "Missing extension target: $extension" }
    $cssDirectory = Join-Path $extension 'htdocs\css'
    $jsDirectory = Join-Path $extension 'htdocs\js'
    New-Item -ItemType Directory -Path $cssDirectory,$jsDirectory -Force | Out-Null
    Copy-Item -LiteralPath $sourceCss -Destination (Join-Path $cssDirectory 'kitsune-platform.css') -Force
    Copy-Item -LiteralPath $sourceJs -Destination (Join-Path $jsDirectory 'kitsune-platform.js') -Force
    Write-Output "Synchronized suite assets: $($target.Label)"
}

$template = Join-Path $workspace 'plesk-extension\template'
$templateCss = Join-Path $template 'htdocs\css'
$templateJs = Join-Path $template 'htdocs\js'
New-Item -ItemType Directory -Path $templateCss,$templateJs -Force | Out-Null
Copy-Item -LiteralPath $sourceCss -Destination (Join-Path $templateCss 'kitsune-platform.css') -Force
Copy-Item -LiteralPath $sourceJs -Destination (Join-Path $templateJs 'kitsune-platform.js') -Force
Write-Output 'Synchronized suite assets: plesk-extension\template'
