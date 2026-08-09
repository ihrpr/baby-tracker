# Baby Tracker

A tiny, private, phone-first web app for tracking a baby's day — feeds,
bottles, pumping, sleep, play, nappies — together with a partner.

All data lives in a Google Sheet in your own Google Drive. No server, no
database: the static page talks directly to the Google Sheets API, and only
people the spreadsheet is shared with can see the data. The `drive.file`
scope limits the app to sheets it created or that you picked in the file
picker.

## Setup

One-time, for whoever deploys this. The app needs three public identifiers
in [`js/config.js`](js/config.js) — they are not secrets:

1. [console.cloud.google.com](https://console.cloud.google.com) → create a
   project. Its **project number** → `GOOGLE_APP_ID`.
2. **APIs & Services → Library**: enable **Google Sheets API** and
   **Google Picker API**.
3. **OAuth consent screen**: External, publishing status **Testing**, add
   every user as a **test user**.
4. **Credentials → API key** → `GOOGLE_API_KEY`. Restrict it: websites
   `https://<your-username>.github.io/*`, API = Google Picker API.
5. **Credentials → OAuth client ID** (*Web application*) → `GOOGLE_CLIENT_ID`.
   Authorized JavaScript origins: `https://<your-username>.github.io` and
   `http://localhost:8000` (local dev).

Deploy: GitHub Pages from branch `main` / root — no build step.

Share with a partner: share the spreadsheet with them as Editor, then they
sign in and pick it via *"Open an existing tracker sheet"*.

## Local development

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```
