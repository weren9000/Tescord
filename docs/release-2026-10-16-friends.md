# Android 0.3.0 / Windows 0.5.0

- Personal calls explicitly request echo cancellation, noise suppression and automatic gain control. Group media code is unchanged.
- Android owns communication routing only during a personal call, exposes available outputs in call settings and restores the previous mode on exit. Android 12+ uses available communication devices; Android 10/11 retains system headset routing with a speaker switch.
- Friends receive presence changes regardless of the open chat. Directory and conversation previews update together. Presence reads no longer consume offline transitions before the expiry worker can publish them.
- Android foreground-call service reports activity during calls, including on Android 10, but the notification-only connection does not keep users online.
- Owners/admins can invite existing friends to groups or workspaces. The recipient accepts or declines in Notifications. Invitations expire after seven days. Friendship, blocking, current inviter permissions and the group limit are checked server-side.
- APK routes supported kvachat.ru links into its existing WebView session. HTTPS app-link verification uses the existing APK signing certificate in `/.well-known/assetlinks.json`. Windows opens internal chat/invite links in the client and serves all application routes from the bundled frontend.
- Temporary bootstrap/API errors retain the session; invalid authorization still clears it. Guest entry shares the landing header and retains channel URLs through authentication.

Validation: backend invitation/presence regressions and security tests; browser invitation send/accept with two accounts; online updates; auth URL and transient error tests; direct-call RTP/camera/screen/reconnect tests in Chromium and Electron; unchanged group-call smoke; Android release build/lint, signature verification and browser bridge test.

Physical Android microphone loudness, headset routing and verified app-link behavior still require device testing. No Android device was attached to this workspace. Windows installer remains unsigned by a publisher; Android retains the existing release key.
