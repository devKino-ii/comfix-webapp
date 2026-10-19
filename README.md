# ComFix

ComFix is a community issue reporting prototype for Morong, Rizal. The browser app has citizen and office views, report grouping, priority ranking, status updates, and a resolved list.

## Run it

Open PowerShell in this folder and run:

```powershell
python comfix_web_demo.py
```

Open `http://127.0.0.1:8000`. The office account is `office` with password `comfix-admin`. Residents can register from the sign-in screen, and any signed-in user can edit their profile (username, full name, contact number, address) and change their password from the account menu. This prototype stores reports in `comfix_data.json` and accounts in `comfix_accounts.sqlite3`.

## Project files

- `comfix_web_demo.py`: local web server, account handling, and JSON API.
- `comfix_demo.py`: report grouping, priority scoring, sample data, and storage functions used by the server.
- `comfix_data.json`: starting report data. The server creates it from the sample data if it is missing.
- `web_demo/index.html`: page structure and screen content.
- `web_demo/styles.css`: desktop and mobile layout.
- `web_demo/app.js`: sign-in, navigation, reports, and dashboard behavior.
- `web_demo/map-provider.js`: map setup and report markers.
- `web_demo/brand-mark.svg`: replaceable ComFix location mark.

## Replace parts

Change screen text or structure in `web_demo/index.html`, visual styling in `web_demo/styles.css`, and browser behavior in `web_demo/app.js`. Replace `web_demo/brand-mark.svg` to change the logo. Keep the `/api` paths in sync if replacing the browser app. The map defaults to OpenStreetMap. To use Google Maps, set `GOOGLE_MAPS_API_KEY` before starting the server and restrict the key in Google Cloud.

## Hackathon submission

Send only these items:

- `README.md`
- `comfix_web_demo.py`
- `comfix_demo.py`
- `comfix_data.json`
- the complete `web_demo/` folder

Do not send `.venv/`, `.venv-1/`, `__pycache__/`, `comfix_accounts.sqlite3`, or editor/temp files. The app creates its account database on first start. Include the README login instructions in the submission notes for reviewers.

## Present it

1. Start the server and open the local address in a desktop browser.
2. Sign in as `office` / `comfix-admin` and show the ranked reports and priority scores.
3. Open the resolved list and show that office staff can reopen a report.
4. Sign out, create a citizen account, and open the app on a phone-sized viewport.
5. Tap the center plus button, choose a category and severity, add a short report, and pin it on the Morong map.
6. Submit the report, then sign out and return to the office account.
7. Show the new report in the office list, update its status, and point out that its map marker and ranking follow the saved report data.
8. Close by explaining that the interface, report engine, map provider, and local storage are separate pieces that can be replaced as the project grows.

This is a local presentation prototype, not production-ready authentication. Passwords are salted and hashed, but sessions are held in memory and there is no account recovery or deployment hardening.