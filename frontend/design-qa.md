# Applications menu — design QA

final result: passed

## Reference and scope

Source: user-selected catalogue mockup (1536 × 1024), generated image
`exec-64302025-6dbe-46fa-85bf-e565fa39e4f4.png`, attached in the conversation.
Implementation: existing Angular Applications dialog, catalogue selected, calendar enabled.
The approved plan retains launch-only tiles in My applications and toggle rows in Catalogue.
Only the existing calendar is listed; the three illustrative applications are not shipped.

## Visual evidence

Screenshots are local test artifacts under `.local/applications-ui/` at repository root:

- `applications-Application-connections-at-1440px/catalog-1440.png`
- `applications-Application-connections-at-393px/mine-393.png`
- `applications-Application-connections-at-320px/catalog-320.png`
- `applications-Application-connections-at-320px/light-catalog-320.png`
- Each viewport also has mine, catalogue, long-catalogue and light-catalogue screenshots.

Browser viewports: 1440, 393 and 320 CSS px wide × 850 high; long-list/light states
use height 568. Device scale factor 1. Desktop dialog screenshot is 860 × 236 px;
mobile captures are full-width, full-height dialogs. Reference and rendered desktop
dialog were opened together for comparison. Reference has four illustrative rows;
implementation has one real row, so overall heights intentionally differ. Comparison
uses section/row structure rather than claiming a pixel-identical full-screen match.
The desktop element capture makes icons, type and switches readable without an extra crop.

## Findings

No actionable P0/P1/P2 findings in the approved scope.

- Typography: existing application font, 22 px title, 16 px row title, 14 px description
  (12 px on mobile). Long names wrap without displacing the switch.
- Layout: joined navigation buttons, aligned icon/text/switch columns, row dividers.
  Desktop height follows content; mobile uses the existing full-screen dialog pattern.
  Header stays in place while a long catalogue scrolls independently.
- Tokens: existing palette variables retained, including user theme overrides.
  Purple indicates selection; inactive switches remain grey. The reference's navy tint
  and enlarged presentation typography are adapted to the existing product palette/density.
- Assets: existing shared calendar and close icons, no added icon libraries or raster assets.
- Copy: short descriptions only. No synchronization/device boilerplate or fictional apps.

## Interaction verification

Three Playwright scenarios passed with isolated API fixtures (no production data):
loading, empty list, connecting, pending-request lock, launch in another tab, disconnecting,
rollback after failed save, keyboard Space, Escape, reopening with persisted fixture state,
failed initial load and retry. Clicking a row title does not change its connection.
My applications contains no switches. Long-list and horizontal-overflow assertions passed
at all three widths. No uncaught browser errors.

Lint: zero errors, two pre-existing lifecycle warnings in unrelated components.
Format check and production build passed. Live backend persistence was not exercised;
the existing persistence service and backend were unchanged.

## Comparison history

First rendered comparison passed. Test setup fixes addressed early Angular debug API
availability, menu locator scope and waiting for save completion; no application defect
or visual change was hidden by those fixes. Final screenshots reflect the passing run.

## Implementation checklist

- [x] Launch tiles and connection switches live in separate tabs.
- [x] Catalogue rows match the selected hierarchy using existing UI tokens.
- [x] Small screens, long content, loading, failures and light palette inspected.
- [x] Local browser scenarios, build, lint and formatting verified.

## Follow-up polish

None required. Future applications need their own registered icons and launch destinations.
