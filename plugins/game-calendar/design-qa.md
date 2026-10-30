# Calendar redesign verification — 2026-10-30

Source: the two user-selected desktop/mobile concepts attached immediately before implementation.
Desktop concept: exec-63afbb44-5b38-4560-978c-f7d1d8ee03f0.png (1536 × 1024).
Mobile concept: exec-395f3338-f778-4d89-9e91-e326dea21e56.png (866 × 1814).

## Implemented composition

- Desktop: viewport-height month grid on the left and independently scrolling events on the right.
- Mobile: compact header and search, detailed horizontal carousel, month/day navigation in its own bottom flex area.
- Each calendar day is one native button. Its thumbnails are non-interactive images; every click selects the day.
- Inclusive date ranges, correct variable month row count, all mobile month days, date picker and Today.
- Existing KvaChat icon geometry is reused for shared actions; no icon font or new UI dependency.
- Source attribution and sync time are available in the information dialog.

## Evidence

Browser-rendered local snapshots (device scale factor 1):

- artifacts/game-calendar/redesign-desktop.png — 1536 × 1024, October 22, real cached data.
- artifacts/game-calendar/redesign-mobile.png — 393 × 852, same date, second event in carousel.
- artifacts/game-calendar/redesign-small.png — 320 × 568, confirms accessible bottom navigation.
- artifacts/game-calendar/redesign-fixture-{width}.png — 320, 360, 393, 430, 768, 959, 1024, 1536.

The source concepts use illustrative artwork and invented descriptions. Actual data has different artwork, long titles, missing covers and almost no descriptions. Missing content is not synthesized and does not reserve empty image/description space. Mobile covers use a shallower crop than the concept to preserve more of the long VK artwork. Existing system typography and product palette are retained.

## Visual review and fixes

- Compared desktop regions: header, column ratio, aligned panels, month toolbar, selected date, cover cards.
- Compared mobile regions: header/search, date heading, cropped adjacent card, metadata/actions, anchored day navigation.
- Fixed native button background exposed after removing obsolete calendar styles.
- Fixed weekday alignment after removing the old grid styles.
- Replaced fixed-height empty artwork with compact text cards.
- Carousel height follows the currently visible card, including image failure and description expansion.
- At short viewport heights the content scrolls above the navigation; no controls are hidden behind it.
- Cover imagery remains original; avatar artwork is contained rather than stretched.
- Text wraps within cards and dialogs. Small date previews expose their full event count through accessible labels.

## Functional verification

Automated browser checks cover:

- thumbnail click selects the day and does not open details;
- inclusive multi-day events and month boundaries;
- desktop details, safe description text, VK link and ICS end-date semantics;
- mobile carousel scrolling and non-opening card cover;
- favorite persistence and restoring a non-current selected date;
- filters/search, undated events, month navigation with an active period filter;
- Escape dismissal, empty/stale/error/retry states;
- overflow and dock bounds at widths 320–1536.

Image regression checks pass. All 18 isolated Python tests pass.
No browser page exceptions in the real-data captures.
Physical-device touch/keyboard behavior has not been tested; mobile checks use Chromium viewport emulation.
The previous report's unsupported full-fidelity claim is superseded by this scoped report.

final result: passed
