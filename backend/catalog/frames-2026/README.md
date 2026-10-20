# Avatar frames — October 2026

30 static transparent frames in six collections: elements, forest, dark fantasy,
space, technology and jewels. Five items per collection; prices 100–900 crystals.
Rarity counts: 4 common, 8 uncommon, 9 rare, 6 epic, 3 legendary.

Assets are 512×512 WebP with alpha. The importer warms 256px previews. PNG masters
are preserved outside Git in `../Backups/frames-2026-originals` relative to the
repository root. `prompts.json` records the imagegen generation/edit instructions.
`preview.html` shows all assets over an avatar, including a 44px light-background
sample. Moon, mushrooms, lich crown, eclipse and amethyst were regenerated with a
wider transparent aperture.

Run from `backend`, with the application environment loaded:

```sh
for group in elements forest dark space tech jewels; do
  PYTHONPATH=. .venv/bin/python scripts/import_collection.py \
    --manifest catalog/frames-2026/$group.json --apply || exit 1
done
```

Without `--apply` the importer validates the assets and metadata. Existing
catalog entries, offers, purchases and collection settings are preserved.
IDs are UUIDv5 under `https://kvachat.ru/catalog/frames-2026/`.

The generated circular-aperture registries in `app/services/circular_frames.py`
and `frontend/src/app/workspace/circular-frames.ts` contain these 30 item IDs.
They keep server avatar composition and client fitting previews consistent;
older frames retain their existing aperture.

Validation: all 30 centers transparent, original PNGs preserved, visual review
on dark/light backgrounds and at 44px, frontend production build. Verify six
collections and one purchase/equip on an isolated database before publishing.
