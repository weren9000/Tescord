param(
    [Parameter(Mandatory=$true)][string]$SdkRoot,
    [Parameter(Mandatory=$true)][string]$SigningDirectory
)
$ErrorActionPreference = 'Stop'
$key = Join-Path $SigningDirectory 'kvachat-android.p12'
$passwordFile = Join-Path $SigningDirectory 'password.txt'
if (!(Test-Path -LiteralPath $key) -or !(Test-Path -LiteralPath $passwordFile)) { throw 'Release signing key is missing. Do not generate a replacement for an existing app.' }
$unsigned = Join-Path $PSScriptRoot 'android/app/build/outputs/apk/release/app-release-unsigned.apk'
$release = Join-Path $PSScriptRoot 'release'
New-Item -ItemType Directory -Force -Path $release | Out-Null
$version = (Get-Content (Join-Path $PSScriptRoot 'package.json') -Raw | ConvertFrom-Json).version
$apk = Join-Path $release "KvaChat-$version-android.apk"
$env:KVA_ANDROID_KEY_PASSWORD = [IO.File]::ReadAllText($passwordFile).Trim()
try {
    & "$SdkRoot/build-tools/36.0.0/apksigner.bat" sign --ks $key --ks-key-alias kvachat --ks-pass env:KVA_ANDROID_KEY_PASSWORD --key-pass env:KVA_ANDROID_KEY_PASSWORD --out $apk $unsigned
    if ($LASTEXITCODE -ne 0) { throw 'APK signing failed' }
    & "$SdkRoot/build-tools/36.0.0/apksigner.bat" verify --verbose $apk
    if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed' }
    $hash = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText("$apk.sha256", "$hash  $([IO.Path]::GetFileName($apk))`n")
    Write-Output $apk
} finally { Remove-Item Env:KVA_ANDROID_KEY_PASSWORD -ErrorAction SilentlyContinue }
