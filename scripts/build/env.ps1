# Dot-source this file: . .\scripts\build\env.ps1
$kvaRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$kvaJdk = Get-ChildItem -LiteralPath (Join-Path $kvaRoot '.tools/jdk') -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin/java.exe') } |
    Sort-Object Name -Descending | Select-Object -First 1
if ($kvaJdk) {
    $env:JAVA_HOME = $kvaJdk.FullName
}
$kvaSdk = Join-Path $kvaRoot '.tools/sdk'
if (Test-Path -LiteralPath $kvaSdk) {
    $env:ANDROID_HOME = $kvaSdk
    $env:ANDROID_SDK_ROOT = $kvaSdk
    $kvaProperties = 'sdk.dir=' + $kvaSdk.Replace('\', '/').Replace(':', '\:') + "`n"
    [IO.File]::WriteAllText((Join-Path $kvaRoot 'mobile/android/local.properties'), $kvaProperties, [Text.UTF8Encoding]::new($false))
}
$kvaRuntime = Join-Path $kvaRoot '.local/native-runtime.json'
if (Test-Path -LiteralPath $kvaRuntime) {
    $env:KVA_NATIVE_RUNTIME_CONFIG = $kvaRuntime
}
Write-Host "Build environment: $kvaRoot"
