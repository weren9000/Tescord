# Mobile vertical event list — 2026-10-30

Approved direction: compact full-width mobile cards, vertically scrolling events and a fixed horizontal date strip. Desktop retains the existing two-column layout.

## Implemented

- Removed event carousel controls, counter, snap scrolling, height observer and horizontal-position state.
- Mobile events stack vertically with 10px gaps; no space is reserved between short and tall cards.
- Wide covers fill illustrated cards, with titles and metadata over a readability scrim.
- Missing artwork uses a compact text card. Full descriptions and organizer information are in event details.
- Dates retain independent horizontal scrolling in the bottom layout area.
- Selecting a date resets event scroll; favorites and closing details preserve the current scroll position.
- Thumbnail clicks in the date strip select the day without opening an event.

## Evidence

Real-data snapshots, October 30, eight events, Chromium scale factor 1:

- artifacts/game-calendar/mobile-vertical-393.png — 393 × 852.
- artifacts/game-calendar/mobile-vertical-500.png — 500 × 1000.
- artifacts/game-calendar/mobile-vertical-320.png — 320 × 568.

Reviewed card wrapping, cover crops, missing-image behavior, consistent gaps and bottom navigation. Real artwork and metadata differ from illustrative mockups. Remaining space after the final event is intentionally not filled with fabricated content.

## Verification

Browser checks cover vertical event scrolling, absence of horizontal event overflow and carousel controls, last-card reachability above the dock, new-day scroll reset, thumbnail selection, date ranges, favorites, filters, persistence, details, ICS and error states.
Widths: 320, 360, 393, 430, 768, 959, 1024, 1536; short mobile height 568.
Image regression checks cover loading, failure and missing artwork.
No backend or synchronization changes. Physical-device touch behavior remains outside local browser emulation coverage.

final result: passed
