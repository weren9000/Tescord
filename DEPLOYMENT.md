# Деплой Tescord

## Что уже подготовлено в коде

- frontend теперь читает `API`, `WebSocket` и `ICE servers` из `runtime-config.js`
- backend поддерживает `allowed_hosts`
- в `infra/` лежат шаблоны для `nginx`, `systemd` и `coturn`

## Что нужно заменить перед продом

### Backend

1. Скопируй `backend/.env.production.example` в `backend/.env`
2. Заполни:
   - `TESCORD_DATABASE_URL`
   - `TESCORD_CORS_ORIGINS`
   - `TESCORD_ALLOWED_HOSTS`
   - `TESCORD_SECRET_KEY`
3. Для production обязательно:
   - `TESCORD_DEBUG=false`
   - `TESCORD_SEED_DEMO_DATA=false`

### Frontend

После `npm run build` отредактируй файл `runtime-config.js` рядом с `index.html`.

Можно взять за основу:

- `frontend/public/runtime-config.js`
- или `infra/runtime-config.production.example.js`

Нужно указать:

- `apiBaseUrl`
- `wsBaseUrl`
- `iceServers`

## Рекомендуемая структура на сервере

```text
/srv/tescord/
  backend/
  frontend/
```

Где:

- `backend/` содержит Python-приложение, `.venv`, `.env`
- `frontend/dist/frontend/browser/` содержит собранный Angular

## Порядок развертывания

1. Клонировать репозиторий на сервер
2. Настроить `backend/.env`
3. Создать `.venv` и установить backend-зависимости
4. Выполнить `alembic upgrade head`
5. Собрать frontend через `npm run build`
6. Отредактировать production `runtime-config.js`
7. Подключить `nginx` через `infra/nginx/tescord.conf.example`
8. Подключить backend `systemd` unit через `infra/systemd/tescord-backend.service.example`
9. Настроить `coturn` через `infra/coturn/turnserver.conf.example`
10. Выпустить HTTPS сертификат и перезапустить сервисы

## Проверка после деплоя

- `https://chat.example.com/`
- `https://chat.example.com/api/health`
- логин в приложении
- создание группы/канала
- подключение к голосу из двух браузеров
