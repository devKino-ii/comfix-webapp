# ComFix

ComFix is a community issue reporting app for Morong, Rizal. Residents report local problems — flooding, road damage, streetlights, garbage, safety hazards, or anything else under "Others" with their own label — with an optional map pin. The community office sees one ranked list: reports are grouped automatically by how similar their text and location are, so duplicates of the same problem count as one ticket, sorted by priority, severity, or report count, with status tracked from New through Resolved.

## Overview

**For residents**
- File a report: category (including a free-text "Others"), severity, description, and an optional pin on the map
- Browse open reports in the area
- Re-report a resolved issue if it comes back — this reopens the same ticket instead of starting a new one
- Edit their own profile and password

**For the community office**
- One ranked list of open reports — sort by priority, severity, or report count, and filter by category to see what one department needs to handle
- Combine two reports the automatic grouping missed into one
- Update a report's status, or reopen a resolved one
- Download resolved-report CSVs (weekly or monthly)

The map works out of the box with OpenStreetMap (via Leaflet). To use Google Maps instead, set `GOOGLE_MAPS_API_KEY` and restrict the key in Google Cloud.

## Running it

### Offline / locally

Python 3.8+, standard library only — nothing to `pip install`.

```powershell
python comfix_web_demo.py
```

Open `http://127.0.0.1:8000`. Reports persist to `comfix_data.json` and accounts to `comfix_accounts.sqlite3`, both created next to the script on first run.

Useful environment variables (all optional):

| Variable | Default | Purpose |
|---|---|---|
| `COMFIX_HOST` | `127.0.0.1` | Interface to bind to |
| `COMFIX_PORT` | `8000` | Port to bind to |
| `COMFIX_ADMIN_USERNAME` | `office` | Username seeded for the admin account |
| `COMFIX_ADMIN_PASSWORD` | `comfix-admin` | Password seeded for the admin account |
| `GOOGLE_MAPS_API_KEY` | unset | Switches the map provider from OpenStreetMap to Google Maps |
| `COMFIX_SESSION_SECRET` | a fixed demo string | Key used to sign session cookies — set a real secret for any shared deployment |

### Online

The same code deploys as-is to two different kinds of host, with no separate build step:

**Railway** (persistent server) — connect the repo; Railway reads `railpack.json` and runs `comfix_web_demo.py` as a long-lived process, same as running it locally. Reports and accounts persist to disk normally.

**Vercel** (serverless) — connect the repo; `vercel.json` and `api/index.py` expose the same request handler as a Python serverless function, so no code is duplicated between the two targets. See **Important notes** below for the one real difference this makes.

## Important notes

- **This is a presentation-grade prototype, not hardened production software.** Passwords are salted and hashed (PBKDF2, 310,000 rounds), and sessions are signed cookies rather than anything guessable — but there's no rate limiting, account recovery, or deployment hardening beyond that.
- **Set `COMFIX_SESSION_SECRET` for any real deployment.** Without it, every instance falls back to the same fixed string baked into the source, which is fine for a local demo but not a real secret once the code is public.
- **On Vercel specifically, storage is not persistent.** A serverless function's filesystem is read-only outside `/tmp`, and `/tmp` resets whenever Vercel spins up a fresh instance (after being idle, or scaling up). Reports and accounts created during a session can disappear without warning — fine for a single demo sitting, not a substitute for Railway's persistent disk.
- **Reports group automatically by text and location similarity.** If two reports read as "the same problem," they'll merge into one ticket on their own; the office's "combine" tool is only needed for the cases the automatic grouping misses.

## Built-in accounts

There is exactly one seeded account:

| Role | Username | Password |
|---|---|---|
| Community office (admin) | `office` | `comfix-admin` |

Override either with `COMFIX_ADMIN_USERNAME` / `COMFIX_ADMIN_PASSWORD` before first start. There are no seeded citizen accounts — residents register their own from the sign-in screen.

## Project files

- `comfix_web_demo.py` — the web server: routing, account handling, sessions, and the JSON API.
- `comfix_demo.py` — report grouping, priority scoring, sample seed data, and storage.
- `comfix_data.json` — starting report data; recreated from the seed if missing.
- `api/index.py` — Vercel's serverless entry point; re-exports the same request handler from `comfix_web_demo.py`.
- `vercel.json` / `railpack.json` — deploy configuration for Vercel and Railway respectively.
- `web_demo/index.html` — page structure and screen content.
- `web_demo/styles.css` — desktop and mobile layout.
- `web_demo/app.js` — sign-in, navigation, reports, and dashboard behavior.
- `web_demo/map-provider.js` — map setup and report markers.
- `web_demo/brand-mark.svg` — the ComFix logo (also used as the favicon).

## Replace parts

Change screen text or structure in `web_demo/index.html`, visual styling in `web_demo/styles.css`, and browser behavior in `web_demo/app.js`. Replace `web_demo/brand-mark.svg` to change the logo. Keep the `/api` paths in sync if replacing the browser app.
