# Presence in background windows

An authenticated connected client now remains online while its window is hidden.
Web clients send presence every minute; authenticated event pings also refresh presence.
Android's connected background service sends presence independently of visibility or calls,
starting only after WebSocket authentication. Offline expiry is three minutes, with the
existing ten-second sweep. Multiple devices share the latest confirmed presence.

Audio capture, routing, and conference behavior are unchanged.

Windows 0.5.1 x64 and Android 0.3.1 (versionCode 5) bundle this frontend.
APK uses the existing signing key. Windows remains unsigned.

Validation: six backend tests; hidden idle browser tab heartbeat and friend indicator after
reload; landing and download checksum smoke; Android web bridge smoke; production frontend
build; Android release build and v3 signature verification. APK and desktop web payloads
match the final frontend bundle. Physical Android background behavior still needs a device test.
