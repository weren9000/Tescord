// Export the existing app icon geometry and a standalone, local brand catalogue.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'artifacts/cosmic-kit');
const iconsDir = path.join(output, 'icons');
fs.mkdirSync(iconsDir, { recursive: true });
const paths = JSON.parse(
  fs.readFileSync(path.join(root, 'docs/design/painted-controls/legacy-glyphs.json'), 'utf8'),
);
const svg = (name) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]}"/></svg>`;
for (const name of Object.keys(paths))
  fs.writeFileSync(path.join(iconsDir, name + '.svg'), svg(name));
fs.writeFileSync(
  path.join(output, 'icons.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg">${Object.entries(paths)
    .map(
      ([name, d]) =>
        `<symbol id="${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></symbol>`,
    )
    .join('')}</svg>`,
);
const tokens = {
  colors: {
    canvas: '#10121c',
    surface: '#191c2d',
    raised: '#23273c',
    primary: '#754bff',
    cyan: '#57c8d5',
    text: '#fff5e6',
    muted: '#b3b2c8',
    lilac: '#b9a6ff',
    border: '#45405e',
    danger: '#e54c64',
    success: '#41d394',
  },
  spacing: [4, 8, 12, 16, 24, 32, 48, 64],
  radius: { control: 13, panel: 24, avatar: '50%' },
  icon: { size: 24, stroke: 1.7 },
  minTarget: 44,
};
fs.writeFileSync(path.join(output, 'tokens.json'), JSON.stringify(tokens, null, 2));
fs.writeFileSync(
  path.join(output, 'manifest.json'),
  JSON.stringify(
    {
      source: 'frontend/src/app/workspace/ui-icon.component.ts',
      icons: Object.keys(paths),
      illustrations: ['hero', 'kvak', 'zhabik', 'lilya', 'bolot'],
      components: [
        'buttons',
        'downloads',
        'icon-buttons',
        'inputs',
        'search',
        'select',
        'checkbox',
        'radio',
        'switch',
        'slider',
        'tabs',
        'avatars',
        'voice-room',
        'message',
        'document',
        'notice',
        'tooltip',
        'dialog',
        'menu',
        'accordion',
        'loading',
        'empty',
        'error',
      ],
    },
    null,
    2,
  ),
);
const assets = './assets/';
fs.mkdirSync(path.join(output, 'assets'), { recursive: true });
for (const name of ['hero', 'kvak', 'zhabik', 'lilya', 'bolot']) {
  fs.copyFileSync(
    path.join(root, 'frontend/public/assets/cosmic', name + '.webp'),
    path.join(output, 'assets', name + '.webp'),
  );
}
const characters = [
  ['kvak', 'Квак'],
  ['zhabik', 'Жабик'],
  ['lilya', 'Лиля'],
  ['bolot', 'Болот'],
];
const avatars = characters
  .map(
    ([file, name]) =>
      `<figure><img src="${assets}${file}.webp" alt="${name}" width="96" height="96"><figcaption>${name}</figcaption></figure>`,
  )
  .join('');
const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Квачат — Космическая компания · UI kit</title><link rel="stylesheet" href="kit.css">
<body><header><p class="eyebrow">КВАЧАТ · КОСМИЧЕСКАЯ КОМПАНИЯ</p><h1>Свои люди.<br>Единый стиль.</h1><p>Рабочий каталог графики, иконок и состояний. Образцы для дальнейшей сборки интерфейса.</p><nav><a href="#components">Элементы</a><a href="#icons">Иконки · ${Object.keys(paths).length}</a><a href="#characters">Герои</a><a href="tokens.json">Токены JSON</a><a href="icons.svg">SVG-спрайт</a></nav></header>
<main><section><h2>Палитра и типографика</h2><div class="swatches">${Object.entries(tokens.colors)
  .map(
    ([key, value]) =>
      `<div><i style="background:${value}"></i><b>${key}</b><code>${value}</code></div>`,
  )
  .join(
    '',
  )}</div><div class="grid"><article><h2>Все свои уже на связи.</h2><p>Голосовой чат для друзей. Крупный уверенный заголовок, спокойный основной текст, короткие подписи.</p><small>Inter / Segoe UI · 16 px · интерлиньяж 1.6</small></article><article><p>Интервалы: 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64</p><p>Кнопки: от 44 px. Скругление: 13 px.<br>Панели: 24 px. Аватары: круг.</p><p class="muted">Фиолетовый — действие. Бирюзовый — голос и фокус. Кремовый — основной текст.</p></article></div></section>
<section id="characters"><h2>Герои и иллюстрация</h2><div class="characters">${avatars}</div><img class="scene" src="${assets}hero.webp" alt="Друзья на кувшинке в космическом болоте"><p class="muted">Иллюстрация без текста. Кнопки, заголовки и панель звонка собираются в HTML.</p></section>
<section id="components"><h2>Элементы и состояния</h2><div class="grid">
<article><h3>Действия</h3><div class="row"><button class="primary">Присоединиться</button><button>Войти</button><button disabled>Недоступно</button></div><div class="row"><button class="icon" aria-label="Микрофон" aria-pressed="true" data-toggle>${svg('mic')}</button><button class="icon" aria-label="Камера" aria-pressed="false" data-toggle>${svg('camera')}</button><button class="icon danger" aria-label="Завершить звонок">${svg('hangup')}</button><button aria-busy="true"><span class="spinner"></span> Подключение</button></div><div class="downloads"><span>${svg('download')} Windows · EXE</span><span>${svg('download')} Android · APK</span></div><p class="muted">Tab показывает фокус. Иконки микрофона и камеры переключают состояние образца.</p></article>
<article><h3>Поля и поиск</h3><label>Название комнаты<input placeholder="Вечерняя компания"></label><label>Поиск<div class="search">${svg('search')}<input type="search" placeholder="Найти разговор"></div></label><label>Ошибка<input aria-invalid="true" aria-describedby="field-error" value=""></label><small id="field-error" class="error">Введите название комнаты.</small><label>Тема<select><option>Космическая компания</option><option>Системная</option></select></label></article>
<article><h3>Выбор и настройки</h3><div class="tabs" role="group" aria-label="Пример выбора раздела"><button aria-pressed="true" data-tab>Комната</button><button aria-pressed="false" data-tab>Группа</button><button aria-pressed="false" data-tab>Площадка</button></div><label class="inline"><input type="checkbox" checked> Уведомления</label><label class="inline"><input type="checkbox" role="switch" checked> Показывать статус</label><div class="row"><label class="inline"><input type="radio" name="size" checked> Обычный</label><label class="inline"><input type="radio" name="size"> Крупный</label></div><label>Громкость<input type="range" min="0" max="100" value="70"></label></article>
<article><h3>Голосовая комната</h3><p><span class="online"></span> Вечерняя компания <small>· образец</small></p><div class="characters compact">${avatars}</div><div class="row"><span class="badge">${svg('mic')} Квак говорит</span><span class="badge muted">${svg('micOff')} Микрофон выключен</span></div></article>
<article><h3>Сообщения и документы</h3><div class="message"><b>Лиля <small>18:24</small></b><p>Соберёмся вечером? Есть что обсудить.</p><button class="reaction" aria-pressed="false" data-toggle>💜 1</button></div><div class="file">${svg('files')}<div><strong>config.yaml</strong><small>Текстовый документ · 2 КБ</small></div></div><pre><code>room: evening\nfriends: welcome\nvoice: on</code></pre></article>
<article><h3>Уведомления</h3><p class="notice">${svg('check')} Настройки сохранены</p><p class="notice error">${svg('info')} Не удалось подключиться. Повторите попытку.</p><p class="notice">${svg('info')} Выберите устройство ввода в настройках.</p><button class="tooltip">Подсказка<span role="tooltip">Кратко объясняем действие</span></button></article>
<article><h3>Диалог, меню, раскрытие</h3><button id="open-dialog">Открыть диалог</button><details><summary>Настройки комнаты</summary><p>Название, участники и уведомления.</p></details><details><summary>Действия с сообщением</summary><div class="menu"><button>${svg('reply')} Ответить</button><button>${svg('copy')} Копировать</button><button class="error">${svg('trash')} Удалить</button></div></details></article>
<article><h3>Загрузка, пустое состояние, ошибка</h3><div class="skeleton" aria-label="Образец загрузки"></div><p class="empty">${svg('chat')} Здесь начнётся ваш разговор.</p><div class="empty error">${svg('info')} Не удалось загрузить сообщения.<button>Повторить</button></div></article>
</div></section><section id="icons"><h2>Иконки</h2><p>Родная геометрия Квачата. 24 × 24, линия 1.7, скруглённые окончания. Цвет задаётся через currentColor.</p><div class="icons">${Object.keys(
  paths,
)
  .map(
    (name) =>
      `<a href="icons/${name}.svg" download title="Скачать ${name}.svg">${svg(name)}<span>${name}</span></a>`,
  )
  .join('')}</div></section></main>
<dialog id="sample-dialog" aria-labelledby="dialog-title"><form method="dialog"><button class="icon close" aria-label="Закрыть">${svg('close')}</button><h2 id="dialog-title">Вечерняя компания</h2><p>Образец диалога: фокус внутри окна, закрытие по Escape.</p><label>Название<input value="Вечерняя компания"></label><div class="row"><button class="primary">Сохранить</button><button>Отмена</button></div></form></dialog><script src="kit.js"></script></body></html>`;
fs.writeFileSync(path.join(output, 'index.html'), html);
fs.copyFileSync(path.join(__dirname, 'cosmic-kit.css'), path.join(output, 'kit.css'));
fs.copyFileSync(path.join(__dirname, 'cosmic-kit.js'), path.join(output, 'kit.js'));
console.log(
  `Cosmic kit: ${Object.keys(paths).length} icons, tokens and component catalogue → artifacts/cosmic-kit/index.html`,
);
