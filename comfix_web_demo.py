#!/usr/bin/env python3
"""Local ComFix web demo. Run with: python comfix_web_demo.py"""
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import threading
import csv
import io
import time
from datetime import datetime, timedelta
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import comfix_demo as engine

ROOT = Path(__file__).resolve().parent
WEB_ROOT = ROOT / "web_demo"
AUTH_DB = ROOT / "comfix_accounts.sqlite3"
HOST = os.environ.get("COMFIX_HOST", "127.0.0.1")
PORT = int(os.environ.get("COMFIX_PORT", "8000"))
PASSWORD_ROUNDS = 310_000
SESSIONS = {}
LOCK = threading.RLock()
DB = engine.load()


def stamp_legacy_resolved():
    """Resolved reports saved before dates were tracked get a resolved date of now."""
    changed = False
    for report in DB["reports"]:
        if report["status"] == "Resolved" and "resolvedAt" not in report:
            report["resolvedAt"] = time.time()
            changed = True
    if changed:
        engine.save(DB)


stamp_legacy_resolved()


def resolved_report_csv(period):
    now = datetime.now()
    if period == "weekly":
        start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    else:
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    with LOCK:
        all_groups = engine.groups(DB["reports"], DB["now"])
        rows = []
        for group in all_groups:
            if group["st"] != 3:
                continue
            stamps = [report.get("resolvedAt") for report in group["rs"] if report.get("resolvedAt")]
            if not stamps:
                continue
            resolved = datetime.fromtimestamp(max(stamps))
            if resolved < start:
                continue
            rows.append((resolved, group))
    rows.sort(key=lambda item: item[0], reverse=True)
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["ComFix resolved reports", period.capitalize(),
                     f"{start:%Y-%m-%d} to {now:%Y-%m-%d}"])
    writer.writerow([])
    writer.writerow(["Report IDs", "Title", "Category", "Severity", "Reports merged", "Resolved on"])
    for resolved, group in rows:
        writer.writerow([", ".join(f"CF-{report['id']:03d}" for report in group["rs"]), group["title"],
                         group["cat"], group["sev"], group["n"], f"{resolved:%Y-%m-%d %H:%M}"])
    writer.writerow([])
    writer.writerow(["Total resolved", len(rows)])
    return out.getvalue(), start, now


def account_connection():
    connection = sqlite3.connect(AUTH_DB)
    connection.row_factory = sqlite3.Row
    return connection


def password_record(password, salt=None):
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PASSWORD_ROUNDS)
    return salt.hex(), digest.hex()


def setup_accounts():
    with account_connection() as connection:
        connection.execute("CREATE TABLE IF NOT EXISTS accounts (username TEXT PRIMARY KEY, salt TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL)")
        columns = {row[1] for row in connection.execute("PRAGMA table_info(accounts)")}
        for column in ("full_name", "contact", "address"):
            if column not in columns:
                connection.execute(f"ALTER TABLE accounts ADD COLUMN {column} TEXT NOT NULL DEFAULT ''")
        count = connection.execute("SELECT COUNT(*) FROM accounts").fetchone()[0]
        if not count:
            username = os.environ.get("COMFIX_ADMIN_USERNAME", "office")
            password = os.environ.get("COMFIX_ADMIN_PASSWORD", "comfix-admin")
            salt, digest = password_record(password)
            connection.execute("INSERT INTO accounts (username, salt, password_hash, role) VALUES (?, ?, ?, 'admin')", (username, salt, digest))


def get_account(username):
    with account_connection() as connection:
        return connection.execute("SELECT username, salt, password_hash, role, full_name, contact, address FROM accounts WHERE username = ?", (username,)).fetchone()


def add_citizen(username, password):
    salt, digest = password_record(password)
    try:
        with account_connection() as connection:
            connection.execute("INSERT INTO accounts (username, salt, password_hash, role) VALUES (?, ?, ?, 'citizen')", (username, salt, digest))
        return True
    except sqlite3.IntegrityError:
        return False


def public_user(account):
    return {"username": account["username"], "role": account["role"], "fullName": account["full_name"],
            "contact": account["contact"], "address": account["address"]}


def make_session(account):
    token = secrets.token_urlsafe(32)
    SESSIONS[token] = {"username": account["username"], "role": account["role"]}
    return token


def session_token(handler):
    morsel = SimpleCookie(handler.headers.get("Cookie", "")).get("comfix_session")
    return morsel.value if morsel else None


def current_user(handler):
    cookie = SimpleCookie(handler.headers.get("Cookie", ""))
    morsel = cookie.get("comfix_session")
    session = SESSIONS.get(morsel.value) if morsel else None
    if not session:
        return None
    account = get_account(session["username"])
    return public_user(account) if account else None


def group_data(group, rank=None, username=None):
    return {
        "mine": bool(username) and any(report.get("by") == username for report in group["rs"]),
        "ids": [report["id"] for report in group["rs"]],
        "title": group["title"],
        "category": group["cat"],
        "severity": group["sev"],
        "count": group["n"],
        "status": engine.STATUSES[group["st"]],
        "priority": round(group["pr"], 1),
        "factors": {key: round(value, 2) for key, value in group["f"].items()},
        "ageHours": group["age"],
        "pin": group["pin"],
        "reports": [{"id": report["id"], "text": report["text"], "createdHour": report["t"]} for report in group["rs"]],
        "rank": rank,
    }


def dashboard_data(username=None):
    with LOCK:
        all_groups = engine.groups(DB["reports"], DB["now"])
        opened = [group for group in all_groups if group["st"] < 3]
        ranked = sorted(opened, key=lambda group: -group["pr"])
        ranked_ids = {tuple(report["id"] for report in group["rs"]): i for i, group in enumerate(ranked, 1)}
        open_reports = [group_data(group, ranked_ids.get(tuple(report["id"] for report in group["rs"])), username) for group in ranked]
        closed_reports = [group_data(group, None, username) for group in all_groups if group["st"] == 3]
        received = len(DB["reports"])
        return {"reportsReceived": received, "openReportCount": len(opened),
            "resolvedReportCount": len(closed_reports), "openReports": open_reports,
            "resolvedReports": closed_reports}


def clean_text(value, limit=500):
    return value.strip()[:limit] if isinstance(value, str) else ""


def valid_pin(pin):
    if pin is None:
        return None
    if not isinstance(pin, list) or len(pin) != 2:
        raise ValueError("Location must contain latitude and longitude.")
    latitude, longitude = float(pin[0]), float(pin[1])
    if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
        raise ValueError("Location is outside the valid map range.")
    return [latitude, longitude]


class DemoHandler(BaseHTTPRequestHandler):
    server_version = "ComFixDemo/1.0"

    def send_json(self, payload, status=HTTPStatus.OK, cookie=None, clear_cookie=False):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if cookie:
            self.send_header("Set-Cookie", f"comfix_session={cookie}; HttpOnly; SameSite=Lax; Path=/")
        elif clear_cookie:
            self.send_header("Set-Cookie", "comfix_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length > 32_000:
            raise ValueError("Request is too large.")
        return json.loads(self.rfile.read(length) or b"{}")

    def require_user(self, role=None):
        user = current_user(self)
        if not user:
            self.send_json({"error": "Please sign in."}, HTTPStatus.UNAUTHORIZED)
            return None
        if role and user["role"] != role:
            self.send_json({"error": "This action is only available to the office."}, HTTPStatus.FORBIDDEN)
            return None
        return user

    def do_GET(self):
        path = urlparse(self.path).path
        if path.startswith("/api/"):
            self.api_get(path)
        else:
            self.send_static(path)

    def api_get(self, path):
        if path == "/api/resolved-report":
            if self.require_user("admin"):
                period = parse_qs(urlparse(self.path).query).get("period", [""])[0]
                if period not in ("weekly", "monthly"):
                    self.send_json({"error": "Choose weekly or monthly."}, HTTPStatus.BAD_REQUEST)
                    return
                text, start, now = resolved_report_csv(period)
                body = ("\ufeff" + text).encode("utf-8")
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "text/csv; charset=utf-8")
                self.send_header("Content-Disposition", f'attachment; filename="comfix-resolved-{period}-{now:%Y%m%d}.csv"')
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)
            return
        if path == "/api/config":
            self.send_json({"googleMapsApiKey": os.environ.get("GOOGLE_MAPS_API_KEY", "")})
            return
        if path == "/api/session":
            self.send_json({"user": current_user(self)})
            return
        if path == "/api/dashboard":
            user = self.require_user()
            if user:
                self.send_json(dashboard_data(user["username"]))
            return
        self.send_json({"error": "Not found."}, HTTPStatus.NOT_FOUND)

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            payload = self.read_json()
            if path == "/api/register":
                self.register(payload)
            elif path == "/api/login":
                self.login(payload)
            elif path == "/api/logout":
                cookie = SimpleCookie(self.headers.get("Cookie", ""))
                morsel = cookie.get("comfix_session")
                if morsel:
                    SESSIONS.pop(morsel.value, None)
                self.send_json({"ok": True}, clear_cookie=True)
            elif path == "/api/reports":
                self.create_report(payload)
            elif path == "/api/status":
                self.update_status(payload)
            elif path == "/api/profile":
                self.update_profile(payload)
            elif path == "/api/password":
                self.change_password(payload)
            else:
                self.send_json({"error": "Not found."}, HTTPStatus.NOT_FOUND)
        except (ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
            self.send_json({"error": str(error)}, HTTPStatus.BAD_REQUEST)

    def register(self, payload):
        username = clean_text(payload.get("username"), 32)
        password = payload.get("password", "")
        if not 3 <= len(username) <= 32 or not all(ch.isalnum() or ch in "_.-" for ch in username):
            raise ValueError("Use a 3-32 character username with letters, numbers, . _ or -.")
        if not isinstance(password, str) or len(password) < 8 or len(password) > 128:
            raise ValueError("Password must be 8-128 characters.")
        if not add_citizen(username, password):
            self.send_json({"error": "That username is already taken."}, HTTPStatus.CONFLICT)
            return
        account = get_account(username)
        self.send_json({"user": public_user(account)}, cookie=make_session(account))

    def login(self, payload):
        username = clean_text(payload.get("username"), 32)
        password = payload.get("password", "")
        account = get_account(username)
        if not account or not isinstance(password, str):
            self.send_json({"error": "Username or password is incorrect."}, HTTPStatus.UNAUTHORIZED)
            return
        _, digest = password_record(password, bytes.fromhex(account["salt"]))
        if not hmac.compare_digest(digest, account["password_hash"]):
            self.send_json({"error": "Username or password is incorrect."}, HTTPStatus.UNAUTHORIZED)
            return
        self.send_json({"user": public_user(account)}, cookie=make_session(account))

    def update_profile(self, payload):
        user = self.require_user()
        if not user:
            return
        full_name = clean_text(payload.get("fullName"), 60)
        contact = clean_text(payload.get("contact"), 40)
        address = clean_text(payload.get("address"), 120)
        new_username = clean_text(payload.get("username"), 32) or user["username"]
        if not 3 <= len(new_username) <= 32 or not all(ch.isalnum() or ch in "_.-" for ch in new_username):
            raise ValueError("Use a 3-32 character username with letters, numbers, . _ or -.")
        if contact and not all(ch.isdigit() or ch in "+-() " for ch in contact):
            raise ValueError("Contact number can only use digits, spaces, + - ( ).")
        old_username = user["username"]
        with LOCK:
            try:
                with account_connection() as connection:
                    connection.execute("UPDATE accounts SET username = ?, full_name = ?, contact = ?, address = ? WHERE username = ?",
                                       (new_username, full_name, contact, address, old_username))
            except sqlite3.IntegrityError:
                self.send_json({"error": "That username is already taken."}, HTTPStatus.CONFLICT)
                return
            if new_username != old_username:
                for session in SESSIONS.values():
                    if session["username"] == old_username:
                        session["username"] = new_username
                for report in DB["reports"]:
                    if report.get("by") == old_username:
                        report["by"] = new_username
                engine.save(DB)
        self.send_json({"user": public_user(get_account(new_username))})

    def change_password(self, payload):
        user = self.require_user()
        if not user:
            return
        current, new = payload.get("currentPassword", ""), payload.get("newPassword", "")
        account = get_account(user["username"])
        _, digest = password_record(current if isinstance(current, str) else "", bytes.fromhex(account["salt"]))
        if not hmac.compare_digest(digest, account["password_hash"]):
            self.send_json({"error": "Current password is incorrect."}, HTTPStatus.UNAUTHORIZED)
            return
        if not isinstance(new, str) or not 8 <= len(new) <= 128:
            raise ValueError("New password must be 8-128 characters.")
        salt, digest = password_record(new)
        with account_connection() as connection:
            connection.execute("UPDATE accounts SET salt = ?, password_hash = ? WHERE username = ?", (salt, digest, user["username"]))
        self.send_json({"ok": True})

    def create_report(self, payload):
        user = self.require_user("citizen")
        if not user:
            return
        category = payload.get("category")
        severity = payload.get("severity")
        text = clean_text(payload.get("text"))
        pin = valid_pin(payload.get("pin"))
        if category not in engine.CATEGORIES:
            raise ValueError("Choose a report category.")
        if not isinstance(severity, int) or not 1 <= severity <= 5:
            raise ValueError("Choose a severity from 1 to 5.")
        if len(text) < 8:
            raise ValueError("Describe the issue in at least 8 characters.")
        with LOCK:
            report, group, reopened = engine.submit(DB, {"cat": category, "sev": severity, "text": text, "pin": pin, "by": user["username"]})
        self.send_json({"ticket": f"CF-{report['id']:03d}", "groupCount": group["n"], "reopened": reopened})

    def update_status(self, payload):
        if not self.require_user("admin"):
            return
        ids = payload.get("ids")
        status = payload.get("status")
        if not isinstance(ids, list) or not ids or status not in engine.STATUSES:
            raise ValueError("Choose a report and valid status.")
        with LOCK:
            target = set(ids)
            group = next((group for group in engine.groups(DB["reports"], DB["now"])
                          if {report["id"] for report in group["rs"]} == target), None)
            if not group:
                raise ValueError("That report is no longer available. Refresh and try again.")
            engine.set_status(group, status, DB)
        self.send_json({"ok": True})

    def send_static(self, path):
        relative = "index.html" if path in ("/", "") else path.lstrip("/")
        target = (WEB_ROOT / relative).resolve()
        if WEB_ROOT.resolve() not in target.parents or not target.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        content_type = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml"}.get(target.suffix, "application/octet-stream")
        body = target.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format_string, *args):
        print(f"{self.address_string()} - {format_string % args}")


def main():
    setup_accounts()
    server = ThreadingHTTPServer((HOST, PORT), DemoHandler)
    print(f"ComFix web demo: http://{HOST}:{PORT}")
    print("Demo admin login: office / comfix-admin (change with COMFIX_ADMIN_USERNAME and COMFIX_ADMIN_PASSWORD)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nComFix web demo stopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()