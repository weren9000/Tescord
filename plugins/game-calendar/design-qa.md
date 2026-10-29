# Banner card review

final result: passed

Target: the approved desktop/mobile image-led card concept from 2026-10-29.
Reference: `artifacts/game-calendar/banner-reference.png` (workspace artifact).
Rendered comparisons: `artifacts/game-calendar/banner-card-1440.png`,
`banner-card-390.png`, `banner-card-320.png`; browser scale factor 1.
The reference is a presentation canvas; comparison uses its individual card regions,
not the surrounding labels or canvas whitespace.

- Layout: full-card artwork, controls at top, title and metadata below; no separate thumbnail.
- Typography: existing system font; 30px desktop and 25px mobile title; readable wrapping.
- Colors: existing dark palette, white title, translucent controls and gradient scrim.
- Images: real cached VK artwork, proportional cover crop; avatars retain their aspect ratio.
  Artwork intentionally differs from the illustrative mock because the original VK image is used.
- Content: original event title, status, region, complete dates, organizer; no invented information.
- Interaction: favorites, filters, detail dialog, Escape and ICS export pass browser checks.
- Responsive: 320, 390, 768 and 1440px checks pass; long titles, missing dates and failed images remain usable.
- No blocking visual findings remain. Existing dialog layout is unchanged.
