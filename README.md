# Baby Tracker → tinyloops

> **⚠️ This repo is deprecated.** The tracker has moved to
> **[tinyloops.app](https://tinyloops.app)**, and its code now lives at
> **[ihrpr/tinyloops](https://github.com/ihrpr/tinyloops)** — a Cloudflare
> Worker with server-side Google auth, the same your-data-stays-in-your-own
> Google-Sheet design, and a proper sign-in that doesn't expire hourly.
>
> The GitHub Pages site for this repo now serves a migration notice pointing
> users to the new app. The old client-side implementation is preserved in
> the git history.

## What this was

A tiny, private, phone-first web app for tracking a baby's day — feeds,
bottles, pumping, sleep, play, nappies — together with a partner. All data
lived in a Google Sheet in the user's own Google Drive: no server, no
database, a static page talking directly to the Google Sheets API under the
`drive.file` scope.

That design's one pain point — client-side OAuth tokens expiring every hour —
is what tinyloops was built to fix.

## Migrating

Open [tinyloops.app](https://tinyloops.app), sign in with the same Google
account, choose *"Open an existing tracker sheet"*, and pick your sheet.
Every entry carries over because the sheet **is** the data.
