param(
    [Parameter(Position = 0)]
    [string]$ServerHost,
    [Parameter(Position = 1)]
    [string]$ServerUser = 'root',
    [Parameter(Position = 2)]
    [Alias('Password')]
    [string]$ServerPasswordText,
    [SecureString]$ServerPassword,
    [string]$Domain,
    [string]$LetsEncryptEmail
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-PlainTextPassword {
    param([SecureString]$SecurePassword)

    if (-not $SecurePassword) {
        throw 'Пароль сервера не указан.'
    }

    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecurePassword)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

function Require-Command {
    param([string]$Name)

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $command) {
        throw "Не найдено: $Name"
    }

    return $command.Source
}

function New-RandomHex {
    param([int]$Bytes = 32)

    $buffer = [byte[]]::new($Bytes)
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($buffer)
    return ([Convert]::ToHexString($buffer)).ToLowerInvariant()
}

function Invoke-ExternalCommand {
    param(
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$WorkingDirectory
    )

    $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments -WorkingDirectory $WorkingDirectory -Wait -NoNewWindow -PassThru
    if ($process.ExitCode -ne 0) {
        throw "Команда завершилась с кодом $($process.ExitCode): $FilePath $($Arguments -join ' ')"
    }
}

function Write-RuntimeConfig {
    param(
        [string]$Path,
        [string]$AppBaseUrl,
        [string]$WebSocketBaseUrl,
        [string]$TurnHost,
        [string]$TurnPassword
    )

    @"
window.__TESCORD_RUNTIME_CONFIG__ = {
  apiBaseUrl: '$AppBaseUrl',
  wsBaseUrl: '$WebSocketBaseUrl',
  iceServers: [
    {
      urls: 'stun:stun.l.google.com:19302'
    },
    {
      urls: ['turn:$TurnHost`:3478?transport=udp', 'turn:$TurnHost`:3478?transport=tcp'],
      username: 'tescordturn',
      credential: '$TurnPassword'
    }
  ]
};
"@ | Set-Content -Path $Path -Encoding UTF8
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$frontendRoot = Join-Path $repoRoot 'frontend'
$frontendDist = Join-Path $frontendRoot 'dist/frontend/browser'
$bootstrapScript = Join-Path $PSScriptRoot 'bootstrap-ubuntu24.sh'

if (-not $ServerHost) {
    $ServerHost = Read-Host 'Адрес сервера или IP'
}

if (-not $ServerUser) {
    $ServerUser = 'root'
}

if (-not $ServerPassword) {
    if ([string]::IsNullOrWhiteSpace($ServerPasswordText)) {
        $ServerPassword = Read-Host 'Пароль сервера' -AsSecureString
    }
    else {
        $ServerPassword = ConvertTo-SecureString $ServerPasswordText -AsPlainText -Force
    }
}

$appDomain = if ([string]::IsNullOrWhiteSpace($Domain)) { $ServerHost.Trim() } else { $Domain.Trim().ToLowerInvariant() }
$enableLetsEncrypt = -not [string]::IsNullOrWhiteSpace($Domain)
if ($enableLetsEncrypt -and [string]::IsNullOrWhiteSpace($LetsEncryptEmail)) {
    $LetsEncryptEmail = Read-Host "Email для Let's Encrypt (по умолчанию admin@$appDomain)"
    if ([string]::IsNullOrWhiteSpace($LetsEncryptEmail)) {
        $LetsEncryptEmail = "admin@$appDomain"
    }
}

$plinkPath = Require-Command 'plink.exe'
$pscpPath = Require-Command 'pscp.exe'
$gitPath = Require-Command 'git.exe'
$npmPath = Require-Command 'npm.cmd'

$plainPassword = Get-PlainTextPassword -SecurePassword $ServerPassword
$dbPassword = New-RandomHex -Bytes 18
$appSecret = New-RandomHex -Bytes 32
$turnPassword = New-RandomHex -Bytes 18
$demoPassword = 'Vfrfhjys9000'

$workingTreeDirty = & $gitPath -C $repoRoot status --porcelain --untracked-files=no
if ($LASTEXITCODE -ne 0) {
    throw 'Не удалось проверить git-статус.'
}
if ($workingTreeDirty) {
    throw 'Есть незакоммиченные изменения в отслеживаемых файлах. Сначала закоммить их.'
}

Write-Host 'Собираю frontend...' -ForegroundColor Cyan
Invoke-ExternalCommand -FilePath $npmPath -Arguments @('run', 'build') -WorkingDirectory $frontendRoot

if (-not (Test-Path $frontendDist)) {
    throw "Не найдена папка сборки frontend: $frontendDist"
}

$tempDir = Join-Path $env:TEMP ("tescord-deploy-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempDir | Out-Null

try {
    $archivePath = Join-Path $tempDir 'tescord-app.tar'
    $runtimeConfigPath = Join-Path $tempDir 'runtime-config.js'

    Write-Host 'Упаковываю backend и исходники...' -ForegroundColor Cyan
    Invoke-ExternalCommand -FilePath $gitPath -Arguments @('-C', $repoRoot, 'archive', '--format=tar', '--output', $archivePath, 'HEAD') -WorkingDirectory $repoRoot

    $appBaseUrl = "https://$appDomain"
    $webSocketBaseUrl = "wss://$appDomain"
    Write-RuntimeConfig -Path $runtimeConfigPath -AppBaseUrl $appBaseUrl -WebSocketBaseUrl $webSocketBaseUrl -TurnHost $appDomain -TurnPassword $turnPassword

    Write-Host 'Загружаю архив и bootstrap-скрипт на сервер...' -ForegroundColor Cyan
    Invoke-ExternalCommand -FilePath $pscpPath -Arguments @('-batch', '-pw', $plainPassword, $archivePath, "$ServerUser@$ServerHost:/root/tescord-app.tar") -WorkingDirectory $repoRoot
    Invoke-ExternalCommand -FilePath $pscpPath -Arguments @('-batch', '-pw', $plainPassword, $bootstrapScript, "$ServerUser@$ServerHost:/root/tescord-bootstrap.sh") -WorkingDirectory $repoRoot

    Write-Host 'Очищаю frontend на сервере...' -ForegroundColor Cyan
    Invoke-ExternalCommand -FilePath $plinkPath -Arguments @('-batch', '-pw', $plainPassword, "$ServerUser@$ServerHost", "mkdir -p /srv/tescord/frontend/browser && find /srv/tescord/frontend/browser -mindepth 1 -maxdepth 1 -exec rm -rf {} +") -WorkingDirectory $repoRoot

    Write-Host 'Загружаю frontend...' -ForegroundColor Cyan
    Invoke-ExternalCommand -FilePath $pscpPath -Arguments @('-batch', '-pw', $plainPassword, '-r', "$frontendDist\*", "$ServerUser@$ServerHost:/srv/tescord/frontend/browser/") -WorkingDirectory $repoRoot
    Invoke-ExternalCommand -FilePath $pscpPath -Arguments @('-batch', '-pw', $plainPassword, $runtimeConfigPath, "$ServerUser@$ServerHost:/srv/tescord/frontend/browser/runtime-config.js") -WorkingDirectory $repoRoot

    $remoteCommand = @(
        "chmod +x /root/tescord-bootstrap.sh",
        "SERVER_HOST='$ServerHost'",
        "APP_DOMAIN='$appDomain'",
        "ENABLE_LETSENCRYPT='" + ($(if ($enableLetsEncrypt) { 'true' } else { 'false' })) + "'",
        "LETSENCRYPT_EMAIL='$LetsEncryptEmail'",
        "DB_PASSWORD='$dbPassword'",
        "APP_SECRET='$appSecret'",
        "DEMO_PASSWORD='$demoPassword'",
        "TURN_PASSWORD='$turnPassword'",
        "/bin/bash /root/tescord-bootstrap.sh"
    ) -join ' '

    Write-Host 'Запускаю автоматическую настройку Ubuntu 24...' -ForegroundColor Cyan
    Invoke-ExternalCommand -FilePath $plinkPath -Arguments @('-batch', '-pw', $plainPassword, "$ServerUser@$ServerHost", $remoteCommand) -WorkingDirectory $repoRoot

    Write-Host 'Проверяю health endpoint...' -ForegroundColor Cyan
    Invoke-ExternalCommand -FilePath $plinkPath -Arguments @('-batch', '-pw', $plainPassword, "$ServerUser@$ServerHost", "curl -fsS https://$appDomain/api/health || curl -fsS http://127.0.0.1:8000/api/health") -WorkingDirectory $repoRoot

    Write-Host ''
    Write-Host 'Деплой завершен.' -ForegroundColor Green
    Write-Host "Сайт: https://$appDomain"
    Write-Host "TURN пользователь: tescordturn"
    Write-Host "TURN пароль: $turnPassword"
    if (-not $enableLetsEncrypt) {
        Write-Host 'Используется self-signed HTTPS на IP. Для доверенного SSL нужен домен.' -ForegroundColor Yellow
    }
}
finally {
    if (Test-Path $tempDir) {
        Remove-Item -Recurse -Force $tempDir
    }
}
