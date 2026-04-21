# Деплой Altgramm на Ubuntu 24

Ниже два рабочих варианта:
- ручной деплой
- автоматический деплой через PowerShell-скрипт

## Что нужно на сервере

Рекомендуемый сервер:
- `Ubuntu 24.04 LTS`
- `2 vCPU`
- `4 GB RAM`
- `40+ GB SSD`

Для домена и голоса желательно подготовить:
- `A`-запись на сервер
- открытые порты `80/tcp`, `443/tcp`
- для `coturn`: `3478/tcp`, `3478/udp`, `49160-49200/udp`

## Ручной деплой

### 1. Установить системные пакеты

```bash
sudo apt-get update
sudo apt-get install -y \
  git \
  nginx \
  postgresql \
  postgresql-contrib \
  python3 \
  python3-venv \
  python3-pip \
  certbot \
  python3-certbot-nginx \
  coturn
```

### 2. Создать системного пользователя и каталоги

```bash
sudo useradd --system --create-home --shell /bin/bash tescord
sudo mkdir -p /srv/tescord
sudo chown tescord:tescord /srv/tescord
```

### 3. Развернуть код приложения

```bash
sudo -u tescord git clone <URL_РЕПОЗИТОРИЯ> /srv/tescord/app
cd /srv/tescord/app
```

### 4. Настроить PostgreSQL

Создать пользователя и базу:

```bash
sudo -u postgres psql -c "CREATE ROLE tescord LOGIN PASSWORD 'СИЛЬНЫЙ_ПАРОЛЬ';"
sudo -u postgres psql -c "CREATE DATABASE tescord OWNER tescord;"
```

Если роль или база уже существуют, вместо этого:

```bash
sudo -u postgres psql -c "ALTER ROLE tescord WITH PASSWORD 'СИЛЬНЫЙ_ПАРОЛЬ';"
```

### 5. Настроить backend

```bash
cd /srv/tescord/app/backend
sudo -u tescord python3 -m venv .venv
sudo -u tescord ./.venv/bin/python -m pip install --upgrade pip
sudo -u tescord ./.venv/bin/pip install -e .
cp .env.production.example .env
```

Пример production `backend/.env`:

```env
TESCORD_APP_NAME=Altgramm API
TESCORD_API_PREFIX=/api
TESCORD_ENVIRONMENT=production
TESCORD_DEBUG=false
TESCORD_DATABASE_URL=postgresql+psycopg://tescord:СИЛЬНЫЙ_ПАРОЛЬ@127.0.0.1:5432/tescord
TESCORD_CORS_ORIGINS=["https://tescord.ru","https://www.tescord.ru","https://95.182.97.217"]
TESCORD_ALLOWED_HOSTS=["tescord.ru","www.tescord.ru","95.182.97.217"]
TESCORD_SECRET_KEY=ОЧЕНЬ_ДЛИННЫЙ_СЛУЧАЙНЫЙ_СЕКРЕТ
TESCORD_ACCESS_TOKEN_EXPIRE_MINUTES=10080
TESCORD_SEED_DEMO_DATA=true
TESCORD_DEMO_LOGIN=weren9000@kva-chat.local
TESCORD_DEMO_NICK=weren9000
TESCORD_DEMO_PASSWORD=СИЛЬНЫЙ_ПАРОЛЬ_АДМИНА
TESCORD_DEMO_IS_ADMIN=true
TESCORD_DEMO_SERVER_NAME=Altgramm
```

Прогнать миграции:

```bash
sudo -u tescord /srv/tescord/app/backend/.venv/bin/python -m alembic upgrade head
```

### 6. Собрать frontend

Сборка можно делать локально или прямо на сервере.

Если собираешь на сервере:

```bash
cd /srv/tescord/app/frontend
npm install
npm run build
```

После сборки frontend будет лежать в:

- `/srv/tescord/app/frontend/dist/frontend/browser`

### 7. Настроить production runtime-config.js

Создай рядом с `index.html` файл `runtime-config.js`:

```js
window.__TESCORD_RUNTIME_CONFIG__ = {
  apiBaseUrl: 'https://tescord.ru',
  wsBaseUrl: 'wss://tescord.ru',
  iceServers: [
    {
      urls: 'stun:stun.l.google.com:19302'
    },
    {
      urls: ['turn:tescord.ru:3478?transport=udp', 'turn:tescord.ru:3478?transport=tcp'],
      username: 'tescordturn',
      credential: 'СИЛЬНЫЙ_TURN_ПАРОЛЬ'
    }
  ]
};
```

### 8. Настроить systemd для backend

Используй шаблон:

- [infra/systemd/tescord-backend.service.example](./infra/systemd/tescord-backend.service.example)

Или создай unit:

```ini
[Unit]
Description=Altgramm FastAPI backend
After=network.target postgresql.service
Wants=postgresql.service

[Service]
User=tescord
Group=tescord
WorkingDirectory=/srv/tescord/app/backend
EnvironmentFile=/srv/tescord/app/backend/.env
ExecStart=/srv/tescord/app/backend/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --proxy-headers
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Активировать:

```bash
sudo systemctl daemon-reload
sudo systemctl enable tescord-backend
sudo systemctl restart tescord-backend
```

### 9. Настроить Nginx

Можно взять шаблон:

- [infra/nginx/tescord.conf.example](./infra/nginx/tescord.conf.example)

Минимальная идея такая:
- `/` раздает Angular
- `/api/` проксирует в `127.0.0.1:8000`
- `client_max_body_size 55m`

После записи конфига:

```bash
sudo nginx -t
sudo systemctl restart nginx
```

### 10. Настроить coturn

Можно взять шаблон:

- [infra/coturn/turnserver.conf.example](./infra/coturn/turnserver.conf.example)

Нужно задать:
- `realm`
- `server-name`
- `external-ip`
- `user=tescordturn:ПАРОЛЬ`
- relay ports

После этого:

```bash
sudo sed -i 's/^#TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
sudo systemctl enable coturn
sudo systemctl restart coturn
```

### 11. Подключить HTTPS

Если домен уже смотрит на сервер:

```bash
sudo certbot --nginx -d tescord.ru -d www.tescord.ru
```

Если домена пока нет, можно временно оставить self-signed сертификат на IP, но браузеры будут ругаться. Для нормального голоса на телефонах лучше использовать доверенный сертификат на домен.

### 12. Проверка

Проверь:

```bash
curl -fsS https://tescord.ru/api/health
```

И вручную:
- открывается главная страница
- работает вход
- создаются группы и каналы
- работают текстовые сообщения
- работают голосовые каналы

## Автоматический деплой

### Что уже подготовлено

В репозитории есть два файла:
- [scripts/deploy-ubuntu24.ps1](./scripts/deploy-ubuntu24.ps1) - локальный запуск с Windows
- [scripts/bootstrap-ubuntu24.sh](./scripts/bootstrap-ubuntu24.sh) - удаленная настройка сервера

Если нужен самый короткий путь, читай этот раздел и запускай одну из готовых команд ниже.

### Что нужно локально

На машине, с которой запускается деплой:
- `git`
- `Node.js` и `npm`
- `Python 3`

Модуль `paramiko` скрипт установит сам, если его еще нет. Отдельно ставить `PuTTY`, `plink.exe` и `pscp.exe` не нужно.

### Быстрый старт

Запускать из корня проекта.

Самый простой сценарий по IP:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\deploy-ubuntu24.ps1 155.212.247.117 root ВАШ_ПАРОЛЬ
```

Сразу на домен с `Let's Encrypt`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\deploy-ubuntu24.ps1 155.212.247.117 root ВАШ_ПАРОЛЬ -Domain tescord.ru -LetsEncryptEmail admin@tescord.ru
```

На домен со своим сертификатом:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\deploy-ubuntu24.ps1 155.212.247.117 root ВАШ_ПАРОЛЬ -Domain kvachat.ru -CustomCertificatePath .\сертификаты\certificate.crt -CustomCertificateKeyPath .\сертификаты\certificate.key -CustomCertificateChainPath .\сертификаты\certificate_ca.crt
```

Если удобнее вводить параметры по шагам, можно запустить просто:

```powershell
.\scripts\deploy-ubuntu24.ps1
```

### Как работает скрипт

Скрипт:
- проверяет, что все tracked-изменения закоммичены
- собирает frontend
- упаковывает текущий `HEAD`
- загружает архив на сервер
- устанавливает нужные пакеты на `Ubuntu 24`
- поднимает PostgreSQL, backend, nginx, coturn
- создает production `.env`
- пишет `runtime-config.js`
- пробует выпустить `Let's Encrypt`, если указан домен
- сам делает health-check с повторами, если backend поднимается не мгновенно

### Запуск

Из корня проекта:

```powershell
.\scripts\deploy-ubuntu24.ps1
```

Короткий запуск без лишних вопросов:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\deploy-ubuntu24.ps1 95.182.97.217 root ВАШ_ПАРОЛЬ
```

Запуск сразу на домен:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\deploy-ubuntu24.ps1 95.182.97.217 root ВАШ_ПАРОЛЬ -Domain tescord.ru -LetsEncryptEmail admin@tescord.ru
```

Запуск сразу на домен со своим сертификатом:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\deploy-ubuntu24.ps1 95.182.97.217 root ВАШ_ПАРОЛЬ -Domain kvachat.ru -CustomCertificatePath .\сертификаты\certificate.crt -CustomCertificateKeyPath .\сертификаты\certificate.key -CustomCertificateChainPath .\сертификаты\certificate_ca.crt
```

Скрипт спросит:
- адрес сервера или IP
- логин
- пароль
- домен
- email для `Let's Encrypt`

### Что важно знать

- деплоится только закоммиченный `HEAD`
- незакоммиченные tracked-правки скрипт не пропустит
- если домен не указан, сайт поднимется по IP с self-signed `HTTPS`
- self-signed подходит только как временный вариант
- production `runtime-config.js` генерируется автоматически
- пароль `TURN` тоже генерируется автоматически и выводится в конце
- в минимальном сценарии достаточно передать `IP`, `логин` и `пароль`
- если PowerShell ругается на policy, используй вариант с `-ExecutionPolicy Bypass`
- флаг `-SkipGitStatusCheck` оставлен только для технических прогонов; в обычном деплое лучше его не использовать
- кастомный SSL можно передать через `-CustomCertificatePath`, `-CustomCertificateKeyPath` и опциональный `-CustomCertificateChainPath`
- если кастомный сертификат уже лежит на сервере, новые деплои сохраняют его автоматически

### Пример сценария

1. Закоммитить изменения.
2. Убедиться, что домен уже смотрит на VPS.
3. Запустить:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\deploy-ubuntu24.ps1
```

4. Ввести:
   - IP сервера
   - `root`
   - пароль
   - домен
   - email
5. Дождаться окончания и проверить `https://домен/api/health`

## Что использовать в итоге

- Если хочешь полный контроль: ручной деплой.
- Если нужно быстро развернуть проект на чистой `Ubuntu 24`: используй [scripts/deploy-ubuntu24.ps1](./scripts/deploy-ubuntu24.ps1).
