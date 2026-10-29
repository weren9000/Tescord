# Calendar mode review

**Comparison target**

- Source visual truth: `C:/Users/admin/Downloads/Frame 71.jpg` — mobile interaction
  direction: filters above the content, month navigation, selected-day events and a
  horizontal day rail. It is a concept image, not a pixel-perfect screen specification.
- Implementation evidence: `artifacts/game-calendar/live-calendar-390.png` and
  `artifacts/game-calendar/live-calendar-1440.png`.
- Viewports: source 851 × 1847 px; implementation mobile 390 × 900 CSS px at
  device scale factor 1; implementation desktop 1440 × 900 CSS px at device scale
  factor 1. No density normalization was required for the implementation captures.
- State: dark theme, upcoming events, October 2026, selected day 1 October.
- Primary interactions tested: layout menu, feed/calendar switching and persistence,
  previous/next/current month controls, selecting a day, opening an event from both
  the month and selected-day cards, mobile week rail, Escape, filters, favourites,
  external VK-community action and the existing ICS export.

**Findings**

- No actionable P0, P1 or P2 findings remain.
- The mobile source puts the control bar near the bottom; the approved product plan
  intentionally keeps filters and month navigation at the top. The mobile day rail is
  sticky at the bottom while scrolling, preserving the direct day-to-events flow.
- Desktop has no direct source mock. It intentionally reuses the same state and event
  cards: selected-day horizontal cover cards first, followed by a seven-column month
  grid. This is the desktop counterpart of the mobile rail rather than a separate flow.

**Required fidelity surfaces**

- Fonts and typography: the existing Inter/system UI stack and the product's existing
  compact control scale are retained. Long event names wrap in the large card and are
  clipped only in dense month banners with an accessible full-event action.
- Spacing and layout rhythm: mobile has one wide, snap-aligned event card; desktop has
  a compact month control group, wide selected-day cards and a seven-column grid.
  No horizontal page overflow was detected at 320, 390, 768 or 1440 px.
- Colors and visual tokens: existing dark canvas, surface, border, purple selection and
  cyan action tokens are used throughout; the selected date is visible in both views.
- Image quality and asset fidelity: cards use the cached, original VK community covers.
  Cover images preserve their crop with a readable dark scrim; missing artwork falls
  back to the regular surface without broken-image chrome.
- Copy and content: controls use accessible icon buttons where space is limited. The
  event detail now has an explicit `Сообщество VK` action when a trusted community link
  exists, in addition to the source and organiser links.

**Focused region comparison**

- Mobile: month controls, selected-day event rail and the sticky week rail were checked
  against the source concept's core interaction regions.
- Desktop: month controls, event-cover rail and dense calendar banners were checked in
  `live-calendar-1440.png`; the desktop layout is an intentional responsive extension.

**Implementation checklist**

- [x] Calendar/list view switcher with accessible labels and a reserved timeline slot.
- [x] Month movement, current-month action, date selection and selected-day event rail.
- [x] Seven-day mobile rail and seven-column desktop month grid from one data state.
- [x] Real VK artwork in the event cards and explicit community link in details.
- [x] Browser and Python regression tests, including 320–1440 px overflow checks.

**Follow-up polish**

- [P3] When event density grows, consider replacing the native month picker fallback
  with a dedicated compact picker; it is not necessary for the current data set.

**Comparison history**

- Iteration 1: the selected mobile day could render at the far edge of its week rail,
  and the desktop current-month action pushed month navigation apart.
- Fix: center the selected date within the scrollable rail when possible and keep the
  month controls in one compact group.
- Post-fix evidence: `artifacts/game-calendar/calendar-390.png` and
  `artifacts/game-calendar/live-calendar-1440.png`.

final result: passed
