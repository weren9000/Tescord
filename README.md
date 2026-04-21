# Altgramm

Altgramm - это Discord-подобное приложение для небольших сообществ на `FastAPI`, `Angular`, `PostgreSQL` и `WebRTC`.

Сейчас в проекте уже есть:
- регистрация и вход
- текстовые и голосовые каналы
- realtime через `WebSocket`
- голос через `WebRTC`
- загрузка вложений в PostgreSQL
- админ-управление группами, каналами и доступом к голосовым комнатам

## Структура проекта

- `backend/` - FastAPI, модели БД, миграции, тесты
- `frontend/` - Angular-клиент
- `infra/` - шаблоны для `nginx`, `systemd`, `coturn`, `docker compose`
- `scripts/` - вспомогательные скрипты, включая автоматический деплой на `Ubuntu 24`

## Запуск в режиме разработки

### Что нужно

- `Python 3.12+`
- `Node.js 20+`
- `PostgreSQL 16+` или `Docker`

Frontend в development-режиме по умолчанию ходит в:

- `http://127.0.0.1:8000` для API
- `ws://127.0.0.1:8000` для WebSocket

Это уже прописано в [frontend/public/runtime-config.js](/d:/Эксперименты/alt-discord/frontend/public/runtime-config.js), отдельно настраивать ничего не нужно.

### PostgreSQL

Если PostgreSQL уже установлен локально, достаточно создать базу `tescord`.

На Windows:

```powershell
$env:PGPASSWORD='ВАШ_ПАРОЛЬ'
psql -h localhost -U postgres -d postgres -w -c "CREATE DATABASE tescord;"
```

На Ubuntu:

```bash
sudo -u postgres psql -c "CREATE DATABASE tescord;"
```

Если удобнее запускать PostgreSQL через Docker:

```powershell
docker compose -f infra/compose.yml up -d postgres
```

Контейнер поднимет:
- БД: `tescord`
- пользователя: `tescord`
- пароль: `tescord`

### Backend на Windows

```powershell
cd backend
python -m venv .venv
.venv\Scripts\activate
python -m pip install -e .[dev]
Copy-Item .env.example .env
alembic upgrade head
uvicorn app.main:app --reload
```

Пример локального `backend/.env`:

```env
TESCORD_DATABASE_URL=postgresql+psycopg://tescord:tescord@localhost:5432/tescord
TESCORD_SECRET_KEY=tescord-local-dev-secret
TESCORD_SEED_DEMO_DATA=true
```

После запуска backend будет доступен по адресам:
- API: `http://127.0.0.1:8000`
- Swagger: `http://127.0.0.1:8000/docs`
- Health: `http://127.0.0.1:8000/api/health`

### Backend на Ubuntu 24

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e '.[dev]'
cp .env.example .env
alembic upgrade head
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend

Во втором терминале:

На Windows:

```powershell
cd frontend
npm install
npm start
```

На Ubuntu:

```bash
cd frontend
npm install
npm start
```

Frontend будет доступен по адресу:

- `http://localhost:4200`

### Development seed

Если `TESCORD_SEED_DEMO_DATA=true`, backend автоматически создаст demo-данные.

По умолчанию:
- логин: `weren9000@kva-chat.local`
- пароль: `Vfrfhjys9000`

## Полезные команды

Backend:

На Windows:

```powershell
cd backend
.venv\Scripts\activate
pytest
alembic upgrade head
```

На Ubuntu:

```bash
cd backend
source .venv/bin/activate
pytest
alembic upgrade head
```

Frontend:

```powershell
cd frontend
npm run build
```

## Деплой на Ubuntu 24

Есть два варианта.

### 1. Ручной деплой

Подробно описан в [DEPLOYMENT.md](./DEPLOYMENT.md).

### 2. Автоматический деплой

Для Windows подготовлен PowerShell-скрипт:

- [scripts/deploy-ubuntu24.ps1](./scripts/deploy-ubuntu24.ps1)

Подробная инструкция лежит в [DEPLOYMENT.md](./DEPLOYMENT.md), а быстрый старт такой:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\deploy-ubuntu24.ps1 155.212.247.117 root ВАШ_ПАРОЛЬ
```

Если нужен сразу домен и доверенный `Let's Encrypt`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\deploy-ubuntu24.ps1 155.212.247.117 root ВАШ_ПАРОЛЬ -Domain tescord.ru -LetsEncryptEmail admin@tescord.ru
```

Он:
- собирает frontend локально
- упаковывает текущий закоммиченный `HEAD`
- загружает архив на сервер
- устанавливает `nginx`, `postgresql`, `redis`, `coturn`, `livekit-server`, `python3`, `venv`, `certbot`
- создает backend `.env`
- прогоняет миграции
- настраивает `systemd`
- разворачивает frontend
- записывает production `runtime-config.js`
- поднимает SFU для голоса по `wss://домен/livekit`
- выпускает `Let's Encrypt`, если указан домен
- иначе поднимает self-signed `HTTPS` на IP

Для запуска из корня проекта нужны:

- `git`
- `Node.js` и `npm`
- `Python 3`

`paramiko` скрипт установит сам, если модуль еще не установлен.

Интерактивный запуск:

```powershell
.\scripts\deploy-ubuntu24.ps1
```

Короткий запуск по IP, логину и паролю:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\deploy-ubuntu24.ps1 95.182.97.217 root ВАШ_ПАРОЛЬ
```

Если нужен сразу деплой на домен с `Let's Encrypt`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\deploy-ubuntu24.ps1 95.182.97.217 root ВАШ_ПАРОЛЬ -Domain tescord.ru -LetsEncryptEmail admin@tescord.ru
```

Если нужен деплой на домен со своим сертификатом:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\deploy-ubuntu24.ps1 95.182.97.217 root ВАШ_ПАРОЛЬ -Domain kvachat.ru -CustomCertificatePath .\сертификаты\certificate.crt -CustomCertificateKeyPath .\сертификаты\certificate.key -CustomCertificateChainPath .\сертификаты\certificate_ca.crt
```

Скрипт спросит:
- адрес сервера или IP
- логин
- пароль
- домен
- email для `Let's Encrypt`

Если `Domain` не указан, скрипт не будет ничего спрашивать про домен и развернет сайт по IP с self-signed `HTTPS`.

Важно:
- скрипт деплоит только **закоммиченный** код
- незакоммиченные tracked-изменения он не пропустит
- если домен не указан, поднимется self-signed `HTTPS` на IP
- для доверенного SSL лучше использовать домен
- после деплоя скрипт сам проверяет `/api/health` и выводит `TURN`-пароль
- кастомный сертификат можно передать через `-CustomCertificatePath`, `-CustomCertificateKeyPath` и `-CustomCertificateChainPath`
- если кастомный сертификат уже установлен на сервере, следующие деплои сохранят его и не переключат nginx обратно на `Let's Encrypt`

Подробности по ручному и автоматическому деплою есть в [DEPLOYMENT.md](./DEPLOYMENT.md).

## Примечание

В рабочей папке может существовать локальный untracked-файл `frontend/src/assets/Log out.svg`. Он не нужен для запуска и не участвует в git.
