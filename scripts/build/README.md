# Локальная сборка Windows / Android

Команды выполняются из корня репозитория. Путь проекта может меняться:
скрипт определяет его относительно своего расположения.

## Файлы на компьютере

- `frontend/node_modules`, `desktop/node_modules`, `mobile/node_modules` — обычные
  локальные каталоги зависимостей. Восстанавливаются через `npm ci` в каждом разделе.
- `.tools/jdk/<версия>/` — Java 21.
- `.tools/sdk/` — Android SDK: Platform 36, Build Tools 36.0.0, command-line tools.
- `.local/native-runtime.json` — проверенная конфигурация production для нативных
  клиентов, включая TURN. Не публиковать в Git.
- `frontend/dist`, `desktop/release`, `mobile/release` — результаты сборок.

Эти файлы исключены из Git. SDK и JDK устанавливаются отдельно; скрипт окружения
ничего не скачивает. Если `.tools` отсутствует, используются установленные
`JAVA_HOME` и Android SDK. Node.js и npm должны быть доступны в PATH.
Зависимости от `D:\KvachatBuild` для сборки больше нет.

## Окружение и web

```powershell
. .\scripts\build\env.ps1
npm --prefix frontend ci
npm --prefix frontend run build
```

`env.ps1` задаёт переменные только в текущем терминале, обновляет локальный
`mobile/android/local.properties` и подключает `.local/native-runtime.json`.
После переноса проекта запустите его снова.

## Windows

После сборки frontend:

```powershell
npm --prefix desktop ci
npm --prefix desktop run dist
```

## Android

После сборки frontend и загрузки окружения:

```powershell
Push-Location mobile
try {
    npm ci
    node prepare-web.cjs
    npm run sync
    Push-Location android
    try { .\gradlew.bat assembleRelease --console=plain } finally { Pop-Location }
} finally { Pop-Location }
```

Подпись выполняется существующим `mobile/sign-release.ps1` с параметрами
`-SdkRoot $env:ANDROID_HOME -SigningDirectory <папка-ключа>`.
Текущий ключ хранится вне репозитория в `..\Backups\android-signing`.
Не создавать новый ключ для обновления уже установленного приложения.

Старые инструкции в `mobile/README.md` описывают ранние релизы; актуальные
локальные пути и команды настройки приведены здесь.
