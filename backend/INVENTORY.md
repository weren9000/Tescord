# Collectible catalog

Migration `20261013_0028` seeds the 21 existing catalog entries using their original IDs. Ownership, equipment and event rows stay unchanged. The catalog is stored in `inventory_catalog`; hiding an entry prevents new grants but preserves existing instances and gifting.

`GET /api/inventory`, `/catalog` and `/issued` return `items`, `total`, `page`, `pages`, `page_size`. Pages contain at most 20 entries. They accept `page`, `kind` (`avatar`, `frame` or `wallpaper`) and `q`. Issued search matches item name, owner nickname or exact email. Inventory also returns notifications and all `equipped_ids`, independently of pagination.

Avatar administrators can POST multipart `/api/inventory/catalog` (`name`, `kind`, `image`, optional normalized `crop_x`, `crop_y`, `zoom`) and PATCH `/catalog/{id}` (`name`, `hidden`). Uploaded images must be static PNG/JPEG/WebP, at most 10 MiB and 128–4096 pixels per side. Frames must be square with a transparent central 40% region. Files are decoded, metadata removed and converted to 512-pixel WebP. Avatar crop positioning selects a square within the original; zoom ranges from 1 to 3.

Custom assets use server-generated UUID filenames under `TESCORD_UPLOADS_DIR/collectibles`. The existing shared-storage backup includes this directory; deployments must retain the shared uploads location. Bundled assets remain under `app/assets/collectibles`. Renaming or hiding never rewrites image files. Uploaded animation and SVG are not supported; the existing built-in neon animation remains available.

Deploy backend and frontend together because paginated catalog/issued responses replace the former arrays. Apply migrations before starting the new backend. Roll back code and database using the pre-deployment backup if necessary: the previous backend cannot render newly uploaded catalog entries.

## Chat wallpapers

Migration `20261013_0029` adds wallpaper catalog entries and account-wide personal chat appearance. Ten bundled wallpapers under `app/assets/wallpapers` are freely available; the default is no wallpaper. This is a private display preference, never a setting imposed on other conversation participants.

`GET /api/wallpapers` returns presets, owned wallpaper instances, the selected source, personal upload identifier, scale and dimming. `PUT /api/wallpapers` accepts `selected` (null, a preset ID, `personal`, or `item:<instance UUID>`), `scale` (50–200) and `dim` (0–85). Choosing an inventory instance verifies ownership and equips it; choosing another source unequips wallpaper items. Gifting, revoking or unequipping an active wallpaper resets the sender's background to none. Recipients apply gifts themselves.

Personal wallpaper uploads and selection are disabled: `POST /api/wallpapers/personal` and selecting `personal` return 403. Previously selected personal backgrounds resolve to no wallpaper; old files remain stored. Users can select only bundled backgrounds or wallpaper items they own. Avatar file uploads through `/api/me/profile` require the avatar administrator role; ordinary users retain preset selection and inventory avatars. Previously uploaded avatars remain intact.

Administrators upload wallpaper items through the catalog, using existing grant, gift, history and revoke endpoints. Wallpaper images preserve aspect ratio, are limited to 2048 pixels per side and converted to WebP.

The chat menu opens the wallpaper picker with a preview, scale and dimming controls. The background covers the message area, with readable message surfaces. Clients refresh the account preference after inventory changes and periodically when the picker is closed. Deploy both applications together and include both upload directories in backups.
