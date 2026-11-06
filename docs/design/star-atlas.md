# Третий стиль — «Звёздный атлас»

Утверждённый [референс оформления](star-atlas/reference.png). Самостоятельный стиль в меню **Оформление → Стиль приложения**. «Эмаль» и «Созвездие» сохраняются; новый выбор хранится на устройстве как `star-atlas` в `kva.interface-style.v1`.

## Материалы и цвета

- Индиго `#10121c` и `#171c3b` — навигация, обложки панелей, шапка разговора и управление звонком.
- Бумага `#f5e7cf` / `#fbf0dc` — переписка, списки, окна, каталог и поля. Тёмные чернила `#191a35` и вторичный текст `#655c70`.
- Фиолетовый `#754bff` — основное действие и текущий раздел. Исходящие сообщения — светло-лиловые `#e0cef1` с тёмным текстом. Красный сохраняет значение опасного действия.
- Полный SVG-набор использует простые силуэты с прорезями компасных звёзд, без мелких сюжетов и текстуры. На бумаге — чернила `#4b386b`, на тёмных обложках — слоновая кость `#f5e7cf`. Маленькие действия наследуют цвет кнопки для правильного контраста.
- Поверхности матовые, бумажная фактура слабая. Размеры, расположение элементов и шкала скруглений приложения сохраняются. Иллюстрация не располагается под текстом сообщений; пользовательские обои не заменяются.

## Источники

- `frontend/src/_star-atlas.scss` — палитры бумажных и тёмных областей, материал и выбор SVG для светлых/тёмных поверхностей. Общий сброс эмалевых материалов переиспользуется из `_constellation.scss`.
- `frontend/src/app/shared/atlas-glyphs.ts` — единый источник 77 форм навигации, меню, чата, звонков и служебных действий. `node scripts/build-atlas-icons.cjs` из `frontend` экспортирует их в `public/assets/star-atlas/`: обычный файл для бумаги и `-night.svg` для тёмной навигации. `UiIconComponent` и `PaintedGlyphComponent` используют те же пути, прозрачные вырезы `evenodd` и цвет текущего элемента.
- `icons.png` — сохранённый исходный рисованный набор. В текущем интерфейсе заменён отдельными SVG для читаемости при 24–32 px. Логотип и пользовательские аватары не заменяются.
- `lake.png` — самостоятельная иллюстрация пустого экрана, созданная imagegen по утверждённому референсу. Не используется как логотип или пользовательский аватар.
- `paper.svg` — процедурная слабая фактура бумаги; `blank.svg` — прежняя прозрачная подложка растрового набора, больше не используется навигацией.

Первая колонка использует `shared/_compact-navigation.scss`, как «Созвездие» и «Тихое болото»: пункты 52/44 px, значки 28/24 px в зависимости от высоты окна. На проверенных высотах 540–1080 px все пункты, включая профиль и админку, помещаются без прокрутки. На очень низких окнах сохраняется резервная прокрутка для доступа ко всем действиям.

Промпт иконок: transparent square sprite sheet, exact 4×4 equal cells, each icon centered, vintage hand-inked astronomical atlas, ivory/violet/sage, dark navy contours with cream outer keyline, consistent simplified engraving, no text/background/shadows, sixteen named navigation and account actions. Референс: `reference.png`.

Промпт иллюстрации: vintage illustrated astronomical field journal, midnight indigo lake and sky, cream constellation lines, violet irises, sage reeds, friendly frog in purple scarf and cream explorer coat observing through a telescope on the right, quiet left half for text, printed grain, no logo/text/UI. Референс: `reference.png`.

## Проверки и границы

`star-atlas-style.spec.ts` проверяет переключение через меню, сохранение, черновик, бумажную палитру, светлые SVG навигации и возврат к эмали на 320/393/1024/1440 px. Высоты первой колонки проверяются от 540 до 1080 px, зоны нажатия — не меньше 44 px. `atlas-icons.spec.ts` сверяет SVG с единым источником и снимает набор на бумаге и тёмной поверхности при 24/32 px. Остальные стили проверяются своими сценариями.

Общую серию можно запускать с `KVA_INTERFACE_STYLE=star-atlas`. Независимые приложения в iframe, системные окна и отдельные установщики не изменяются этим Angular-слоем. Инвентарная тема не сбрасывается и вновь используется после возврата к эмали.


## Icon readability refinement ? 2026-11-06

Search uses a plain magnifier; pin uses a recognisable pushpin. Friends and groups use two and three large silhouettes without tiny cutouts. Platforms use connected nodes, inventory uses a chest with a latch, and administration uses a shield with a keyhole. Muted sound uses a diagonal slash. Atlas favours angular geometry; Constellation retains celestial shapes; Quiet Marsh favours soft rounded forms. Shared navigation commands remain familiar. Enamel is unchanged.

Sources and SVG exports must stay in sync through the existing build-*-icons.cjs scripts. Inspect at 16, 20, 24 and 32 px as well as desktop and mobile layouts.
