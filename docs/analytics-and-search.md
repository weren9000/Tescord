# Statistics and public search

The system-admin-only Statistics tab uses GET /api/admin/statistics.
Avatar administrators cannot access it. Responses are no-store.
Periods are UTC calendar days (today, seven days, thirty days).

- Online: unique users in the existing presence registry.
- Active: unique authenticated users who opened the updated client or interacted
  with a visible client. Idle background tabs do not periodically send activity.
- Visits: a new session after thirty minutes without tracked activity; multiple
  tabs/devices of the same authenticated account share a session.
- Guests: separate first-party browser identifier, HMAC-hashed on the server.
  No raw IP, message content or individual page history is stored in analytics.
  Clearing browser storage creates a new guest identity; this is not a count
  of distinct people.
- Messages and registrations are queried from existing records, so historical
  totals are available. Deleted records are not included.
- Voice: unique signaling participants sampled about every fifteen seconds.
  User-hours and session starts are estimates; short calls may be missed and a
  backend restart may split a session. A silent connected participant counts.
- The unchanged desktop installer does not send the new activity events.
  Its existing messages, presence and voice remain included.

The collector runs in the existing single API worker. Do not increase workers
without moving presence/signaling and the collector to shared services.
CPU is the host-wide busy-time delta, RAM is total minus available, disk is the
filesystem containing uploads, network is aggregate host bytes per second.
API RSS is separate. Redis, PostgreSQL and LiveKit have actual availability probes.
These are VPS resources, not a visitor's computer.

The dashboard refreshes every fifteen seconds only while open and visible.
Missing/stale readings are marked; collection begins at deployment.
Daily activity retention is 365 days; temporary visitor session state is two days.
Resource history is minute averages for seven days, then hourly up to ninety days.
Cleanup runs hourly. Samples do not contain message contents or account emails.

Public search metadata and WebSite JSON-LD are in the initial HTML.
The public root is the only sitemap entry. Private channel/invite pages and API
responses use X-Robots-Tag; authorization still controls all protected data.
Unknown frontend paths and missing assets return real 404s in the production
nginx configuration. Install scripts/nginx-kvachat.conf with a backup and nginx -t.

After release, request reindexing of https://kvachat.ru/ in the owner's Google
Search Console and Yandex Webmaster accounts. The search engines determine the
final title/snippet and when to refresh the favicon; deployment alone is not
proof of indexing. No analytics third-party service is required.
