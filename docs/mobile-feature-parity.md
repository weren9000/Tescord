# Mobile feature availability

Reviewed 2026-10-16. Compare the same account and membership role on both layouts.
Screen width must not determine permission to perform an action.

| Area | Mobile entry point | Verification |
| --- | --- | --- |
| Group invitation, members, files, search | Conversation header → ⋯ | Shared `workspaceQuickActions` template with desktop header; browser comparison at 320, 390, 430, 844 and 1280px |
| Platform invitation and members | Active channel header → ⋯; platform menu | Same permission predicates as desktop |
| Group/platform icon | Conversation information → Change icon; group header avatar | Removed viewport check in permission and file picker; owner picker and ordinary-member absence checked |
| Messages | Visible ⋯, long press, swipe to reply | Reply/copy/reaction menu available without hover; reply tested |
| Attachments | Attachment card; Files in conversation menu | Existing download/delete authorization preserved |
| Calls | Expand call → call menu | Camera, screen share, sound/devices and channel management; unsupported screen capture gets an explanation |
| Profile, inventory, appearance, sound, blocks | Main menu | Existing routes retained; inventory and appearance opened in browser |
| Administration | Main menu → Admin | Tabs wrap instead of overflowing; users/groups/platforms/statistics/items checked on narrow screens |
| Creation of groups/friend requests/platforms | Bottom of corresponding list | Existing create actions retained |

Invitations: creation, clipboard copy, native share handoff (mocked browser API), public
preview and revocation tested against the local API. `/invite/:code` is accepted by the
Angular router; the app handles preview and authentication. Ordinary members do not
receive owner actions. No backend permissions were widened.

Regression: `scripts/check-mobile-parity.py` uses a seeded **local** environment and
Playwright/Edge. Its frontend server must provide an index.html fallback for invitation
and channel URLs, matching nginx. See the script for fixture format. Angular tests
include direct invitation navigation.

Limitations: browser viewport/touch emulation is not a physical Android/iOS device.
OS share sheet and physical audio device switching need device testing. Browser APIs
may limit screen capture/output-device selection; these capabilities must be detected,
not inferred from screen width. Editing/deleting message text is not currently offered
by either layout and was not introduced by this parity change.

For new actions: add desktop shortcuts and mobile menu entries from the same template
or action definition. Never hide the only entry point with a responsive CSS rule.
