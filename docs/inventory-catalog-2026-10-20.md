# Inventory catalogue update

The embedded inventory now follows the storefront layout: desktop sidebar,
six-column cards, two columns on mobile, draft mobile filters, shared rarity
badges, frame fitting, usage state, copy count and contextual actions. Opening
item details preserves the list and filters. Administrative inventory remains
available with its existing controls.

Inventory API supports `rarity`, `favorites` and `usage=all|used|unused`.
Grouping precedes filtering by usage: a catalogue group with an equipped copy
does not also appear under unused items. Category counts exclude only the active
category restriction. Optional `equipped_only` remains backwards compatible.
NULL personal wallpaper references are normalized to false. Catalogue and actor
metadata are fetched in batches, including notification metadata. The client
cancels superseded inventory reads and reuses private favourite events.

## Images

- `scripts/prepare-catalog-previews.py` generates 102 public catalogue thumbnails
  (approximately 1.6 MB) and a fallback avatar. Originals are preserved.
- The public assets are included in the web build and copied by existing Android
  and Windows packaging scripts. No startup download of the whole catalogue.
- Content-hashed asset names and a generated manifest version invalidate changed
  bundled images. Run the generator when catalogue source artwork changes.
- Visible cards and a 160px margin load on demand. At most four image jobs run at
  once; hidden documents do not start queued jobs. Concurrent identical image
  requests share a promise. Object URLs are revoked when cards change or unmount.
- Cache Storage contains only public inventory thumbnails, up to 160 entries of
  at most 256 KiB each. Entries expire after one hour; an existing cached image can
  be used if the network fails. Restricted WebViews retain normal HTTP caching.
  Profiles, chat attachments, tokens and API JSON are not written to this cache.
- Full-size images load only for detailed previews. Private avatar rendering
  remains on its existing path and is not bundled.

## Validation and releases

Production frontend build; isolated PostgreSQL checks of rarity, favourites,
grouped usage partition and category counts; browser checks at 1440 and 390px
including filters, details, Escape, image loading and repeated tab opening.
Verified frame fitting and theme thumbnails visually. No broad regression suite.

Android 0.3.6 (versionCode 10), signed with the existing release key; APK inspected
for all 102 bundled thumbnails. Windows 0.5.3 NSIS installer built. Installer
checksums verified after upload. Physical-device performance was not measured.
Call services and signalling were not changed.
