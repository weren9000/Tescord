# Call volume controls — 2026-10-27

Windows 0.5.15 and Android 0.3.18 (versionCode 22) include the call-volume fixes and visible audio controls.

- The expanded call and compact tray expose a 0–100% output slider, percentage and local mute button.
- Muted output and zero volume show “Звук выключен”. The sound button restores output; toggling mute at a nonzero level preserves that level. Restoring from zero selects 100%.
- The participant list exposes a personal slider and local mute next to each remote participant. Self-volume is not offered. Personal silence is also marked on the participant tile.
- The participant list stays inside the viewport on narrow screens.

Validation: 21 targeted Angular tests; production frontend build; actual Angular UI fixture at 1440, 393 and 320 pixels for direct/group calls and expanded/compact panels, mouse/keyboard interaction, mute restoration and participant volume. The fixture uses audio elements without live remote media.

The packaged Windows client passed its smoke test (bundled UI, production API, isolated profile, session storage, screen-capture cancellation and tray). Android browser integration passed (bundled UI, native-bridge fixture, production CORS, mobile layout, capture cancellation/retry).

Android `assembleRelease` and `lintDebug` succeeded. The available signing key differs from the published 0.3.17 certificate: previous SHA-256 is `7494555d52781f9e9db1e82f03a69332eb16083fa74aaa016ac5e04f7ecd4d3d`; 0.3.18 SHA-256 is `bc7841039b697ea7fc42cbcdb4814fc7839291ee7a154fafbcf761a9c091d650`. The owner authorized releasing a new APK with this key. This is not an in-place upgrade from 0.3.17: uninstall/reinstall and sign-in are required. The download page states this explicitly. Server-stored messages remain, but local preferences and unsaved application data can be lost.

No physical Android device was connected. Live call audibility, Bluetooth and hardware volume keys have not been verified by these checks. Windows installer remains unsigned by a publisher.

Source is based on the deployed `fix/call-volume-production` branch, preserving its features rather than replacing it with the older `main` tree. Deployment retains the previous release and existing versioned downloads.
