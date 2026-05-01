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
    [string]$LetsEncryptEmail,
    [string]$CustomCertificatePath,
    [string]$CustomCertificateKeyPath,
    [string]$CustomCertificateChainPath,
    [switch]$SkipGitStatusCheck
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

function Require-AnyCommand {
    param([string[]]$Names)

    foreach ($name in $Names) {
        $command = Get-Command $name -ErrorAction SilentlyContinue
        if ($command) {
            return $command.Source
        }
    }

    throw "Не найдено ни одно из: $($Names -join ', ')"
}

function New-RandomHex {
    param([int]$Bytes = 32)

    $buffer = New-Object byte[] $Bytes
    $randomNumberGenerator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $randomNumberGenerator.GetBytes($buffer)
    }
    finally {
        $randomNumberGenerator.Dispose()
    }

    return ([BitConverter]::ToString($buffer)).Replace('-', '').ToLowerInvariant()
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

function Resolve-PythonCommand {
    $pythonPath = Get-Command 'python.exe' -ErrorAction SilentlyContinue
    if (-not $pythonPath) {
        $pythonPath = Get-Command 'python' -ErrorAction SilentlyContinue
    }
    if ($pythonPath) {
        return [pscustomobject]@{
            FilePath = $pythonPath.Source
            Prefix = @()
        }
    }

    $pyLauncherPath = Get-Command 'py.exe' -ErrorAction SilentlyContinue
    if (-not $pyLauncherPath) {
        $pyLauncherPath = Get-Command 'py' -ErrorAction SilentlyContinue
    }
    if ($pyLauncherPath) {
        return [pscustomobject]@{
            FilePath = $pyLauncherPath.Source
            Prefix = @('-3')
        }
    }

    throw 'Не найден Python. Установите python.exe или py.exe, чтобы использовать автоматический деплой.'
}

function Invoke-PythonCommand {
    param(
        [pscustomobject]$PythonCommand,
        [string[]]$Arguments,
        [string]$WorkingDirectory
    )

    Invoke-ExternalCommand -FilePath $PythonCommand.FilePath -Arguments @($PythonCommand.Prefix + $Arguments) -WorkingDirectory $WorkingDirectory
}

function Test-PythonModule {
    param(
        [pscustomobject]$PythonCommand,
        [string]$ModuleName
    )

    & $PythonCommand.FilePath @($PythonCommand.Prefix + @('-c', "import $ModuleName")) *> $null
    return $LASTEXITCODE -eq 0
}

function Ensure-PythonModule {
    param(
        [pscustomobject]$PythonCommand,
        [string]$ModuleName
    )

    if (Test-PythonModule -PythonCommand $PythonCommand -ModuleName $ModuleName) {
        return
    }

    Write-Host "Устанавливаю Python-модуль $ModuleName..." -ForegroundColor Cyan
    Invoke-PythonCommand -PythonCommand $PythonCommand -Arguments @('-m', 'pip', 'install', '--user', $ModuleName) -WorkingDirectory $repoRoot
}

function Resolve-ExistingFilePath {
    param(
        [string]$Path,
        [string]$Label
    )

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return $null
    }

    $resolvedPath = Resolve-Path -LiteralPath $Path -ErrorAction SilentlyContinue
    if (-not $resolvedPath) {
        throw "Не найден файл ${Label}: $Path"
    }

    $item = Get-Item -LiteralPath $resolvedPath.ProviderPath
    if ($item.PSIsContainer) {
        throw "Ожидался файл ${Label}, а не папка: $Path"
    }

    return $item.FullName
}

function Write-RuntimeConfig {
    param(
        [string]$Path,
        [string]$AppBaseUrl,
        [string]$WebSocketBaseUrl,
        [string]$SfuBaseUrl,
        [string]$TurnHost,
        [string]$TurnPassword
    )

    @"
window.__TESCORD_RUNTIME_CONFIG__ = {
  apiBaseUrl: '$AppBaseUrl',
  wsBaseUrl: '$WebSocketBaseUrl',
  sfuUrl: '$SfuBaseUrl',
  iceServers: [
    {
      urls: 'stun:stun.l.google.com:19302'
    },
    {
      urls: ['turn:$TurnHost`:3478?transport=udp', 'turn:$TurnHost`:3478?transport=tcp'],
      username: 'tescordturn',
      credential: '$TurnPassword'
    },
    {
      urls: ['turns:$TurnHost`:5349?transport=tcp'],
      username: 'tescordturn',
      credential: '$TurnPassword'
    }
  ]
};
"@ | Set-Content -Path $Path -Encoding UTF8
}

function Write-RemoteDeployScript {
    param([string]$Path)

    @'
import json
import os
import posixpath
import shlex
import sys
import time
from pathlib import Path

import paramiko


def mkdir_p(sftp, remote_path: str) -> None:
    parts = []
    path = remote_path
    while path not in ("", "/"):
        parts.append(path)
        path = posixpath.dirname(path)

    for part in reversed(parts):
        try:
            sftp.stat(part)
        except FileNotFoundError:
            sftp.mkdir(part)


def upload_tree(sftp, local_root: Path, remote_root: str) -> None:
    mkdir_p(sftp, remote_root)
    for current_root, _dirs, files in os.walk(local_root):
        rel = os.path.relpath(current_root, local_root)
        remote_dir = remote_root if rel == "." else posixpath.join(remote_root, rel.replace("\\", "/"))
        mkdir_p(sftp, remote_dir)

        for filename in files:
            local_path = Path(current_root) / filename
            remote_path = posixpath.join(remote_dir, filename)
            sftp.put(str(local_path), remote_path)


def stream_command(client: paramiko.SSHClient, command: str, label: str) -> None:
    print(f"[remote] {label}", flush=True)
    _stdin, stdout, stderr = client.exec_command(command, get_pty=True)
    channel = stdout.channel

    while True:
        if channel.recv_ready():
            data = channel.recv(4096)
            if data:
                sys.stdout.buffer.write(data)
                sys.stdout.buffer.flush()

        if channel.recv_stderr_ready():
            data = channel.recv_stderr(4096)
            if data:
                sys.stderr.buffer.write(data)
                sys.stderr.buffer.flush()

        if channel.exit_status_ready():
            break

        time.sleep(0.2)

    while channel.recv_ready():
        data = channel.recv(4096)
        if data:
            sys.stdout.buffer.write(data)
            sys.stdout.buffer.flush()

    while channel.recv_stderr_ready():
        data = channel.recv_stderr(4096)
        if data:
            sys.stderr.buffer.write(data)
            sys.stderr.buffer.flush()

    exit_code = channel.recv_exit_status()
    if exit_code != 0:
        raise RuntimeError(f"Remote command failed with exit code {exit_code}: {label}")


def main() -> None:
    with open(sys.argv[1], encoding="utf-8-sig") as file_handle:
        payload = json.load(file_handle)

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        hostname=payload["host"],
        username=payload["user"],
        password=payload["password"],
        timeout=20,
        auth_timeout=20,
        banner_timeout=20,
    )

    try:
        sftp = client.open_sftp()
        try:
            print("[upload] release archive and bootstrap", flush=True)
            sftp.put(payload["archive_path"], "/root/tescord-app.tar")
            sftp.put(payload["bootstrap_script"], "/root/tescord-bootstrap.sh")
            if payload["custom_certificate_path"]:
                print("[upload] custom ssl certificate", flush=True)
                sftp.put(payload["custom_certificate_path"], "/root/tescord-custom-certificate.crt")
                sftp.put(payload["custom_certificate_key_path"], "/root/tescord-custom-certificate.key")
                if payload["custom_certificate_chain_path"]:
                    sftp.put(payload["custom_certificate_chain_path"], "/root/tescord-custom-certificate-ca.crt")

            stream_command(
                client,
                "mkdir -p /srv/tescord/frontend/browser && find /srv/tescord/frontend/browser -mindepth 1 -maxdepth 1 -exec rm -rf {} +",
                "prepare frontend dir",
            )

            print("[upload] frontend assets", flush=True)
            upload_tree(sftp, Path(payload["frontend_dist"]), "/srv/tescord/frontend/browser")
            sftp.put(payload["runtime_config_path"], "/srv/tescord/frontend/browser/runtime-config.js")
        finally:
            sftp.close()

        env_parts = {
            "SERVER_HOST": payload["host"],
            "APP_DOMAIN": payload["app_domain"],
            "ENABLE_LETSENCRYPT": payload["enable_letsencrypt"],
            "LETSENCRYPT_EMAIL": payload["letsencrypt_email"],
            "DB_PASSWORD": payload["db_password"],
            "APP_SECRET": payload["app_secret"],
            "DEMO_PASSWORD": payload["demo_password"],
            "TURN_PASSWORD": payload["turn_password"],
            "LIVEKIT_API_KEY": payload["livekit_api_key"],
            "LIVEKIT_API_SECRET": payload["livekit_api_secret"],
            "CUSTOM_SSL_CERT_PATH": payload["remote_custom_certificate_path"],
            "CUSTOM_SSL_KEY_PATH": payload["remote_custom_certificate_key_path"],
            "CUSTOM_SSL_CA_PATH": payload["remote_custom_certificate_chain_path"],
        }
        env_prefix = " ".join(f"{key}={shlex.quote(str(value))}" for key, value in env_parts.items())
        bootstrap_command = f"chmod +x /root/tescord-bootstrap.sh && {env_prefix} /bin/bash /root/tescord-bootstrap.sh"
        stream_command(client, bootstrap_command, "bootstrap ubuntu")

        app_domain = payload["app_domain"]
        health_check_command = (
            "for attempt in $(seq 1 30); do "
            f"if curl -kfsS 'https://{app_domain}/api/health' >/dev/null 2>&1; then curl -kfsS 'https://{app_domain}/api/health'; exit 0; fi; "
            f"if curl -fsS -H 'Host: {app_domain}' 'http://127.0.0.1:8000/api/health' >/dev/null 2>&1; then curl -fsS -H 'Host: {app_domain}' 'http://127.0.0.1:8000/api/health'; exit 0; fi; "
            "sleep 2; "
            "done; "
            f"curl -kfsS 'https://{app_domain}/api/health' || "
            f"curl -fsS -H 'Host: {app_domain}' 'http://127.0.0.1:8000/api/health'"
        )
        stream_command(client, health_check_command, "health check")
    finally:
        client.close()


if __name__ == "__main__":
    main()
'@ | Set-Content -Path $Path -Encoding UTF8
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
$normalizedCustomCertificatePath = Resolve-ExistingFilePath -Path $CustomCertificatePath -Label 'сертификата'
$normalizedCustomCertificateKeyPath = Resolve-ExistingFilePath -Path $CustomCertificateKeyPath -Label 'приватного ключа'
$normalizedCustomCertificateChainPath = Resolve-ExistingFilePath -Path $CustomCertificateChainPath -Label 'цепочки сертификатов'
$useCustomCertificate = ($null -ne $normalizedCustomCertificatePath) -or ($null -ne $normalizedCustomCertificateKeyPath) -or ($null -ne $normalizedCustomCertificateChainPath)

if ($useCustomCertificate) {
    if ([string]::IsNullOrWhiteSpace($Domain)) {
        throw 'Для кастомного SSL нужно указать домен через -Domain.'
    }
    if (-not $normalizedCustomCertificatePath) {
        throw 'Для кастомного SSL не указан файл сертификата. Используй -CustomCertificatePath.'
    }
    if (-not $normalizedCustomCertificateKeyPath) {
        throw 'Для кастомного SSL не указан приватный ключ. Используй -CustomCertificateKeyPath.'
    }
}

$enableLetsEncrypt = (-not [string]::IsNullOrWhiteSpace($Domain)) -and (-not $useCustomCertificate)
if ($enableLetsEncrypt -and [string]::IsNullOrWhiteSpace($LetsEncryptEmail)) {
    $LetsEncryptEmail = Read-Host "Email для Let's Encrypt (по умолчанию admin@$appDomain)"
    if ([string]::IsNullOrWhiteSpace($LetsEncryptEmail)) {
        $LetsEncryptEmail = "admin@$appDomain"
    }
}
$normalizedLetsEncryptEmail = if ([string]::IsNullOrWhiteSpace($LetsEncryptEmail)) { '' } else { $LetsEncryptEmail }

$gitPath = Require-Command 'git.exe'
$npmPath = Require-Command 'npm.cmd'
$pythonCommand = Resolve-PythonCommand
Ensure-PythonModule -PythonCommand $pythonCommand -ModuleName 'paramiko'

$plainPassword = Get-PlainTextPassword -SecurePassword $ServerPassword
$dbPassword = New-RandomHex -Bytes 18
$appSecret = New-RandomHex -Bytes 32
$turnPassword = New-RandomHex -Bytes 18
$livekitApiSecret = New-RandomHex -Bytes 24
$livekitApiKey = 'tescord-livekit'
$demoPassword = 'Vfrfhjys9000'

if (-not $SkipGitStatusCheck) {
    $workingTreeDirty = & $gitPath -C $repoRoot status --porcelain --untracked-files=no
    if ($LASTEXITCODE -ne 0) {
        throw 'Не удалось проверить git-статус.'
    }
    if ($workingTreeDirty) {
        throw 'Есть незакоммиченные изменения в отслеживаемых файлах. Сначала закоммить их.'
    }
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
    $deployPayloadPath = Join-Path $tempDir 'deploy-payload.json'
    $remoteDeployScriptPath = Join-Path $tempDir 'deploy-remote.py'

    Write-Host 'Упаковываю backend и исходники...' -ForegroundColor Cyan
    Invoke-ExternalCommand -FilePath $gitPath -Arguments @('-C', $repoRoot, 'archive', '--format=tar', '--output', $archivePath, 'HEAD') -WorkingDirectory $repoRoot

    $appBaseUrl = "https://$appDomain"
    $webSocketBaseUrl = "wss://$appDomain"
    $sfuBaseUrl = "$webSocketBaseUrl/livekit"
    Write-RuntimeConfig -Path $runtimeConfigPath -AppBaseUrl $appBaseUrl -WebSocketBaseUrl $webSocketBaseUrl -SfuBaseUrl $sfuBaseUrl -TurnHost $appDomain -TurnPassword $turnPassword
    Write-RemoteDeployScript -Path $remoteDeployScriptPath

    $deployPayload = [ordered]@{
        host = $ServerHost
        user = $ServerUser
        password = $plainPassword
        archive_path = $archivePath
        bootstrap_script = $bootstrapScript
        frontend_dist = $frontendDist
        runtime_config_path = $runtimeConfigPath
        app_domain = $appDomain
        enable_letsencrypt = if ($enableLetsEncrypt) { 'true' } else { 'false' }
        letsencrypt_email = $normalizedLetsEncryptEmail
        db_password = $dbPassword
        app_secret = $appSecret
        demo_password = $demoPassword
        turn_password = $turnPassword
        livekit_api_key = $livekitApiKey
        livekit_api_secret = $livekitApiSecret
        custom_certificate_path = if ($normalizedCustomCertificatePath) { $normalizedCustomCertificatePath } else { '' }
        custom_certificate_key_path = if ($normalizedCustomCertificateKeyPath) { $normalizedCustomCertificateKeyPath } else { '' }
        custom_certificate_chain_path = if ($normalizedCustomCertificateChainPath) { $normalizedCustomCertificateChainPath } else { '' }
        remote_custom_certificate_path = if ($normalizedCustomCertificatePath) { '/root/tescord-custom-certificate.crt' } else { '' }
        remote_custom_certificate_key_path = if ($normalizedCustomCertificateKeyPath) { '/root/tescord-custom-certificate.key' } else { '' }
        remote_custom_certificate_chain_path = if ($normalizedCustomCertificateChainPath) { '/root/tescord-custom-certificate-ca.crt' } else { '' }
    }
    $deployPayload | ConvertTo-Json -Depth 4 | Set-Content -Path $deployPayloadPath -Encoding UTF8

    Write-Host 'Запускаю удалённый деплой...' -ForegroundColor Cyan
    Invoke-PythonCommand -PythonCommand $pythonCommand -Arguments @($remoteDeployScriptPath, $deployPayloadPath) -WorkingDirectory $repoRoot

    Write-Host ''
    Write-Host 'Деплой завершен.' -ForegroundColor Green
    Write-Host "Сайт: https://$appDomain"
    Write-Host "SFU: wss://$appDomain/livekit"
    Write-Host "TURN пользователь: tescordturn"
    Write-Host "TURN пароль: $turnPassword"
    if ($useCustomCertificate) {
        Write-Host 'SSL: используется кастомный сертификат.' -ForegroundColor Green
    }
    if (-not $enableLetsEncrypt) {
        if (-not $useCustomCertificate) {
            Write-Host 'Используется self-signed HTTPS на IP. Для доверенного SSL нужен домен.' -ForegroundColor Yellow
        }
    }
}
finally {
    if (Test-Path $tempDir) {
        Remove-Item -Recurse -Force $tempDir
    }
}
