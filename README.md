# Baby Tracker

A tiny, private, phone-first web app for tracking a baby's day — feeds,
bottles, pumping, sleep, play, nappies — together with a partner.

**All data lives in a Google Sheet in your own Google Drive.** The app has no
server and no database: the page (hosted on GitHub Pages) talks directly to
the Google Sheets API from your browser. Who can see the data is controlled
by one thing only — who the spreadsheet is shared with.

## How it works

```
Browser (this app, static files on GitHub Pages)
  ├─ Google Identity Services  →  sign in, OAuth token (drive.file scope)
  └─ Google Sheets API         →  your "Baby Tracker" spreadsheet
```

- The `drive.file` scope means the app can only access spreadsheets **it
  created** or that you **explicitly picked** in the Google file picker —
  nothing else in your Drive.
- Each person connects the sheet once: the owner creates it in the app and
  shares it (as Editor) from Google Sheets; the partner signs in and uses
  *"Open an existing tracker sheet"* to pick it.

## Data format

One spreadsheet, two tabs:

- **Log** — one row per event:
  `id, type, start_time, end_time, duration_min, side, amount_ml, notes, logged_by, formula_ml`.
  Types: `feed` (breastfeed, timed), `bottle` (breast milk + formula ml),
  `sleep`, `play` (timed), `pump`, `wet`, `dirty`.
  Times are ISO-8601 strings with UTC offset (`2026-08-08T14:30:00+01:00`).
- **Settings** — shared key/value pairs, e.g. `breastfeed_ml` (assumed ml
  per breastfeed, used in totals).

The sheet is the source of truth and stays fully usable by hand — it's just
a spreadsheet.

## Google Cloud setup (one-time, for whoever deploys this)

The app needs three public identifiers in [`js/config.js`](js/config.js).
They are not secrets. To create them:

1. Go to [console.cloud.google.com](https://console.cloud.google.com), create
   a project (e.g. `baby-tracker`). Note its **project number** (shown on the
   dashboard) → `GOOGLE_APP_ID`.
2. **APIs & Services → Library**: enable **Google Sheets API** and
   **Google Picker API**.
3. **APIs & Services → OAuth consent screen**: External; fill in app name and
   support email. Keep publishing status **Testing** and add every user of the
   app (you and your partner) as **test users**.
4. **Credentials → Create credentials → API key** → `GOOGLE_API_KEY`.
   (Optionally restrict it to the Picker API.)
5. **Credentials → Create credentials → OAuth client ID** → *Web application*.
   Add **Authorized JavaScript origins**:
   - `https://<your-username>.github.io`
   - `http://localhost:8000` (for local development)

   The client ID → `GOOGLE_CLIENT_ID`.

## Deployment

GitHub Pages, straight from the repo — no build step. In the repo settings:
**Pages → Deploy from branch → `main` / root**.

## Local development

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

(Requires the `http://localhost:8000` origin on the OAuth client, see above.)

## Roadmap

- [x] Phase 1 — sign-in, create/pick sheet, read-only view (running
      activities, day summary, last 24 hours)
- [ ] Phase 2 — logging and editing (start/stop timers, backdated entries)
- [ ] Phase 3 — stats tab (daily milk intake and breakdown)
- [ ] Phase 4 — PWA: home-screen icon, standalone mode, offline queue
