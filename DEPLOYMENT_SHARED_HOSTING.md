# Развертывание на текущем хостинге

## Важный итог

Текущий хостинг `tes-cord.ru` подходит только для frontend.

Если нужен полноценный деплой backend, базы и голоса на VPS одной командой, см. [DEPLOYMENT.md](./DEPLOYMENT.md), раздел `Автоматический деплой`.

Полностью текущий проект на нем не развернуть, потому что:

- проект использует `FastAPI`, а не `PHP`
- проект использует `PostgreSQL`, а на хостинге заявлен `MySQL`
- голос требует `TURN` и `UDP` порты
- для backend нужен отдельный постоянно работающий процесс

## Рабочая схема

### На текущем shared hosting

Оставляем только Angular frontend:

- домен: `https://www.tes-cord.ru`
- через FTP загружается содержимое `frontend/dist/frontend/browser/`

### На отдельном VPS

Разворачиваем:

- `FastAPI`
- `PostgreSQL`
- `coturn`
- `nginx`

Рекомендуемые адреса:

- `https://api.tes-cord.ru` для backend
- `turn:turn.tes-cord.ru:3478` и `turns:turn.tes-cord.ru:5349` для голоса

## Что нужно загрузить на shared hosting

После `npm run build` загрузи в папку сайта:

- `index.html`
- `main-*.js`
- `polyfills-*.js`
- `styles-*.css`
- `runtime-config.js`
- `.htaccess`
- `favicon.ico`

`.htaccess` уже лежит в `frontend/public/.htaccess`.

## Как должен выглядеть runtime-config.js для этого сценария

Пример:

```js
window.__TESCORD_RUNTIME_CONFIG__ = {
  apiBaseUrl: 'https://api.tes-cord.ru',
  wsBaseUrl: 'wss://api.tes-cord.ru',
  iceServers: [
    {
      urls: 'stun:stun.l.google.com:19302'
    },
    {
      urls: ['turn:turn.tes-cord.ru:3478?transport=udp', 'turn:turn.tes-cord.ru:3478?transport=tcp'],
      username: 'TURN_USERNAME',
      credential: 'TURN_PASSWORD'
    },
    {
      urls: ['turns:turn.tes-cord.ru:5349?transport=tcp'],
      username: 'TURN_USERNAME',
      credential: 'TURN_PASSWORD'
    }
  ]
};
```

## DNS для гибридной схемы

Нужно будет настроить:

- `A` запись `www.tes-cord.ru` -> текущий shared hosting
- `A` запись `api.tes-cord.ru` -> VPS
- `A` запись `turn.tes-cord.ru` -> VPS

## Что я рекомендую

Лучший вариант:

1. Оставить `www.tes-cord.ru` под frontend
2. Купить VPS под backend и голос
3. После этого развернуть API и TURN на VPS
4. Прописать `runtime-config.js`

Эта схема полностью совместима с текущим кодом.
