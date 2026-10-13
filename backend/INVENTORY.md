# Collectible catalog

Migration `20261013_0028` seeds the 21 existing catalog entries using their original IDs. Ownership, equipment and event rows stay unchanged. The catalog is stored in `inventory_catalog`; hiding an entry prevents new grants but preserves existing instances and gifting.

`GET /api/inventory`, `/catalog` and `/issued` return `items`, `total`, `page`, `pages`, `page_size`. Pages contain at most 20 entries. They accept `page`, `kind` (`avatar` or `frame`) and `q`. Issued search matches item name, owner nickname or exact email. Inventory also returns notifications and all `equipped_ids`, independently of pagination.

Avatar administrators can POST multipart `/api/inventory/catalog` (`name`, `kind`, `image`, optional normalized `crop_x`, `crop_y`, `zoom`) and PATCH `/catalog/{id}` (`name`, `hidden`). Uploaded images must be static PNG/JPEG/WebP, at most 10 MiB and 128–4096 pixels per side. Frames must be square with a transparent central 40% region. Files are decoded, metadata removed and converted to 512-pixel WebP. Avatar crop positioning selects a square within the original; zoom ranges from 1 to 3.

Custom assets use server-generated UUID filenames under `TESCORD_UPLOADS_DIR/collectibles`. The existing shared-storage backup includes this directory; deployments must retain the shared uploads location. Bundled assets remain under `app/assets/collectibles`. Renaming or hiding never rewrites image files. Uploaded animation and SVG are not supported; the existing built-in neon animation remains available.

Deploy backend and frontend together because paginated catalog/issued responses replace the former arrays. Apply migrations before starting the new backend. Roll back code and database using the pre-deployment backup if necessary: the previous backend cannot render newly uploaded catalog entries.
