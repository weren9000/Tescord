# Тихое болото

Четвёртый самостоятельный стиль приложения. Основа — вариант 3 на [согласованном листе концептов](quiet-marsh/reference.png). Уточнение пользователя: иконки должны уверенно распознаваться. Поэтому декоративные миниатюры заменены простыми двухцветными SVG-силуэтами.

Выбор: **Оформление → Стиль приложения → Тихое болото**. Значение `quiet-marsh` сохраняется на устройстве в `kva.interface-style.v1`. Эмаль остаётся стилем по умолчанию; остальные стили и инвентарная тема сохраняются.

## Цвет и материалы

- Фон `#101b1a`, поверхности `#182623`, приподнятые элементы `#243630`.
- Основные действия: шалфей `#a7c7ac`, тёмный текст `#10231b`.
- Основной текст `#f0eee3`, вторичный `#bdc9c0`, границы `#668177`.
- Выбор раздела `#344e42`; исходящее сообщение `#493f56` с кремовым текстом.
- Матовые панели, тонкие границы, без эмалевых бликов. Сохраняются размеры и радиусы общего интерфейса.
- Растительный декор — только низ навигации и свободный экран. Под текстом переписки рисунка нет. Пользовательские обои и аватары не заменяются.

## Значки

Актуальный [полный набор](quiet-marsh/icons-reference.png): шалфейные силуэты с прорезями-листьями, лиловые акценты, смайлик-лягушка. Без текстур, объёма и мелкой ботанической иллюстрации. Сетка 24×24, линия 2 px у линейных действий. Прорези прозрачные (`evenodd`), читаемые на выбранном фоне.

Комната — дом; друзья — две фигуры; группы — три фигуры; площадки — связанные узлы; предметы — сундук; приложения — четыре плитки; админка — щит с замком; поиск — лупа; события — колокольчик; меню — три полоски. Остальные действия используют знакомые фигуры профиля, изображения, динамика, запрета, выхода и загрузки. Подписи, доступные названия и зоны нажатия сохраняются. Оригинальный логотип не меняется.

`frontend/src/app/shared/botanical-glyphs.ts` — единый источник для `UiIconComponent`, `PaintedGlyphComponent` и 77 SVG (согласованный набор плюс дополнительные служебные действия). Экспорт: `node scripts/build-botanical-icons.cjs` из `frontend`. Навигационные SVG находятся в `frontend/public/assets/quiet-marsh/`. Формы созданы в коде; это не нарезка растрового референса. Маленькие действия наследуют контрастный цвет кнопки; иллюстративные SVG навигации используют шалфей и лиловый. Другие стили сохраняют свои наборы.

Первая колонка использует общий миксин `shared/_compact-navigation.scss`, как «Созвездие»: кнопки 52/44 px и значки 28/24 px в зависимости от высоты окна. При высоте от 540 px весь набор пунктов с админкой помещается без прокрутки. На экстремально низких окнах прокрутка остаётся доступной. Логотип и аватары не заменяются.

## Иллюстрация

`lake.png` создана imagegen: quiet marsh at dusk, vintage matte botanical illustration, charcoal green, sage reeds and lavender lilies, small friendly frog on the right, calm empty left area, no text/logo/UI. Используется на пустом экране. `reeds.svg` — отдельный слабо контрастный растительный орнамент, созданный в коде.

## Проверка

`quiet-marsh-style.spec.ts`: переключение, сохранение после перезагрузки, черновик, возврат к эмали, размеры 320/393/1024/1440 px, высоты первой колонки 540–1080 px, зоны нажатия от 44 px. `botanical-icons.spec.ts` сверяет SVG с единым источником и снимает весь набор при 24/32 px. Для общей серии тестов: `KVA_INTERFACE_STYLE=quiet-marsh`.

Это слой оформления Angular. Независимые приложения в iframe и системные окна упаковок имеют собственное оформление.


## Icon readability refinement ? 2026-11-06

Search uses a plain magnifier; pin uses a recognisable pushpin. Friends and groups use two and three large silhouettes without tiny cutouts. Platforms use connected nodes, inventory uses a chest with a latch, and administration uses a shield with a keyhole. Muted sound uses a diagonal slash. Atlas favours angular geometry; Constellation retains celestial shapes; Quiet Marsh favours soft rounded forms. Shared navigation commands remain familiar. Enamel is unchanged.

Sources and SVG exports must stay in sync through the existing build-*-icons.cjs scripts. Inspect at 16, 20, 24 and 32 px as well as desktop and mobile layouts.
