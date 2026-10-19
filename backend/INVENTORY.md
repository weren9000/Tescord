# Collectible catalog

Migration `20261013_0028` seeds the 21 existing catalog entries using their original IDs. Ownership, equipment and event rows stay unchanged. The catalog is stored in `inventory_catalog`; hiding an entry prevents new grants but preserves existing instances and gifting.

`GET /api/inventory`, `/catalog` and `/issued` return `items`, `total`, `page`, `pages`, `page_size`. Pages contain at most 20 entries. They accept `page`, `kind` (`avatar`, `frame` or `wallpaper`) and `q`. Issued search matches item name, owner nickname or exact email. Inventory also returns notifications and all `equipped_ids`, independently of pagination.

Avatar administrators can POST multipart `/api/inventory/catalog` (`name`, `kind`, `image`, optional normalized `crop_x`, `crop_y`, `zoom`) and PATCH `/catalog/{id}` (`name`, `hidden`). Uploaded images must be static PNG/JPEG/WebP, at most 10 MiB and 128–4096 pixels per side. Frames must be square with a transparent central 40% region. Files are decoded, metadata removed and converted to 512-pixel WebP. Avatar crop positioning selects a square within the original; zoom ranges from 1 to 3.

Custom assets use server-generated UUID filenames under `TESCORD_UPLOADS_DIR/collectibles`. The existing shared-storage backup includes this directory; deployments must retain the shared uploads location. Bundled assets remain under `app/assets/collectibles`. Renaming or hiding never rewrites image files. Uploaded animation and SVG are not supported; the existing built-in neon animation remains available.

Deploy backend and frontend together because paginated catalog/issued responses replace the former arrays. Apply migrations before starting the new backend. Roll back code and database using the pre-deployment backup if necessary: the previous backend cannot render newly uploaded catalog entries.

## Chat wallpapers

Migration `20261013_0029` adds wallpaper catalog entries and account wallpaper choices. Migration `20261014_0034` separates profile, shared conversation and personal override settings. Ten bundled wallpapers under `app/assets/wallpapers` are freely available; the default is no wallpaper.

`GET /api/wallpapers` returns presets, owned wallpaper instances, the profile selection, scale and dimming. `PUT /api/wallpapers` accepts `selected` (null, a preset ID or `item:<instance UUID>`), `scale` (50–200) and `dim` (0–85). This is the background other users see in direct conversations with this user. Existing selections are preserved. Choosing an inventory instance verifies ownership and equips it; choosing another source unequips wallpaper items. Gifting, revoking or unequipping an active wallpaper resets the sender's profile background to none. Recipients apply gifts themselves.

`GET /api/wallpapers/chats/{server_id}` requires membership and returns picker choices plus `context`: shared background, personal override, effective background with its asset URL, source and owner permission. Direct conversations inherit the peer's profile; groups and platforms inherit their independently selected shared background. All channels of a platform use the same server setting. `PUT` on this route accepts the same selection with `target: personal | shared` and `inherit`. Only the actual group/platform owner can modify `shared`; direct conversations reject this target. Personal overrides belong to the viewer's membership. An explicit null selection means no background, while `inherit: true` removes the override. Scale and dimming follow the selected scope. These choices are stored in the database and shared across devices.

Displaying another user's item never grants ownership. Every selection validates the selecting user's inventory; shared item assets are resolved against the current server owner and personal assets against the viewer. Gifting/revoking wallpaper items clears all references from shared settings and personal overrides in the inventory transaction, even if the item is not equipped as the profile wallpaper. Missing or no-longer-owned items safely fall back to the inherited/standard background.

Personal wallpaper uploads and selection are disabled: `POST /api/wallpapers/personal` and selecting `personal` return 403. Previously selected personal backgrounds resolve to no wallpaper; old files remain stored. Users can select only bundled backgrounds or wallpaper items they own. Avatar file uploads through `/api/me/profile` require the avatar administrator role; ordinary users retain preset selection and inventory avatars. Previously uploaded avatars remain intact.

Administrators upload wallpaper items through the catalog, using existing grant, gift, history and revoke endpoints. Wallpaper images preserve aspect ratio, are limited to 2048 pixels per side and converted to WebP.

The chat menu and main menu open the wallpaper picker with scope selection, preview, scale and dimming controls. The background covers the message area, with readable message surfaces. Clients clear the old background on conversation switches, discard stale responses, refresh after inventory changes, and poll every 15 seconds while the picker is closed and the page is visible. Returning to the tab also refreshes the background. Deploy both applications together and include both upload directories in backups.

## Transferable interface themes

Migration `20261013_0030` introduces `kind=theme` and five built-in catalog entries: `theme-light`, `theme-dark`, `theme-space`, `theme-cyberpunk`, `theme-viking`. No items are automatically granted. The original base theme is free and always available. Theme definitions and SVG thumbnails are curated in `app/services/themes.py`; arbitrary theme uploads are not accepted.

Themes use the existing grant/equip/unequip/gift/revoke operations and history. At most one non-revoked theme instance can be equipped per owner. A gift or revoke unequips it; the previous owner falls back to the base theme and the recipient must explicitly equip the gift. Theme changes do not affect avatars or wallpaper selection.

Authenticated `GET /api/inventory/theme` resolves the current theme from owned, equipped inventory instances, returning its ID, item ID, color scheme and semantic palette. Without an equipped theme it returns a null ID and empty palette. `POST /api/inventory/theme/reset` with a request UUID unequips the current theme without deleting the item. Theme thumbnails are public display assets and confer no ownership.

The frontend applies semantic CSS variables to the document, refreshes after inventory actions, every ten seconds and when the tab becomes visible. It clears the theme on logout/account changes and ignores stale responses. Temporary network errors retain the last verified appearance. Inventory and admin tabs include themes; the inventory provides a thumbnail preview and a base-theme reset. Database and frontend/backend changes must deploy together; downgrade with owned themes requires the pre-deployment backup.

Migration `20261013_0031` adds five more catalog themes without granting any instances: Sakura (`theme-sakura`), Emerald (`theme-emerald`), Ocean (`theme-ocean`), Amber (`theme-amber`) and Lavender (`theme-lavender`). Sakura and Lavender use the light color scheme. The frontend exposes `data-ui-scheme` alongside the selected theme ID so light-scheme logo treatment also applies to these themes; the existing logo is rendered with a dark wordmark and cyan accents using CSS filtering and blending.

## Коллекционные обои — 20261014_0032

Добавлены 20 обоев из пользовательских вложений: мятные зверята, игровой мир,
лес, фэнтези, космос, магия, рыцари, викинги, пираты, алхимия, тактическая арена,
варианты колдовства и киберпанка, ферма и эльфийские узоры.
Идентификаторы и названия: `app/services/collectible_wallpapers.py`.
Исходные PNG сохранены без изменений в `app/assets/collectibles/wallpaper-*.png`.
Миграция создаёт только записи каталога типа `wallpaper`, без автоматической выдачи.
Они доступны администратору аватарок для выдачи; получатель может применить или
подарить предмет. В бесплатные базовые обои эти изображения не включены.

## Кошелёк — 20261019_0044

Монеты (`coins`) и кристаллы (`crystals`) хранятся как целые числа в пользователе;
начальный баланс — ноль. Баланс доступен владельцу через `GET /api/wallet`,
история разбита на страницы по 20 операций. Публичные профили балансы не раскрывают.

Системный администратор (`is_admin`, не `is_avatar_admin`) видит кошелёк через
`GET /api/admin/wallets/{user_id}` и изменяет его через
`POST /api/admin/wallets/{user_id}/adjust`. Обязательны UUID `request_id`, валюта,
действие `credit`/`debit`, целая сумма 1–1 000 000 000, причина и `expected_balance`.
Если баланс изменился после предварительного просмотра, сервер возвращает 409.
Списание ниже нуля запрещено; верхняя граница баланса — 9 000 000 000 000.

Изменение баланса и запись `wallet_operations` коммитятся вместе, строка пользователя
блокируется на время операции. Повтор того же UUID с теми же параметрами возвращает
результат без повторного начисления; изменённые параметры с тем же UUID отклоняются.
Журнал хранит валюту, изменение, итоговый баланс, причину, время и администратора.
Админский интерфейс сохраняет UUID неопределённой операции до повторной проверки,
в том числе после перезагрузки страницы. Баланс в меню обновляется раз в 20 секунд
на видимой вкладке; история загружается при открытии кошелька и по кнопке «Обновить».

Переводы валюты между пользователями, обмен и автоматические награды пока отсутствуют.
Проверки: `tests/test_wallets.py` — права доступа, суммы, история, параллельные
начисления/списания и идемпотентность. Миграция зависит от `20261019_0043` (приглашения).

## Магазин — 20261019_0045

Раздел «Магазин» доступен из основного и мобильного меню, а также из инвентаря.
Аватарки, рамки, обои и темы покупаются исключительно за кристаллы. Каждая покупка
создаёт отдельный экземпляр, который можно применять и дарить. Продажи пользователями
и обмен на валюту отсутствуют. Миграция не публикует предметы и не назначает цены.

У системного администратора в магазине доступны «Предложения», «Покупки», «Журнал»
и «Права». Чтобы открыть продажи: выбрать предмет в «Предложениях», задать целую цену
1–1 000 000 000 и статус «В продаже». Черновики, снятые предложения и скрытые записи
каталога не отображаются на витрине. Уже полученные экземпляры сохраняются.
В «Правах» можно найти пользователя и дать/забрать `is_shop_admin`. Это право управляет
ассортиментом и ценами, но не кошельками и не назначением прав. Роль `is_avatar_admin`
сама по себе доступа к управлению магазином не даёт.

`GET /api/shop` — категории, поиск, сортировка, фильтр отсутствующих предметов,
пагинация по 20. `PUT /api/shop/admin/offers/{catalog_id}` проверяет версию предложения,
записывает старое/новое состояние и администратора в `shop_audit`.
`GET /api/shop/admin/purchases` показывает неизменяемые чеки с ценой на момент покупки.

`POST /api/shop/purchases`: UUID `request_id`, `catalog_id`, `expected_price`,
`offer_version`. Под блокировкой инвентаря проверяется предложение, под общей с
кошельком блокировкой строки пользователя списываются кристаллы. Предмет, событие,
операция кошелька и чек сохраняются одной транзакцией. Изменившаяся цена/версия,
скрытие предложения и нехватка средств дают 409 без списания. UUID повторной операции
возвращает исходный чек, изменённые параметры с тем же UUID запрещены.

Клиент сохраняет подтверждённую покупку в localStorage отдельно для каждого аккаунта.
При потере ответа проверяет `GET /api/shop/purchases/{request_id}`; если чек ещё
не найден, повторяет исходный запрос с тем же UUID. Остаток в чеке — исторический,
текущий баланс загружается из кошелька. Права на чек проверяются по покупателю,
даже после передачи предмета другому пользователю.

Инвентарь использует `grouped=true`: одинаковые предметы объединяются ДО пагинации.
Выбор экземпляра для подарка предпочитает неиспользуемый; учитываются также личные
обои, переопределения бесед и общие обои собственных групп/площадок. Фильтр «Используются»
включает эти обои. Сортировка по получению учитывает выдачи, покупки и подарки.
Из просмотра обоев открывается существующий выбор области применения с выбранным предметом.

Проверки: `tests/test_shop.py`, `tests/test_inventory.py`, `tests/test_wallets.py`.
Браузерная проверка включает изменение цены, покупку, применение, потерю ответа,
повторное открытие, подарок свободного дубля, темы, предпросмотр, права и журнал.
