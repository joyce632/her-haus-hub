"""Her Haus Hub — team operations database for Her Haus Co.

Flask + SQLite backend serving a single-page frontend from ./static.
Run locally:  python app.py      Production:  gunicorn -w 1 --threads 8 app:app
"""
import calendar
import csv
import faulthandler
import sys
import time as _clock
import io
import json
import os
import re
import hashlib
import secrets
import shutil
import sqlite3
import ssl
import threading
import urllib.request
import uuid
from urllib.parse import quote, urlencode
from datetime import date, datetime, time, timedelta, timezone
from functools import wraps
from zoneinfo import ZoneInfo

from flask import Flask, Response, abort, g, has_request_context, jsonify, redirect, request, send_file, session
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.utils import secure_filename

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get("DATA_DIR", os.path.join(BASE_DIR, "data"))
UPLOAD_DIR = os.path.join(DATA_DIR, "uploads")
DB_PATH = os.path.join(DATA_DIR, "herhaus.db")
os.makedirs(UPLOAD_DIR, exist_ok=True)


def hash_pw(pw):
    return generate_password_hash(pw, method="pbkdf2:sha256:600000")


def _secret_key():
    if os.environ.get("SECRET_KEY"):
        return os.environ["SECRET_KEY"]
    path = os.path.join(DATA_DIR, "secret.key")
    if not os.path.exists(path):
        with open(path, "w") as f:
            f.write(secrets.token_hex(32))
    with open(path) as f:
        return f.read().strip()


app = Flask(__name__, static_folder="static", static_url_path="/static")
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)  # trust the host's HTTPS proxy headers
app.config.update(
    SECRET_KEY=_secret_key(),
    MAX_CONTENT_LENGTH=25 * 1024 * 1024,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.environ.get("COOKIE_SECURE", "0") == "1",
    PERMANENT_SESSION_LIFETIME=timedelta(days=14),
)

SAFE_IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}  # no SVG: it can carry script
CLIENT_TYPES = ["VIP Client", "Stable Client", "Low Priority Client"]
CLIENT_HEALTH = ["Stable", "At Risk", "Newly Onboarded"]
STATUSES = ["Not Started", "Blocked", "For Revision", "In Progress", "Done"]
PRIORITIES = ["Low", "Medium", "High", "Urgent"]
DEFAULT_SETTINGS = {
    "company_name": "Her Haus Co.",
    "timezone": "Asia/Manila",
    "currency": "₱",
    "work_days": "0,1,2,3,4",  # Mon=0 … Sun=6
    "chat_webhook_shift": "",
    "chat_webhook_eod": "",
    "notify_clock_out": "1",
    "notify_breaks": "0",
    "company_direction": "",
    "app_url": "",
    "chat_webhook_tasks": "",
    "chat_webhook_tasks_done": "",
    "task_alert_created": "1",
    "task_alert_assigned": "1",
    "task_alert_status": "0",
    "task_alert_done": "1",
    "task_alert_comment": "0",
    "task_alert_digest": "1",
    "task_digest_time": "09:00",
    "task_digest_last": "",
    "auto_archive_days": "14",
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL COLLATE NOCASE,
  password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'employee', position TEXT DEFAULT '',
  salary_per_cutoff REAL DEFAULT 0, shift_hours REAL DEFAULT 8, phone TEXT DEFAULT '', start_date TEXT DEFAULT '',
  bank_name TEXT DEFAULT '', bank_account_name TEXT DEFAULT '', bank_account_number TEXT DEFAULT '',
  qr_file_id INTEGER, active INTEGER DEFAULT 1, must_change_password INTEGER DEFAULT 1, created_at TEXT);
CREATE TABLE IF NOT EXISTS time_entries(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), clock_in TEXT NOT NULL, clock_out TEXT);
CREATE INDEX IF NOT EXISTS ix_te_user ON time_entries(user_id, clock_in);
CREATE TABLE IF NOT EXISTS breaks(
  id INTEGER PRIMARY KEY, entry_id INTEGER NOT NULL REFERENCES time_entries(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL, kind TEXT DEFAULT 'Break', start TEXT NOT NULL, end TEXT);
CREATE TABLE IF NOT EXISTS clients(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, color TEXT DEFAULT '#0C2E60', description TEXT DEFAULT '',
  archived INTEGER DEFAULT 0, created_at TEXT);
CREATE TABLE IF NOT EXISTS tasks(
  id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), title TEXT NOT NULL,
  description TEXT DEFAULT '', notes TEXT DEFAULT '', priority TEXT DEFAULT 'Medium', assignee_id INTEGER,
  deadline TEXT, status TEXT DEFAULT 'Not Started', position REAL DEFAULT 0, created_by INTEGER,
  created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS task_links(
  id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  url TEXT NOT NULL, label TEXT DEFAULT '', created_at TEXT);
CREATE TABLE IF NOT EXISTS files(
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, ref_id INTEGER, owner_id INTEGER, original_name TEXT,
  stored_name TEXT, mime TEXT, size INTEGER, created_at TEXT);
CREATE TABLE IF NOT EXISTS eods(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, eod_date TEXT, client_id INTEGER, accomplishments TEXT,
  blockers TEXT DEFAULT '', tomorrow TEXT DEFAULT '', notes TEXT DEFAULT '', worked_seconds INTEGER DEFAULT 0,
  chat_status TEXT DEFAULT '', created_at TEXT);
CREATE TABLE IF NOT EXISTS incidents(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, incident_date TEXT, title TEXT, description TEXT DEFAULT '',
  severity TEXT DEFAULT 'Minor', action_taken TEXT DEFAULT '', employee_response TEXT DEFAULT '',
  reported_by INTEGER, created_at TEXT);
CREATE TABLE IF NOT EXISTS kpis(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, title TEXT, target REAL DEFAULT 0, current REAL DEFAULT 0,
  unit TEXT DEFAULT '', period TEXT DEFAULT 'Weekly', due_date TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS wins(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, win_date TEXT, title TEXT, description TEXT DEFAULT '',
  created_by INTEGER, created_at TEXT);
CREATE TABLE IF NOT EXISTS metrics(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, week_start TEXT, metric TEXT, achieved REAL DEFAULT 0,
  target REAL DEFAULT 0, unit TEXT DEFAULT '', notes TEXT DEFAULT '', alignment TEXT DEFAULT 'Pending Review',
  exec_comment TEXT DEFAULT '', created_at TEXT);
CREATE TABLE IF NOT EXISTS resources(
  id INTEGER PRIMARY KEY, owner_id INTEGER, title TEXT, url TEXT DEFAULT '', category TEXT DEFAULT 'General',
  description TEXT DEFAULT '', shared INTEGER DEFAULT 0, file_id INTEGER, created_at TEXT);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS task_comments(
  id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, user_id INTEGER NOT NULL,
  body TEXT NOT NULL, created_at TEXT, edited_at TEXT);
CREATE INDEX IF NOT EXISTS ix_comments_task ON task_comments(task_id, id);
CREATE TABLE IF NOT EXISTS notifications(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, actor_id INTEGER, kind TEXT NOT NULL, task_id INTEGER,
  comment_id INTEGER, snippet TEXT DEFAULT '', read_at TEXT, created_at TEXT);
CREATE INDEX IF NOT EXISTS ix_notif_user ON notifications(user_id, read_at, id);
CREATE TABLE IF NOT EXISTS recurring_rules(
  id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), title TEXT NOT NULL,
  description TEXT DEFAULT '', notes TEXT DEFAULT '', priority TEXT DEFAULT 'Medium', assignee_id INTEGER,
  start_status TEXT DEFAULT 'Not Started', frequency TEXT DEFAULT 'weekly', weekdays TEXT DEFAULT '0',
  day_of_month INTEGER DEFAULT 1, run_time TEXT DEFAULT '08:00', due_in_days INTEGER, skip_if_open INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1, next_run_at TEXT, last_run_at TEXT, last_task_id INTEGER, created_by INTEGER, created_at TEXT);
"""


# ---------------------------------------------------------------- db helpers
def _sqlite_open(**kw):
    """Open the database WITHOUT operating-system file locks (SQLite's "unix-none" VFS).

    Render's persistent disk has left stale file locks behind after restarts, making SQLite report
    "database is locked" even when nothing else is using it. File locks are unnecessary here: Render lets
    only one server attach the disk, the app runs one process (gunicorn -w 1), and every database call
    goes through the single shared connection below, serialized by a thread lock. The rollback journal
    still protects against crashes. Set SQLITE_FILE_LOCKS=1 to go back to normal OS locking.
    """
    if os.environ.get("SQLITE_FILE_LOCKS") == "1":
        return sqlite3.connect(DB_PATH, **kw)
    return sqlite3.connect(f"file:{quote(DB_PATH)}?vfs=unix-none", uri=True, **kw)

# The app keeps ONE SQLite connection and lets request threads take turns on it (no per-request connections,
# so the app never competes with itself for the file lock). The lock is taken only for the instant each
# statement runs, so anything else that briefly opens the database simply waits its turn (busy_timeout)
# instead of failing with "database is locked". Each statement commits on its own (autocommit).
class _SharedDB:
    def __init__(self):
        self._lock = threading.RLock()
        self._conn = None

    def _connection(self):
        if self._conn is None:
            conn = _sqlite_open(timeout=30, check_same_thread=False, isolation_level=None)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA foreign_keys=ON")
            conn.execute("PRAGMA journal_mode=TRUNCATE")
            conn.execute("PRAGMA busy_timeout=30000")
            self._conn = conn
        return self._conn

    busy_since = None   # when the database call currently running started (watched by _db_watchdog)

    def execute(self, sql, args=()):
        with self._lock:
            self.busy_since = _clock.monotonic()
            try:
                cur = self._connection().execute(sql, args)
                if cur.description is not None:   # a SELECT: read it fully now so it never holds a lock afterwards
                    cur.fetchall()
                return cur
            finally:
                self.busy_since = None

    def query(self, sql, args=()):
        with self._lock:
            self.busy_since = _clock.monotonic()
            try:
                return [dict(r) for r in self._connection().execute(sql, args).fetchall()]
            finally:
                self.busy_since = None

    def commit(self):
        pass  # autocommit: every statement is already saved


_shared_db = _SharedDB()


def db():
    return _shared_db


def q(sql, args=(), one=False):
    rows = _shared_db.query(sql, args)
    return (rows[0] if rows else None) if one else rows


def ex(sql, args=()):
    return _shared_db.execute(sql, args).lastrowid


def _add_column(conn, table, col, decl):
    if col not in [r[1] for r in conn.execute(f"PRAGMA table_info({table})")]:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {decl}")


def _open_db_for_startup():
    """Open the database in classic rollback-journal mode.

    WAL mode needs a shared-memory side file (-shm) that some cloud disks handle badly
    ("disk I/O error"). The -shm file is only an index SQLite rebuilds from the -wal file,
    so if it is the problem we can remove it safely before anything else connects.
    """
    shm = DB_PATH + "-shm"
    for attempt in (1, 2):
        conn = _sqlite_open(timeout=30)
        try:
            mode = conn.execute("PRAGMA journal_mode=DELETE").fetchone()[0]
            conn.execute("SELECT count(*) FROM sqlite_master").fetchone()
            return conn, mode
        except sqlite3.OperationalError as e:
            conn.close()
            if attempt == 1 and os.path.exists(shm):
                print(f"  Database open failed ({e}); removing stale {shm} and retrying", flush=True)
                os.remove(shm)
                continue
            raise


def init_db():
    conn, mode = _open_db_for_startup()
    conn.executescript(SCHEMA)
    _add_column(conn, "users", "avatar_file_id", "INTEGER")
    _add_column(conn, "tasks", "completed_at", "TEXT")
    _add_column(conn, "tasks", "recurring_rule_id", "INTEGER")
    _add_column(conn, "clients", "chat_webhook", "TEXT DEFAULT ''")
    _add_column(conn, "clients", "archived_at", "TEXT")
    _add_column(conn, "clients", "position", "REAL")
    _add_column(conn, "clients", "client_type", "TEXT DEFAULT 'Stable Client'")
    _add_column(conn, "clients", "client_status", "TEXT DEFAULT 'Stable'")
    conn.execute("UPDATE clients SET position=id WHERE position IS NULL")
    _add_column(conn, "tasks", "archived_at", "TEXT")
    _add_column(conn, "tasks", "archived_by", "INTEGER")
    _add_column(conn, "tasks", "restored_at", "TEXT")
    _add_column(conn, "tasks", "deadline_time", "TEXT")       # optional "HH:MM", company timezone
    _add_column(conn, "recurring_rules", "due_time", "TEXT")
    for col in ("block_date", "block_start", "block_end"):   # optional time block set by the assignee
        _add_column(conn, "tasks", col, "TEXT")
    # Task notes were replaced by comments: move any existing notes into a comment so nothing is lost.
    fallback = (conn.execute("SELECT id FROM users WHERE role='executive' ORDER BY id LIMIT 1").fetchone() or [None])[0]
    for tid, notes, created_by, created_at in conn.execute(
            "SELECT id, notes, created_by, created_at FROM tasks WHERE notes IS NOT NULL AND TRIM(notes)!=''").fetchall():
        if created_by or fallback:
            conn.execute("INSERT INTO task_comments(task_id,user_id,body,created_at) VALUES(?,?,?,?)",
                         (tid, created_by or fallback, notes.strip(), created_at))
            conn.execute("UPDATE tasks SET notes='' WHERE id=?", (tid,))
    conn.execute("UPDATE recurring_rules SET description=CASE WHEN TRIM(COALESCE(description,''))='' THEN notes "
                 "ELSE description || char(10) || char(10) || notes END, notes='' WHERE TRIM(COALESCE(notes,''))!=''")
    conn.execute("UPDATE tasks SET completed_at=updated_at WHERE status='Done' AND completed_at IS NULL")
    for k, v in DEFAULT_SETTINGS.items():
        conn.execute("INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)", (k, v))
    if not conn.execute("SELECT 1 FROM users LIMIT 1").fetchone():
        email = os.environ.get("ADMIN_EMAIL", "admin@herhauscompany.com")
        password = os.environ.get("ADMIN_PASSWORD") or secrets.token_urlsafe(9)
        conn.execute(
            "INSERT INTO users(name,email,password_hash,role,position,created_at) VALUES(?,?,?,?,?,?)",
            ("Owner", email, hash_pw(password), "executive", "Owner", iso(now_utc())),
        )
        with open(os.path.join(DATA_DIR, "FIRST_LOGIN.txt"), "w") as f:
            f.write(f"First executive login\nEmail: {email}\nTemporary password: {password}\n"
                    "You will be asked to change it on first login. Delete this file afterwards.\n")
        print(f"\n  Created first executive account: {email}\n  Temporary password saved to {DATA_DIR}/FIRST_LOGIN.txt\n")
    conn.commit()
    integrity = conn.execute("PRAGMA quick_check").fetchone()[0]
    print(f"  Database ready: {DB_PATH} · journal={mode} · check={integrity} · pid={os.getpid()}", flush=True)
    conn.close()


def settings():
    if "settings" not in g:
        g.settings = {r["key"]: r["value"] for r in q("SELECT key,value FROM settings")}
    return g.settings


# ---------------------------------------------------------------- time helpers
def now_utc():
    return datetime.now(timezone.utc)


def iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_dt(s):
    if not s:
        return None
    s = s.strip().replace("Z", "+00:00")
    if "." in s:  # drop fractional seconds (JS toISOString)
        head, tail = s.split(".", 1)
        tz = tail[tail.find("+"):] if "+" in tail else ""
        s = head + tz
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def tz():
    try:
        return ZoneInfo(settings().get("timezone") or "Asia/Manila")
    except Exception:
        return ZoneInfo("Asia/Manila")


def local_today():
    return now_utc().astimezone(tz()).date()


def local_midnight_utc(d):
    return datetime.combine(d, time(0, 0), tzinfo=tz()).astimezone(timezone.utc)


def fmt_local(dt, fmt="%I:%M %p"):
    return dt.astimezone(tz()).strftime(fmt).lstrip("0")


def cutoff_bounds(d):
    """Semi-monthly payroll: 1–15 and 16–end of month."""
    if d.day <= 15:
        return d.replace(day=1), d.replace(day=15)
    return d.replace(day=16), d.replace(day=calendar.monthrange(d.year, d.month)[1])


def work_days_set():
    try:
        return {int(x) for x in settings().get("work_days", "0,1,2,3,4").split(",") if x.strip() != ""}
    except ValueError:
        return {0, 1, 2, 3, 4}


def count_workdays(start, end):
    wd, n, d = work_days_set(), 0, start
    while d <= end:
        if d.weekday() in wd:
            n += 1
        d += timedelta(days=1)
    return n


def entries_with_seconds(user_id, start_utc, end_utc):
    entries = q("SELECT * FROM time_entries WHERE user_id=? AND clock_in>=? AND clock_in<? ORDER BY clock_in",
                (user_id, iso(start_utc), iso(end_utc)))
    if not entries:
        return []
    ids = [e["id"] for e in entries]
    brs = q(f"SELECT * FROM breaks WHERE entry_id IN ({','.join('?' * len(ids))}) ORDER BY start", ids)
    by_entry = {}
    for b in brs:
        by_entry.setdefault(b["entry_id"], []).append(b)
    now = now_utc()
    for e in entries:
        e["breaks"] = by_entry.get(e["id"], [])
        s = parse_dt(e["clock_in"])
        end = parse_dt(e["clock_out"]) or now
        total = (end - s).total_seconds()
        br_total = 0
        for b in e["breaks"]:
            bs = parse_dt(b["start"])
            be = parse_dt(b["end"]) or min(now, end)
            br_total += max(0, (min(be, end) - max(bs, s)).total_seconds())
        e["break_seconds"] = int(br_total)
        e["worked_seconds"] = int(max(0, total - br_total))
    return entries


def cutoff_summary(user, ref=None):
    ref = ref or local_today()
    cs, ce = cutoff_bounds(ref)
    entries = entries_with_seconds(user["id"], local_midnight_utc(cs), local_midnight_utc(ce + timedelta(days=1)))
    worked = sum(e["worked_seconds"] for e in entries)
    workdays = count_workdays(cs, ce)
    expected_hours = workdays * (user.get("shift_hours") or 8)
    salary = user.get("salary_per_cutoff") or 0
    hourly = salary / expected_hours if expected_hours else 0
    return {
        "start": cs.isoformat(), "end": ce.isoformat(), "workdays": workdays,
        "expected_hours": expected_hours, "salary": salary, "hourly_rate": round(hourly, 4),
        "worked_seconds": worked, "earnings": round(worked / 3600 * hourly, 2),
    }


def live_status(user_id):
    entry = q("SELECT * FROM time_entries WHERE user_id=? AND clock_out IS NULL ORDER BY id DESC LIMIT 1",
              (user_id,), one=True)
    brk = None
    if entry:
        brk = q("SELECT * FROM breaks WHERE entry_id=? AND end IS NULL ORDER BY id DESC LIMIT 1",
                (entry["id"],), one=True)
    return entry, brk


def today_seconds(user_id):
    t = local_today()
    es = entries_with_seconds(user_id, local_midnight_utc(t), local_midnight_utc(t + timedelta(days=1)))
    return sum(e["worked_seconds"] for e in es), sum(e["break_seconds"] for e in es)


# ---------------------------------------------------------------- google chat
_ssl_ctx = None
try:
    import certifi
    _ssl_ctx = ssl.create_default_context(cafile=certifi.where())
except Exception:
    _ssl_ctx = ssl.create_default_context()


def valid_webhook(url):
    return url.startswith("https://chat.googleapis.com/")


def chat_post(url, text):
    if not url or not valid_webhook(url):
        return False, "No Google Chat webhook configured"
    try:
        req = urllib.request.Request(url, data=json.dumps({"text": text}).encode("utf-8"),
                                     headers={"Content-Type": "application/json; charset=UTF-8"})
        urllib.request.urlopen(req, timeout=10, context=_ssl_ctx).read()
        return True, "Sent to Google Chat"
    except Exception as e:  # network or webhook error — never block the user's action
        return False, f"Google Chat error: {e}"


def chat_post_async(url, text):
    if url:
        threading.Thread(target=chat_post, args=(url, text), daemon=True).start()


# ---------------------------------------------------------------- auth
def current_user():
    if "user" not in g:
        uid = session.get("uid")
        g.user = q("SELECT * FROM users WHERE id=? AND active=1", (uid,), one=True) if uid else None
    return g.user


def is_exec(u=None):
    u = u or current_user()
    return bool(u and u["role"] == "executive")


def login_required(fn):
    @wraps(fn)
    def wrapper(*a, **kw):
        if not current_user():
            return jsonify(error="Please log in"), 401
        return fn(*a, **kw)
    return wrapper


def exec_required(fn):
    @wraps(fn)
    def wrapper(*a, **kw):
        if not current_user():
            return jsonify(error="Please log in"), 401
        if not is_exec():
            return jsonify(error="Executives only"), 403
        return fn(*a, **kw)
    return wrapper


@app.after_request
def _cache_headers(resp):
    if request.path.startswith("/api/"):
        resp.headers["Cache-Control"] = "no-store"          # always fresh data on reload
        resp.headers["X-App-Version"] = ASSET_VERSION
    elif request.path.startswith("/static/") and resp.status_code in (200, 304):
        resp.headers["Cache-Control"] = ("public, max-age=31536000, immutable" if request.args.get("v") == ASSET_VERSION
                                         else "no-cache")
    return resp


@app.post("/api/client-error")
def client_error():
    """Browsers report JavaScript errors here so they show up in the server logs."""
    d = request.get_json(silent=True) or {}
    u = current_user()
    print(f"[client-error] user={u['email'] if u else '-'} page={str(d.get('page'))[:80]} "
          f"version={str(d.get('version'))[:20]} msg={str(d.get('message'))[:300]} at={str(d.get('where'))[:200]}", flush=True)
    return jsonify(ok=True)


@app.before_request
def _csrf_guard():
    # Same-origin JS always sends this header; cross-site forms cannot.
    if request.path.startswith("/api/") and request.method in ("POST", "PUT", "PATCH", "DELETE"):
        if request.headers.get("X-HH") != "1":
            return jsonify(error="Bad request"), 400


def can_see_user(uid):
    u = current_user()
    return u and (is_exec() or u["id"] == uid)


def body():
    return request.get_json(silent=True) or request.form.to_dict() or {}


def bad(msg, code=400):
    return jsonify(error=msg), code


USER_PUBLIC = ("id", "name", "email", "role", "position", "active", "avatar_file_id")
USER_PRIVATE = USER_PUBLIC + ("salary_per_cutoff", "shift_hours", "phone", "start_date", "bank_name",
                              "bank_account_name", "bank_account_number", "qr_file_id", "must_change_password",
                              "created_at")


def user_out(u, private=False):
    return {k: u.get(k) for k in (USER_PRIVATE if private else USER_PUBLIC)}


_failed_logins = {}  # (ip, email) -> [timestamps]; slows down password guessing
_LOGIN_WINDOW, _LOGIN_MAX = 15 * 60, 8


@app.post("/api/login")
def login():
    d = body()
    email = (d.get("email") or "").strip().lower()
    key, now = (request.remote_addr, email), datetime.now().timestamp()
    recent = [t for t in _failed_logins.get(key, []) if now - t < _LOGIN_WINDOW]
    if len(recent) >= _LOGIN_MAX:
        return bad("Too many failed attempts. Please wait 15 minutes and try again.", 429)
    u = q("SELECT * FROM users WHERE email=? AND active=1", (email,), one=True)
    if not u or not check_password_hash(u["password_hash"], d.get("password") or ""):
        _failed_logins[key] = recent + [now]
        return bad("Incorrect email or password", 401)
    _failed_logins.pop(key, None)
    session.clear()
    session.permanent = True
    session["uid"] = u["id"]
    return jsonify(user=user_out(u, True))


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify(ok=True)


@app.get("/api/me")
@login_required
def me():
    s = settings()
    return jsonify(user=user_out(current_user(), True), settings={
        "company_name": s["company_name"], "currency": s["currency"], "timezone": s["timezone"],
        "company_direction": s["company_direction"]}, statuses=STATUSES, priorities=PRIORITIES,
                   client_types=CLIENT_TYPES, client_statuses=CLIENT_HEALTH)


@app.post("/api/me/password")
@login_required
def change_password():
    d = body()
    u = current_user()
    if not check_password_hash(u["password_hash"], d.get("current") or ""):
        return bad("Current password is incorrect")
    if len(d.get("new") or "") < 8:
        return bad("New password must be at least 8 characters")
    ex("UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?",
       (hash_pw(d["new"]), u["id"]))
    return jsonify(ok=True)


# ---------------------------------------------------------------- users
@app.get("/api/users")
@login_required
def list_users():
    rows = q("SELECT * FROM users ORDER BY active DESC, name")
    if is_exec():
        return jsonify([user_out(r, True) for r in rows])
    return jsonify([user_out(r) for r in rows if r["active"]])


def _user_fields(d):
    out = {}
    for k in ("name", "position", "phone", "start_date", "bank_name", "bank_account_name", "bank_account_number"):
        if k in d:
            out[k] = (d[k] or "").strip()
    for k in ("salary_per_cutoff", "shift_hours"):
        if k in d and d[k] not in (None, ""):
            out[k] = float(d[k])
    return out


@app.post("/api/users")
@exec_required
def create_user():
    d = body()
    email = (d.get("email") or "").strip().lower()
    if not email or "@" not in email or not (d.get("name") or "").strip():
        return bad("Name and a valid email are required")
    if q("SELECT 1 FROM users WHERE email=?", (email,), one=True):
        return bad("A user with that email already exists")
    password = d.get("password") or secrets.token_urlsafe(8)
    role = "executive" if d.get("role") == "executive" else "employee"
    f = _user_fields(d)
    uid = ex("INSERT INTO users(name,email,password_hash,role,created_at) VALUES(?,?,?,?,?)",
             (f.pop("name"), email, hash_pw(password), role, iso(now_utc())))
    if f:
        ex(f"UPDATE users SET {','.join(k + '=?' for k in f)} WHERE id=?", (*f.values(), uid))
    return jsonify(user=user_out(q("SELECT * FROM users WHERE id=?", (uid,), one=True), True),
                   temp_password=password)


@app.put("/api/users/<int:uid>")
@login_required
def update_user(uid):
    if not can_see_user(uid):
        abort(403)
    d = body()
    f = _user_fields(d)
    if not is_exec():  # employees may only edit their own contact + bank details
        f = {k: v for k, v in f.items() if k in ("phone", "bank_name", "bank_account_name", "bank_account_number")}
    else:
        if "role" in d:
            f["role"] = "executive" if d["role"] == "executive" else "employee"
        if "active" in d:
            f["active"] = 1 if d["active"] in (1, True, "1", "true") else 0
        if "email" in d and d["email"]:
            f["email"] = d["email"].strip().lower()
    if f:
        ex(f"UPDATE users SET {','.join(k + '=?' for k in f)} WHERE id=?", (*f.values(), uid))
    return jsonify(user=user_out(q("SELECT * FROM users WHERE id=?", (uid,), one=True), True))


@app.post("/api/users/<int:uid>/reset-password")
@exec_required
def reset_password(uid):
    pw = body().get("password") or secrets.token_urlsafe(8)
    ex("UPDATE users SET password_hash=?, must_change_password=1 WHERE id=?", (hash_pw(pw), uid))
    return jsonify(temp_password=pw)


# ---------------------------------------------------------------- time clock
def status_payload(u):
    entry, brk = live_status(u["id"])
    worked, brk_secs = today_seconds(u["id"])
    return {
        "entry": entry, "break": brk, "on_shift": bool(entry), "on_break": bool(brk),
        "running": bool(entry and not brk), "today_seconds": worked, "today_break_seconds": brk_secs,
        "cutoff": cutoff_summary(u), "server_time": iso(now_utc()),
    }


@app.get("/api/time/status")
@login_required
def time_status():
    return jsonify(status_payload(current_user()))


@app.post("/api/time/clock-in")
@login_required
def clock_in():
    u = current_user()
    if live_status(u["id"])[0]:
        return bad("You are already clocked in")
    now = now_utc()
    ex("INSERT INTO time_entries(user_id,clock_in) VALUES(?,?)", (u["id"], iso(now)))
    chat_post_async(settings()["chat_webhook_shift"],
                    f"🟢 *{u['name']}* started their shift at {fmt_local(now)} ({settings()['timezone']})")
    return jsonify(status_payload(u))


@app.post("/api/time/clock-out")
@login_required
def clock_out():
    u = current_user()
    entry, brk = live_status(u["id"])
    if not entry:
        return bad("You are not clocked in")
    now = iso(now_utc())
    if brk:
        ex("UPDATE breaks SET end=? WHERE id=?", (now, brk["id"]))
    ex("UPDATE time_entries SET clock_out=? WHERE id=?", (now, entry["id"]))
    payload = status_payload(u)
    if settings().get("notify_clock_out") == "1":
        hrs = payload["today_seconds"] / 3600
        chat_post_async(settings()["chat_webhook_shift"],
                        f"🔴 *{u['name']}* ended their shift at {fmt_local(now_utc())} — {hrs:.2f} hrs worked today")
    return jsonify(payload)


@app.post("/api/time/break-start")
@login_required
def break_start():
    u = current_user()
    entry, brk = live_status(u["id"])
    if not entry:
        return bad("Clock in first")
    if brk:
        return bad("You are already on a break")
    kind = body().get("kind") or "Break"
    kind = kind if kind in ("Break", "Lunch") else "Break"
    ex("INSERT INTO breaks(entry_id,user_id,kind,start) VALUES(?,?,?,?)", (entry["id"], u["id"], kind, iso(now_utc())))
    if settings().get("notify_breaks") == "1":
        chat_post_async(settings()["chat_webhook_shift"], f"☕ *{u['name']}* started a {kind.lower()} at {fmt_local(now_utc())}")
    return jsonify(status_payload(u))


@app.post("/api/time/break-end")
@login_required
def break_end():
    u = current_user()
    entry, brk = live_status(u["id"])
    if not brk:
        return bad("You are not on a break")
    ex("UPDATE breaks SET end=? WHERE id=?", (iso(now_utc()), brk["id"]))
    if settings().get("notify_breaks") == "1":
        chat_post_async(settings()["chat_webhook_shift"], f"✅ *{u['name']}* is back from {brk['kind'].lower()}")
    return jsonify(status_payload(u))


def _date_arg(name, default):
    v = request.args.get(name)
    try:
        return date.fromisoformat(v) if v else default
    except ValueError:
        return default


@app.get("/api/time/entries")
@login_required
def time_entries():
    uid = int(request.args.get("user_id") or current_user()["id"])
    if not can_see_user(uid):
        abort(403)
    cs, ce = cutoff_bounds(local_today())
    start, end = _date_arg("start", cs), _date_arg("end", ce)
    entries = entries_with_seconds(uid, local_midnight_utc(start), local_midnight_utc(end + timedelta(days=1)))
    entries.reverse()
    return jsonify(entries=entries, total_seconds=sum(e["worked_seconds"] for e in entries))


@app.post("/api/time/entries")
@exec_required
def add_entry():
    d = body()
    ci, co = parse_dt(d.get("clock_in")), parse_dt(d.get("clock_out"))
    if not ci or not co or co <= ci:
        return bad("Clock-out must be after clock-in")
    eid = ex("INSERT INTO time_entries(user_id,clock_in,clock_out) VALUES(?,?,?)", (int(d["user_id"]), iso(ci), iso(co)))
    return jsonify(id=eid)


@app.put("/api/time/entries/<int:eid>")
@exec_required
def edit_entry(eid):
    d = body()
    ci = parse_dt(d.get("clock_in"))
    co = parse_dt(d.get("clock_out")) if d.get("clock_out") else None
    if not ci or (co and co <= ci):
        return bad("Clock-out must be after clock-in")
    ex("UPDATE time_entries SET clock_in=?, clock_out=? WHERE id=?", (iso(ci), iso(co) if co else None, eid))
    return jsonify(ok=True)


@app.delete("/api/time/entries/<int:eid>")
@exec_required
def delete_entry(eid):
    ex("DELETE FROM breaks WHERE entry_id=?", (eid,))
    ex("DELETE FROM time_entries WHERE id=?", (eid,))
    return jsonify(ok=True)


def payroll_rows(ref):
    rows = []
    for u in q("SELECT * FROM users WHERE active=1 ORDER BY name"):
        c = cutoff_summary(u, ref)
        rows.append({"user_id": u["id"], "name": u["name"], "email": u["email"], "position": u["position"],
                     "bank_name": u["bank_name"], "has_qr": bool(u["qr_file_id"]), **c})
    return rows


@app.get("/api/payroll")
@exec_required
def payroll():
    ref = _date_arg("date", local_today())
    return jsonify(rows=payroll_rows(ref))


@app.get("/api/payroll.csv")
@exec_required
def payroll_csv():
    ref = _date_arg("date", local_today())
    rows = payroll_rows(ref)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Name", "Email", "Position", "Cutoff start", "Cutoff end", "Salary per cutoff", "Expected hours",
                "Hours worked", "Hourly rate", "Earned so far", "Bank", "QR on file"])
    for r in rows:
        w.writerow([r["name"], r["email"], r["position"], r["start"], r["end"], r["salary"], r["expected_hours"],
                    round(r["worked_seconds"] / 3600, 2), round(r["hourly_rate"], 2), r["earnings"],
                    r["bank_name"], "Yes" if r["has_qr"] else "No"])
    cs, ce = cutoff_bounds(ref)
    return Response(buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": f"attachment; filename=payroll_{cs}_{ce}.csv"})


# ---------------------------------------------------------------- executive overview
@app.get("/api/exec/overview")
@exec_required
def exec_overview():
    team = []
    for u in q("SELECT * FROM users WHERE active=1 ORDER BY name"):
        entry, brk = live_status(u["id"])
        worked, _ = today_seconds(u["id"])
        c = cutoff_summary(u)
        team.append({"id": u["id"], "name": u["name"], "avatar_file_id": u["avatar_file_id"], "position": u["position"], "role": u["role"],
                     "status": "On Break" if brk else ("On Shift" if entry else "Off"),
                     "break_kind": brk["kind"] if brk else None,
                     "since": (brk or {}).get("start") or (entry or {}).get("clock_in"),
                     "today_seconds": worked, "earnings": c["earnings"], "hourly_rate": c["hourly_rate"],
                     "worked_seconds": c["worked_seconds"], "salary": c["salary"]})
    counts = {s: 0 for s in STATUSES}
    for r in q("SELECT t.status, COUNT(*) n FROM tasks t JOIN clients c ON c.id=t.client_id "
               "WHERE c.archived=0 AND t.archived_at IS NULL GROUP BY t.status"):
        counts[r["status"]] = r["n"]
    overdue = q("SELECT COUNT(*) n FROM tasks t JOIN clients c ON c.id=t.client_id WHERE c.archived=0 "
                "AND t.archived_at IS NULL AND t.status!='Done' AND t.deadline IS NOT NULL AND t.deadline!='' "
                "AND (t.deadline<? OR (t.deadline=? AND t.deadline_time IS NOT NULL AND t.deadline_time<?))",
                (local_today().isoformat(), local_today().isoformat(), now_utc().astimezone(tz()).strftime("%H:%M")),
                one=True)["n"]
    eods = q("SELECT e.*, u.name user_name, u.avatar_file_id user_avatar FROM eods e JOIN users u ON u.id=e.user_id ORDER BY e.id DESC LIMIT 6")
    incidents = q("SELECT i.*, u.name user_name, u.avatar_file_id user_avatar FROM incidents i JOIN users u ON u.id=i.user_id "
                  "ORDER BY i.id DESC LIMIT 5")
    cs, ce = cutoff_bounds(local_today())
    return jsonify(team=team, task_counts=counts, overdue=overdue, eods=eods, incidents=incidents,
                   cutoff={"start": cs.isoformat(), "end": ce.isoformat()},
                   payroll_accrued=round(sum(t["earnings"] for t in team), 2))


# ---------------------------------------------------------------- clients
@app.get("/api/clients")
@login_required
def list_clients():
    show_archived = request.args.get("archived") == "1" and is_exec()
    rows = q("SELECT c.*, (SELECT COUNT(*) FROM tasks t WHERE t.client_id=c.id AND t.status!='Done' AND t.archived_at IS NULL) open_tasks, "
             "(SELECT COUNT(*) FROM tasks t WHERE t.client_id=c.id) total_tasks "
             "FROM clients c " + ("" if show_archived else "WHERE archived=0 ") + "ORDER BY archived, position, name")
    return jsonify([_client_out(r) for r in rows])


def _client_row(cid):
    return _client_out(q("SELECT c.*, (SELECT COUNT(*) FROM tasks t WHERE t.client_id=c.id AND t.status!='Done' "
                         "AND t.archived_at IS NULL) open_tasks, (SELECT COUNT(*) FROM tasks t WHERE t.client_id=c.id) "
                         "total_tasks FROM clients c WHERE c.id=?", (cid,), one=True))


def _client_out(c):
    # A webhook URL lets anyone post into that Chat space, so only executives see it.
    if c and not is_exec():
        c = {k: v for k, v in c.items() if k != "chat_webhook"}
    return c


@app.post("/api/clients")
@exec_required
def create_client():
    d = body()
    if not (d.get("name") or "").strip():
        return bad("Client name is required")
    hook = (d.get("chat_webhook") or "").strip()
    if hook and not valid_webhook(hook):
        return bad("Google Chat webhook URLs start with https://chat.googleapis.com/")
    pos = (q("SELECT MAX(position) m FROM clients", one=True)["m"] or 0) + 1
    ctype = d.get("client_type") if d.get("client_type") in CLIENT_TYPES else "Stable Client"
    cstatus = d.get("client_status") if d.get("client_status") in CLIENT_HEALTH else "Newly Onboarded"
    cid = ex("INSERT INTO clients(name,color,description,chat_webhook,position,client_type,client_status,created_at) "
             "VALUES(?,?,?,?,?,?,?,?)",
             (d["name"].strip(), d.get("color") or "#0C2E60", d.get("description") or "", hook, pos, ctype, cstatus,
              iso(now_utc())))
    return jsonify(_client_row(cid))


@app.post("/api/clients/reorder")
@exec_required
def reorder_clients():
    ids = [int(i) for i in (body().get("ids") or []) if str(i).isdigit()]
    for pos, cid in enumerate(ids, start=1):
        db().execute("UPDATE clients SET position=? WHERE id=?", (pos, cid))
    db().commit()
    return jsonify(ok=True)


@app.put("/api/clients/<int:cid>")
@exec_required
def update_client(cid):
    d = body()
    f = {k: d[k] for k in ("name", "color", "description") if k in d}
    if d.get("client_type") in CLIENT_TYPES:
        f["client_type"] = d["client_type"]
    if d.get("client_status") in CLIENT_HEALTH:
        f["client_status"] = d["client_status"]
    if "chat_webhook" in d:
        f["chat_webhook"] = (d["chat_webhook"] or "").strip()
        if f["chat_webhook"] and not valid_webhook(f["chat_webhook"]):
            return bad("Google Chat webhook URLs start with https://chat.googleapis.com/")
    if "archived" in d:
        f["archived"] = 1 if d["archived"] in (1, True, "1", "true") else 0
        f["archived_at"] = iso(now_utc()) if f["archived"] else None
    if f:
        ex(f"UPDATE clients SET {','.join(k + '=?' for k in f)} WHERE id=?", (*f.values(), cid))
    return jsonify(_client_row(cid))


# ---------------------------------------------------------------- tasks
TASK_SELECT = ("SELECT t.*, u.name assignee_name, u.avatar_file_id assignee_avatar, c.name client_name, c.color client_color, "
               "(SELECT COUNT(*) FROM files f WHERE f.kind='task' AND f.ref_id=t.id) file_count, "
               "(SELECT COUNT(*) FROM task_links l WHERE l.task_id=t.id) link_count, "
               "(SELECT COUNT(*) FROM task_comments m WHERE m.task_id=t.id) comment_count "
               "FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id JOIN clients c ON c.id=t.client_id ")


@app.get("/api/clients/<int:cid>/tasks")
@login_required
def client_tasks(cid):
    client = q("SELECT * FROM clients WHERE id=?", (cid,), one=True)
    if not client:
        abort(404)
    tasks = q(TASK_SELECT + "WHERE t.client_id=? AND t.archived_at IS NULL ORDER BY t.position, t.id", (cid,))
    archived = q("SELECT COUNT(*) n FROM tasks WHERE client_id=? AND archived_at IS NOT NULL", (cid,), one=True)["n"]
    return jsonify(client=_client_out(client), tasks=tasks, archived_count=archived,
                   auto_archive_days=int(settings().get("auto_archive_days") or 0))


@app.get("/api/tasks/mine")
@login_required
def my_tasks():
    done = "" if request.args.get("include_done") == "1" else "AND t.status!='Done' "
    return jsonify(q(TASK_SELECT + "WHERE t.assignee_id=? " + done + "AND c.archived=0 AND t.archived_at IS NULL "
                     "ORDER BY CASE WHEN t.deadline IS NULL OR t.deadline='' THEN 1 ELSE 0 END, t.deadline, "
                     "COALESCE(t.deadline_time, '99:99'), "
                     "CASE t.priority WHEN 'Urgent' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END",
                     (current_user()["id"],)))


HHMM_RE = re.compile(r"([01]\d|2[0-3]):[0-5]\d")


def _clean_hhmm(v):
    v = (v or "").strip()[:5]
    return v if HHMM_RE.fullmatch(v) else None


def fmt_hhmm(hhmm):
    h, m = (int(x) for x in hhmm.split(":"))
    return f"{h % 12 or 12}:{m:02d} {'AM' if h < 12 else 'PM'}"


def deadline_moment(t):
    """The deadline as a local datetime: the set time, or the end of that day when no time is set."""
    d = date.fromisoformat(t["deadline"])
    hhmm = t.get("deadline_time")
    clock = time(*(int(x) for x in hhmm.split(":"))) if hhmm else time(23, 59, 59)
    return datetime.combine(d, clock, tzinfo=tz())


def finished_on_time(t):
    if not t.get("deadline") or not t.get("completed_at"):
        return None
    return parse_dt(t["completed_at"]) <= deadline_moment(t)


def _local_date(ts):
    return parse_dt(ts).astimezone(tz()).date() if ts else None


def _period_buckets(period, today):
    """Returns bucket start dates (oldest first) and a function giving each bucket's exclusive end."""
    if period == "year":
        return [date(today.year - i, 1, 1) for i in range(4, -1, -1)], lambda d: date(d.year + 1, 1, 1)
    if period == "month":
        starts, y, m = [], today.year, today.month
        for _ in range(12):
            starts.append(date(y, m, 1))
            y, m = (y - 1, 12) if m == 1 else (y, m - 1)
        return starts[::-1], lambda d: date(d.year + (d.month == 12), d.month % 12 + 1, 1)
    ws = today - timedelta(days=today.weekday())
    return [ws - timedelta(weeks=i) for i in range(11, -1, -1)], lambda d: d + timedelta(days=7)


@app.get("/api/tasks/stats")
@login_required
def task_stats():
    period = request.args.get("period") if request.args.get("period") in ("week", "month", "year") else "week"
    client_id = request.args.get("client_id")
    assignee = request.args.get("assignee_id")
    if not is_exec():  # employees only see their own numbers
        assignee = str(current_user()["id"])
    where, args = ["c.archived=0"], []
    if client_id:
        where.append("t.client_id=?")
        args.append(int(client_id))
    if assignee:
        where.append("t.assignee_id=?")
        args.append(int(assignee))
    tasks = q(TASK_SELECT + "WHERE " + " AND ".join(where), args)

    today = local_today()
    starts, end_of = _period_buckets(period, today)
    buckets = [{"start": s_.isoformat(), "end": (end_of(s_) - timedelta(days=1)).isoformat(),
                "completed": 0, "created": 0, "on_time": 0, "with_deadline": 0, "days": []} for s_ in starts]

    def bucket_of(d):
        if not d or d < starts[0]:
            return None
        for i in range(len(starts) - 1, -1, -1):
            if d >= starts[i]:
                return i if d < end_of(starts[i]) else None
        return None

    current_done = []
    for t in tasks:
        cd, dd = _local_date(t["created_at"]), _local_date(t["completed_at"])
        bi = bucket_of(cd)
        if bi is not None:
            buckets[bi]["created"] += 1
        bi = bucket_of(dd)
        if bi is None:
            continue
        b = buckets[bi]
        b["completed"] += 1
        if t["deadline"]:
            b["with_deadline"] += 1
            t["on_time"] = finished_on_time(t)
            b["on_time"] += t["on_time"]
        if cd:
            b["days"].append((dd - cd).days)
        if bi == len(buckets) - 1:
            current_done.append(t)

    for b in buckets:
        days = b.pop("days")
        b["avg_days"] = round(sum(days) / len(days), 1) if days else None
        b["on_time_rate"] = round(b["on_time"] / b["with_deadline"] * 100) if b["with_deadline"] else None

    def breakdown(key, label_key, extra=None):
        out = {}
        for t in current_done:
            k = t[key] or 0
            row = out.setdefault(k, {"id": k, "name": t[label_key] or "Unassigned", "completed": 0})
            if extra:
                row[extra] = t.get(extra)
            row["completed"] += 1
        return sorted(out.values(), key=lambda r: -r["completed"])

    open_tasks = [t for t in tasks if t["status"] != "Done" and not t["archived_at"]]
    current_done.sort(key=lambda t: t["completed_at"], reverse=True)
    return jsonify(
        period=period, buckets=buckets,
        by_assignee=breakdown("assignee_id", "assignee_name", "assignee_avatar"),
        by_client=breakdown("client_id", "client_name", "client_color"),
        by_priority=[{"name": p_, "completed": sum(1 for t in current_done if t["priority"] == p_)} for p_ in PRIORITIES],
        open_by_status={s_: sum(1 for t in open_tasks if t["status"] == s_) for s_ in STATUSES if s_ != "Done"},
        overdue=sum(1 for t in open_tasks if t["deadline"] and deadline_moment(t) < now_utc()),
        completed_list=[{k: t.get(k) for k in ("id", "title", "client_name", "client_color", "assignee_name",
                                               "assignee_avatar", "priority", "deadline", "deadline_time", "completed_at", "on_time")}
                        for t in current_done[:100]],
    )


# ---------------------------------------------------------------- archive
def auto_archive():
    """Done tasks leave the board N days after completion (they stay searchable in the Archive)."""
    days = int(settings().get("auto_archive_days") or 0)
    if days <= 0:
        return 0
    cutoff = iso(now_utc() - timedelta(days=days))
    cur = db().execute("UPDATE tasks SET archived_at=?, archived_by=NULL WHERE status='Done' AND archived_at IS NULL "
                       "AND completed_at IS NOT NULL AND completed_at<? AND (restored_at IS NULL OR restored_at<?)",
                       (iso(now_utc()), cutoff, cutoff))
    db().commit()
    return cur.rowcount


@app.post("/api/tasks/<int:tid>/archive")
@login_required
def archive_task(tid):
    ex("UPDATE tasks SET archived_at=?, archived_by=? WHERE id=? AND archived_at IS NULL",
       (iso(now_utc()), current_user()["id"], tid))
    return jsonify(_task_full(tid))


@app.post("/api/tasks/<int:tid>/restore")
@login_required
def restore_task(tid):
    ex("UPDATE tasks SET archived_at=NULL, archived_by=NULL, restored_at=? WHERE id=?", (iso(now_utc()), tid))
    return jsonify(_task_full(tid))


@app.post("/api/clients/<int:cid>/archive-done")
@login_required
def archive_done(cid):
    cur = db().execute("UPDATE tasks SET archived_at=?, archived_by=? WHERE client_id=? AND status='Done' AND archived_at IS NULL",
                       (iso(now_utc()), current_user()["id"], cid))
    db().commit()
    return jsonify(archived=cur.rowcount)


@app.get("/api/archive/tasks")
@login_required
def archived_tasks():
    where, args = ["t.archived_at IS NOT NULL"], []
    if request.args.get("client_id"):
        where.append("t.client_id=?")
        args.append(int(request.args["client_id"]))
    if request.args.get("assignee_id"):
        where.append("t.assignee_id=?")
        args.append(int(request.args["assignee_id"]))
    if request.args.get("status") == "done":
        where.append("t.status='Done'")
    elif request.args.get("status") == "open":
        where.append("t.status!='Done'")
    term = (request.args.get("q") or "").strip()
    if term:
        where.append("(t.title LIKE ? OR t.description LIKE ? OR EXISTS (SELECT 1 FROM task_comments m "
                     "WHERE m.task_id=t.id AND m.body LIKE ?))")
        args += [f"%{term}%"] * 3
    sql_where = " AND ".join(where)
    total = q("SELECT COUNT(*) n FROM tasks t WHERE " + sql_where, args, one=True)["n"]
    limit = min(int(request.args.get("limit") or 50), 200)
    offset = max(int(request.args.get("offset") or 0), 0)
    rows = q("SELECT t.*, u.name assignee_name, u.avatar_file_id assignee_avatar, c.name client_name, c.color client_color, "
             "c.archived client_archived, ab.name archived_by_name, "
             "(SELECT COUNT(*) FROM task_comments m WHERE m.task_id=t.id) comment_count "
             "FROM tasks t JOIN clients c ON c.id=t.client_id LEFT JOIN users u ON u.id=t.assignee_id "
             "LEFT JOIN users ab ON ab.id=t.archived_by WHERE " + sql_where +
             f" ORDER BY t.archived_at DESC, t.completed_at DESC, t.id DESC LIMIT {limit} OFFSET {offset}", args)
    return jsonify(total=total, items=rows)


def _task_full(tid):
    t = q(TASK_SELECT + "WHERE t.id=?", (tid,), one=True)
    if not t:
        abort(404)
    t["files"] = q("SELECT f.*, u.name uploader FROM files f LEFT JOIN users u ON u.id=f.owner_id "
                   "WHERE f.kind='task' AND f.ref_id=? ORDER BY f.id", (tid,))
    t["links"] = q("SELECT * FROM task_links WHERE task_id=? ORDER BY id", (tid,))
    rule = q("SELECT id, title FROM recurring_rules WHERE id=?", (t["recurring_rule_id"],), one=True) if t.get("recurring_rule_id") else None
    t["automation"] = rule
    if t.get("archived_by"):
        t["archived_by_name"] = (q("SELECT name FROM users WHERE id=?", (t["archived_by"],), one=True) or {}).get("name")
    return t


def _task_fields(d):
    f = {}
    for k in ("title", "description", "notes", "deadline"):
        if k in d:
            f[k] = (d[k] or "").strip()
    if d.get("priority") in PRIORITIES:
        f["priority"] = d["priority"]
    if d.get("status") in STATUSES:
        f["status"] = d["status"]
    if "assignee_id" in d:
        f["assignee_id"] = int(d["assignee_id"]) if d["assignee_id"] not in (None, "", "0", 0) else None
    if "deadline_time" in d:
        f["deadline_time"] = _clean_hhmm(d["deadline_time"])
    if "deadline" in f and not f["deadline"]:
        f["deadline_time"] = None  # no date, no time
    return f


@app.get("/api/tasks/<int:tid>")
@login_required
def get_task(tid):
    return jsonify(_task_full(tid))


@app.post("/api/tasks")
@login_required
def create_task():
    d = body()
    f = _task_fields(d)
    if not f.get("title"):
        return bad("Task title is required")
    cid = int(d.get("client_id") or 0)
    if not q("SELECT 1 FROM clients WHERE id=?", (cid,), one=True):
        return bad("Choose a client")
    status = f.get("status", "Not Started")
    pos = (q("SELECT MAX(position) m FROM tasks WHERE client_id=? AND status=?", (cid, status), one=True)["m"] or 0) + 1
    now = iso(now_utc())
    tid = ex("INSERT INTO tasks(client_id,title,description,notes,priority,assignee_id,deadline,deadline_time,status,"
             "position,created_by,created_at,updated_at,completed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
             (cid, f["title"], f.get("description", ""), f.get("notes", ""), f.get("priority", "Medium"),
              f.get("assignee_id"), f.get("deadline") or None, f.get("deadline_time") if f.get("deadline") else None,
              status, pos, current_user()["id"], now, now, now if status == "Done" else None))
    notify(f.get("assignee_id"), "assigned", tid, actor_id=current_user()["id"])
    if d.get("defer_alert") not in (True, "1", 1, "true"):
        task_chat_event("created", tid, actor=current_user()["name"])
    return jsonify(_task_full(tid))


@app.post("/api/tasks/<int:tid>/announce")
@login_required
def announce_task(tid):
    """Sends the 'new task' Chat alert once the creator has finished attaching files and links."""
    task_chat_event("created", tid, actor=current_user()["name"])
    return jsonify(ok=True)


@app.put("/api/tasks/<int:tid>")
@login_required
def update_task(tid):
    d = body()
    f = _task_fields(d)
    if "title" in f and not f["title"]:
        return bad("Task title is required")
    current = q("SELECT assignee_id FROM tasks WHERE id=?", (tid,), one=True)
    if not current:
        abort(404)
    if any(k in d for k in ("block_date", "block_start", "block_end")):
        if not (is_exec() or current["assignee_id"] == current_user()["id"]):
            return bad("Only the person assigned to this task can set its time block", 403)
        block = _block_fields(d)
        if isinstance(block, str):
            return bad(block)
        f.update(block)
    if "assignee_id" in f and f["assignee_id"] != current["assignee_id"]:
        f.update(block_date=None, block_start=None, block_end=None)  # a time block belongs to its assignee
    if "status" in f:
        prev = q("SELECT status, completed_at FROM tasks WHERE id=?", (tid,), one=True) or {}
        if f["status"] != "Done":
            f["completed_at"] = None
        elif prev.get("status") != "Done":
            f["completed_at"] = iso(now_utc())
    prev_assignee = (q("SELECT assignee_id FROM tasks WHERE id=?", (tid,), one=True) or {}).get("assignee_id")
    if f:
        f["updated_at"] = iso(now_utc())
        ex(f"UPDATE tasks SET {','.join(k + '=?' for k in f)} WHERE id=?", (*f.values(), tid))
    if f.get("assignee_id") and f["assignee_id"] != prev_assignee:
        notify(f["assignee_id"], "assigned", tid, actor_id=current_user()["id"])
        task_chat_event("assigned", tid, actor=current_user()["name"])
    if "status" in f and f["status"] != prev.get("status"):
        task_chat_event("status", tid, actor=current_user()["name"], old_status=prev.get("status"))
    return jsonify(_task_full(tid))


def _block_fields(d):
    """Validates a time block. Empty date clears it. Returns fields, or an error message."""
    day = (d.get("block_date") or "").strip()
    if not day:
        return {"block_date": None, "block_start": None, "block_end": None}
    try:
        date.fromisoformat(day)
    except ValueError:
        return "Pick a valid date for the time block"
    start, end = _clean_hhmm(d.get("block_start")), _clean_hhmm(d.get("block_end"))
    if not start or not end:
        return "Set a start and end time for the time block"
    if end <= start:
        return "The time block must end after it starts"
    return {"block_date": day, "block_start": start, "block_end": end}


@app.get("/api/schedule")
@login_required
def schedule():
    """Time-blocked tasks for one day. Employees see their own; executives can see anyone's or the whole team."""
    day = request.args.get("date") or local_today().isoformat()
    who = request.args.get("user_id") or str(current_user()["id"])
    where, args = ["t.block_date=?", "t.archived_at IS NULL", "c.archived=0"], [day]
    if who == "all":
        if not is_exec():
            abort(403)
    else:
        if int(who) != current_user()["id"] and not is_exec():
            abort(403)
        where.append("t.assignee_id=?")
        args.append(int(who))
    rows = q(TASK_SELECT + "WHERE " + " AND ".join(where) + " ORDER BY t.block_start, t.block_end", args)
    return jsonify(date=day, items=rows)


@app.post("/api/tasks/reorder")
@login_required
def reorder_tasks():
    d = body()
    if d.get("status") not in STATUSES:
        return bad("Invalid status")
    now = iso(now_utc())
    ids = [int(x) for x in (d.get("ids") or [])]
    before = {r["id"]: r["status"] for r in q(
        f"SELECT id, status FROM tasks WHERE id IN ({','.join('?' * len(ids))})", ids)} if ids else {}
    for i, tid in enumerate(ids):
        db().execute("UPDATE tasks SET status=?, position=?, updated_at=CASE WHEN status!=? THEN ? ELSE updated_at END, "
                     "completed_at=CASE WHEN ?!='Done' THEN NULL WHEN status='Done' THEN completed_at ELSE ? END "
                     "WHERE id=?", (d["status"], i, d["status"], now, d["status"], now, int(tid)))
    db().commit()
    for tid, old in before.items():
        if old != d["status"]:
            task_chat_event("status", tid, actor=current_user()["name"], old_status=old)
    return jsonify(ok=True)


@app.delete("/api/tasks/<int:tid>")
@exec_required
def delete_task(tid):
    for f in q("SELECT * FROM files WHERE kind='task' AND ref_id=?", (tid,)):
        _remove_file(f)
    ex("DELETE FROM notifications WHERE task_id=?", (tid,))
    ex("DELETE FROM task_comments WHERE task_id=?", (tid,))
    ex("DELETE FROM tasks WHERE id=?", (tid,))
    return jsonify(ok=True)


@app.post("/api/tasks/<int:tid>/links")
@login_required
def add_link(tid):
    d = body()
    url = (d.get("url") or "").strip()
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    ex("INSERT INTO task_links(task_id,url,label,created_at) VALUES(?,?,?,?)",
       (tid, url, (d.get("label") or "").strip(), iso(now_utc())))
    return jsonify(_task_full(tid))


@app.delete("/api/task-links/<int:lid>")
@login_required
def delete_link(lid):
    ex("DELETE FROM task_links WHERE id=?", (lid,))
    return jsonify(ok=True)


# ---------------------------------------------------------------- comments, mentions & notifications
MENTION_RE = re.compile(r"@\[([^\]\n]{1,80})\]\((\d+)\)")  # stored as @[Name](user_id)


def notify(user_id, kind, task_id, actor_id=None, comment_id=None, snippet=""):
    if not user_id or user_id == actor_id:
        return
    ex("INSERT INTO notifications(user_id,actor_id,kind,task_id,comment_id,snippet,created_at) VALUES(?,?,?,?,?,?,?)",
       (user_id, actor_id, kind, task_id, comment_id, snippet[:240], iso(now_utc())))


def _plain(text):
    return MENTION_RE.sub(lambda m: "@" + m.group(1), text)


def _comment_rows(where, args):
    return q("SELECT m.*, u.name user_name, u.avatar_file_id user_avatar FROM task_comments m "
             "LEFT JOIN users u ON u.id=m.user_id WHERE " + where + " ORDER BY m.id", args)


@app.get("/api/tasks/<int:tid>/comments")
@login_required
def list_comments(tid):
    return jsonify(_comment_rows("m.task_id=?", (tid,)))


@app.post("/api/tasks/<int:tid>/comments")
@login_required
def add_comment(tid):
    u = current_user()
    text = (body().get("body") or "").strip()
    if not text:
        return bad("Write a comment first")
    if len(text) > 5000:
        return bad("Comment is too long (5,000 characters max)")
    task = q("SELECT * FROM tasks WHERE id=?", (tid,), one=True)
    if not task:
        abort(404)
    cid = ex("INSERT INTO task_comments(task_id,user_id,body,created_at) VALUES(?,?,?,?)", (tid, u["id"], text, iso(now_utc())))
    snippet = _plain(text)
    active = {r["id"] for r in q("SELECT id FROM users WHERE active=1")}
    mentioned = {int(m.group(2)) for m in MENTION_RE.finditer(text)} & active
    for uid in mentioned:
        notify(uid, "mention", tid, actor_id=u["id"], comment_id=cid, snippet=snippet)
    # Everyone else involved in the task hears about new comments too.
    watchers = {task["assignee_id"], task["created_by"]} | {r["user_id"] for r in q(
        "SELECT DISTINCT user_id FROM task_comments WHERE task_id=?", (tid,))}
    for uid in (watchers & active) - mentioned:
        notify(uid, "comment", tid, actor_id=u["id"], comment_id=cid, snippet=snippet)
    ex("UPDATE tasks SET updated_at=? WHERE id=?", (iso(now_utc()), tid))
    task_chat_event("comment", tid, actor=u["name"], snippet=snippet)
    return jsonify(_comment_rows("m.id=?", (cid,))[0])


@app.put("/api/comments/<int:cid>")
@login_required
def edit_comment(cid):
    c = q("SELECT * FROM task_comments WHERE id=?", (cid,), one=True)
    if not c:
        abort(404)
    if c["user_id"] != current_user()["id"]:
        abort(403)
    text = (body().get("body") or "").strip()
    if not text:
        return bad("Comment can't be empty")
    before = {int(m.group(2)) for m in MENTION_RE.finditer(c["body"])}
    ex("UPDATE task_comments SET body=?, edited_at=? WHERE id=?", (text, iso(now_utc()), cid))
    active = {r["id"] for r in q("SELECT id FROM users WHERE active=1")}
    for uid in ({int(m.group(2)) for m in MENTION_RE.finditer(text)} - before) & active:  # only newly tagged people
        notify(uid, "mention", c["task_id"], actor_id=current_user()["id"], comment_id=cid, snippet=_plain(text))
    return jsonify(_comment_rows("m.id=?", (cid,))[0])


@app.delete("/api/comments/<int:cid>")
@login_required
def delete_comment(cid):
    c = q("SELECT * FROM task_comments WHERE id=?", (cid,), one=True)
    if not c:
        abort(404)
    if not (c["user_id"] == current_user()["id"] or is_exec()):
        abort(403)
    ex("DELETE FROM notifications WHERE comment_id=?", (cid,))
    ex("DELETE FROM task_comments WHERE id=?", (cid,))
    return jsonify(ok=True)


@app.get("/api/notifications")
@login_required
def list_notifications():
    uid = current_user()["id"]
    where, args = ["n.user_id=?"], [uid]
    if request.args.get("kind") == "mention":
        where.append("n.kind='mention'")
    if request.args.get("unread") == "1":
        where.append("n.read_at IS NULL")
    limit = min(int(request.args.get("limit") or 50), 200)
    rows = q("SELECT n.*, a.name actor_name, a.avatar_file_id actor_avatar, t.title task_title, t.client_id, "
             "c.name client_name, c.color client_color FROM notifications n LEFT JOIN users a ON a.id=n.actor_id "
             "LEFT JOIN tasks t ON t.id=n.task_id LEFT JOIN clients c ON c.id=t.client_id "
             "WHERE " + " AND ".join(where) + f" ORDER BY n.id DESC LIMIT {limit}", args)
    counts = q("SELECT COUNT(*) unread, SUM(kind='mention') mentions FROM notifications WHERE user_id=? AND read_at IS NULL",
               (uid,), one=True)
    return jsonify(items=rows, unread=counts["unread"] or 0, unread_mentions=counts["mentions"] or 0)


@app.get("/api/notifications/count")
@login_required
def notification_count():
    r = q("SELECT COUNT(*) unread, SUM(kind='mention') mentions FROM notifications WHERE user_id=? AND read_at IS NULL",
          (current_user()["id"],), one=True)
    return jsonify(unread=r["unread"] or 0, unread_mentions=r["mentions"] or 0)


@app.post("/api/notifications/read")
@login_required
def mark_notifications_read():
    d = body()
    uid, now = current_user()["id"], iso(now_utc())
    if d.get("all"):
        ex("UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL", (now, uid))
    elif d.get("task_id"):
        ex("UPDATE notifications SET read_at=? WHERE user_id=? AND task_id=? AND read_at IS NULL", (now, uid, int(d["task_id"])))
    else:
        ids = [int(i) for i in (d.get("ids") or [])][:500]
        if ids:
            ex(f"UPDATE notifications SET read_at=? WHERE user_id=? AND id IN ({','.join('?' * len(ids))})", (now, uid, *ids))
    return jsonify(ok=True)


# ---------------------------------------------------------------- Google Chat task alerts
def _app_base():
    base = (settings().get("app_url") or "").strip().rstrip("/")
    if not base and has_request_context():
        base = request.host_url.rstrip("/")
    return base


def _task_link(t):
    base = _app_base()
    return f"<{base}/#/board/{t['client_id']}?task={t['id']}|Link>" if base else ""


def _task_hook(t):
    return (t.get("client_hook") or "").strip() or settings().get("chat_webhook_tasks") or ""


def _due_text(deadline):
    if not deadline:
        return ""
    d = date.fromisoformat(deadline)
    return f"{d:%b} {d.day}"


def _deliverable_lines(t):
    """The task's own links and files, so completed work can be opened straight from Chat."""
    clean = lambda text: (text or "").replace("|", "/").replace(">", "").replace("<", "")
    base = _app_base()
    links = q("SELECT url, label FROM task_links WHERE task_id=? ORDER BY id", (t["id"],))
    files = q("SELECT id, original_name FROM files WHERE kind='task' AND ref_id=? ORDER BY id", (t["id"],))
    out = []
    if links:
        out += ["", "Links:"] + [f"• <{l['url']}|{clean(l['label'] or l['url'])}>" for l in links]
    if files:
        out += ["", "Files:"] + [f"• <{base}/api/files/{f['id']}|{clean(f['original_name'])}>" if base
                                 else f"• {clean(f['original_name'])}" for f in files]
    return out


def task_chat_event(kind, tid, actor=None, old_status=None, snippet=""):
    """Posts a task update to Google Chat if that alert type is switched on. Never raises."""
    try:
        s = settings()
        t = q("SELECT t.*, c.name client_name, c.chat_webhook client_hook, u.name assignee_name FROM tasks t "
              "JOIN clients c ON c.id=t.client_id LEFT JOIN users u ON u.id=t.assignee_id WHERE t.id=?", (tid,), one=True)
        if not t:
            return
        if kind == "status" and t["status"] == "Done":
            kind = "done"
        if s.get({"created": "task_alert_created", "assigned": "task_alert_assigned", "status": "task_alert_status",
                  "done": "task_alert_done", "comment": "task_alert_comment"}[kind]) != "1":
            return
        hook = (s.get("chat_webhook_tasks_done") or "").strip() if kind == "done" else ""
        hook = hook or _task_hook(t)
        if not hook:
            return

        def label(status):
            return (status or "—").capitalize()  # "Not Started" -> "Not started"

        def due():
            if not t["deadline"]:
                return "No due date"
            d = date.fromisoformat(t["deadline"])
            at = f" at {fmt_hhmm(t['deadline_time'])}" if t.get("deadline_time") else ""
            return f"{d:%b} {d.day}, {d.year}{at}"

        task_lines = [f"Task: {t['title']}", f"Client: {t['client_name']}"]
        common = [f"Assigned to: {t['assignee_name'] or 'Unassigned'}", f"Due date: {due()}",
                  f"Priority: {t['priority']}", f"Status: {label(t['status'])}"]
        if kind == "created":
            lines = ["📌 *NEW TASK CREATED*", ""] + task_lines + common
        elif kind == "assigned":
            lines = ["👤 *TASK ASSIGNED*", ""] + task_lines + common + ([f"Assigned by: {actor}"] if actor else [])
        elif kind == "status":
            lines = ["🔄 *TASK STATUS UPDATED*", ""] + task_lines + [
                f"Status: {label(old_status)} → {label(t['status'])}", f"Assigned to: {t['assignee_name'] or 'Unassigned'}",
                f"Due date: {due()}", f"Priority: {t['priority']}"] + ([f"Updated by: {actor}"] if actor else [])
        elif kind == "done":
            timing = ""
            if t["deadline"] and t["completed_at"]:
                if finished_on_time(t):
                    timing = "On time"
                else:
                    late = parse_dt(t["completed_at"]) - deadline_moment(t)
                    days, hours = late.days, late.seconds // 3600
                    timing = (f"{days} day{'s' if days != 1 else ''} late" if days >= 1
                              else f"{max(hours, 1)} hour{'s' if max(hours, 1) != 1 else ''} late")
            lines = ["✅ *TASK COMPLETED*", ""] + task_lines + [
                f"Completed by: {actor or t['assignee_name'] or '—'}", f"Due date: {due()}"] + (
                [f"Timing: {timing}"] if timing else []) + [f"Priority: {t['priority']}"] + _deliverable_lines(t)
        else:
            lines = ["💬 *NEW COMMENT*", ""] + task_lines + [f"Comment by: {actor}", f"Comment: “{snippet[:300]}”"]
        link = _task_link(t)
        chat_post_async(hook, "\n".join(lines + (["", f"🔗 {link}"] if link else [])))
    except Exception as e:
        print("Task chat alert error:", e)


def build_digests(today):
    """One message per Chat space: overdue + due today, grouped by client."""
    rows = q("SELECT t.*, c.name client_name, c.chat_webhook client_hook, u.name assignee_name FROM tasks t "
             "JOIN clients c ON c.id=t.client_id LEFT JOIN users u ON u.id=t.assignee_id "
             "WHERE c.archived=0 AND t.archived_at IS NULL AND t.status!='Done' AND t.deadline IS NOT NULL "
             "AND t.deadline!='' AND t.deadline<=? "
             "ORDER BY c.name, t.deadline, t.priority", (today.isoformat(),))
    by_hook = {}
    for t in rows:
        hook = _task_hook(t)
        if hook:
            by_hook.setdefault(hook, {}).setdefault(t["client_name"], []).append(t)
    base = _app_base()
    messages = []
    for hook, clients in by_hook.items():
        lines = [f"📋 *Daily task digest* · {today:%A, %b} {today.day}"]
        for client, items in clients.items():
            overdue = [t for t in items if t["deadline"] < today.isoformat()]
            due = [t for t in items if t["deadline"] == today.isoformat()]
            lines += ["", f"*{client}*" + (f"  <{base}/#/board/{items[0]['client_id']}|Open board>" if base else "")]
            for label, group in (("⚠️ Overdue", overdue), ("📅 Due today", sorted(due, key=lambda t: t["deadline_time"] or "99"))):
                if group:
                    lines.append(f"{label} ({len(group)})")
                    for t in group[:12]:
                        who = t["assignee_name"] or "Unassigned"
                        when = (f" · due {_due_text(t['deadline'])}" if label.startswith("⚠")
                                else f" · by {fmt_hhmm(t['deadline_time'])}" if t["deadline_time"] else "")
                        lines.append(f"• {t['title']} — {who}{when}")
                    if len(group) > 12:
                        lines.append(f"• …and {len(group) - 12} more")
        messages.append((hook, "\n".join(lines)[:4000]))
    return messages


def run_task_digest(force=False):
    s = settings()
    if not force:
        if s.get("task_alert_digest") != "1":
            return 0
        now_local = now_utc().astimezone(tz())
        today = now_local.date()
        if today.weekday() not in work_days_set() or s.get("task_digest_last") == today.isoformat():
            return 0
        hh, mm = (int(x) for x in (s.get("task_digest_time") or "09:00").split(":"))
        if (now_local.hour, now_local.minute) < (hh, mm):
            return 0
        claimed = db().execute("UPDATE settings SET value=? WHERE key='task_digest_last' AND value=?",
                               (today.isoformat(), s.get("task_digest_last") or ""))
        db().commit()
        g.pop("settings", None)
        if claimed.rowcount != 1:
            return 0
    else:
        today = local_today()
    msgs = build_digests(today)
    for hook, text in msgs:
        chat_post_async(hook, text)
    return len(msgs)


@app.post("/api/settings/send-digest")
@exec_required
def send_digest_now():
    if not settings().get("chat_webhook_tasks") and not q(
            "SELECT 1 FROM clients WHERE archived=0 AND COALESCE(chat_webhook,'')!='' LIMIT 1", one=True):
        return bad("Add a task-alerts webhook first (here, or on a client under Clients → Edit)")
    n = run_task_digest(force=True)
    return jsonify(ok=True, message=f"Digest sent to {n} Chat space{'s' if n != 1 else ''}" if n
                   else "Nothing overdue or due today — no digest needed")


@app.post("/api/clients/<int:cid>/test-webhook")
@exec_required
def test_client_webhook(cid):
    c = q("SELECT * FROM clients WHERE id=?", (cid,), one=True)
    if not c:
        abort(404)
    url = (body().get("url") or c["chat_webhook"] or "").strip()
    ok, msg = chat_post(url, f"✅ Test message from Her Haus Hub — task alerts for *{c['name']}* will post here")
    return jsonify(ok=ok, message=msg), (200 if ok else 400)


# ---------------------------------------------------------------- recurring task automations
FREQUENCIES = ("daily", "weekdays", "weekly", "monthly")
RULE_FIELDS = ("title", "description", "notes", "priority", "assignee_id", "start_status", "frequency", "weekdays",
               "day_of_month", "run_time", "due_in_days", "due_time", "skip_if_open", "active")


def _rule_matches(rule, d):
    f = rule["frequency"]
    if f == "daily":
        return True
    if f == "weekdays":
        return d.weekday() < 5
    if f == "weekly":
        return str(d.weekday()) in (rule["weekdays"] or "").split(",")
    last = calendar.monthrange(d.year, d.month)[1]
    return d.day == min(int(rule["day_of_month"] or 1), last)


def next_run_after(rule, after_utc):
    """Next scheduled moment strictly after `after_utc`, in the company timezone; returns UTC datetime."""
    hh, mm = (int(x) for x in (rule["run_time"] or "08:00").split(":"))
    local = after_utc.astimezone(tz())
    for i in range(0, 400):
        d = local.date() + timedelta(days=i)
        if _rule_matches(rule, d):
            cand = datetime.combine(d, time(hh, mm), tzinfo=tz())
            if cand > local:
                return cand.astimezone(timezone.utc)
    return None


def create_task_from_rule(rule):
    now = now_utc()
    deadline = deadline_time = None
    if rule["due_in_days"] is not None and rule["due_in_days"] != "":
        deadline = (local_today() + timedelta(days=int(rule["due_in_days"]))).isoformat()
        deadline_time = _clean_hhmm(rule.get("due_time"))
    status = rule["start_status"] if rule["start_status"] in STATUSES else "Not Started"
    pos = (q("SELECT MAX(position) m FROM tasks WHERE client_id=? AND status=?", (rule["client_id"], status), one=True)["m"] or 0) + 1
    tid = ex("INSERT INTO tasks(client_id,title,description,notes,priority,assignee_id,deadline,deadline_time,status,"
             "position,created_by,created_at,updated_at,completed_at,recurring_rule_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
             (rule["client_id"], rule["title"], rule["description"], "", rule["priority"], rule["assignee_id"],
              deadline, deadline_time, status, pos, rule["created_by"], iso(now), iso(now), iso(now) if status == "Done" else None, rule["id"]))
    ex("UPDATE recurring_rules SET last_run_at=?, last_task_id=? WHERE id=?", (iso(now), tid, rule["id"]))
    notify(rule["assignee_id"], "assigned", tid, actor_id=None, snippet="Recurring task")
    task_chat_event("created", tid, actor="Automation")
    return tid


def run_due_rules():
    """Create tasks for every automation whose time has come. Safe to call from several workers at once."""
    now = now_utc()
    created = 0
    for rule in q("SELECT r.* FROM recurring_rules r JOIN clients c ON c.id=r.client_id "
                  "WHERE r.active=1 AND c.archived=0 AND r.next_run_at IS NOT NULL AND r.next_run_at<=?", (iso(now),)):
        nxt = next_run_after(rule, now)  # missed runs (server was off) collapse into one task
        claimed = db().execute("UPDATE recurring_rules SET next_run_at=? WHERE id=? AND next_run_at=?",
                               (iso(nxt) if nxt else None, rule["id"], rule["next_run_at"]))
        db().commit()
        if claimed.rowcount != 1:
            continue
        if rule["skip_if_open"] and rule["last_task_id"]:
            prev = q("SELECT status, archived_at FROM tasks WHERE id=?", (rule["last_task_id"],), one=True)
            if prev and prev["status"] != "Done" and not prev["archived_at"]:
                continue
        create_task_from_rule(rule)
        created += 1
    return created


def _scheduler_loop():
    import time as _time
    while True:
        try:
            with app.app_context():
                run_due_rules()
                run_task_digest()
                auto_archive()
        except Exception as e:  # keep the scheduler alive no matter what
            print("Automation scheduler error:", e)
        _time.sleep(30)


def _rule_fields(d):
    f = {}
    for k in ("title", "description", "notes"):
        if k in d:
            f[k] = (d[k] or "").strip()
    if d.get("priority") in PRIORITIES:
        f["priority"] = d["priority"]
    if d.get("start_status") in STATUSES:
        f["start_status"] = d["start_status"]
    if "assignee_id" in d:
        f["assignee_id"] = int(d["assignee_id"]) if d["assignee_id"] not in (None, "", "0", 0) else None
    if d.get("frequency") in FREQUENCIES:
        f["frequency"] = d["frequency"]
    if "weekdays" in d:
        days = d["weekdays"] if isinstance(d["weekdays"], list) else str(d["weekdays"]).split(",")
        f["weekdays"] = ",".join(sorted({str(int(x)) for x in days if str(x).strip().isdigit() and 0 <= int(x) <= 6}))
    if "day_of_month" in d and str(d["day_of_month"]).strip():
        f["day_of_month"] = max(1, min(31, int(d["day_of_month"])))
    if "run_time" in d:
        try:
            hh, mm = (int(x) for x in str(d["run_time"]).split(":")[:2])
            f["run_time"] = f"{max(0, min(23, hh)):02d}:{max(0, min(59, mm)):02d}"
        except ValueError:
            pass
    if "due_in_days" in d:
        v = str(d["due_in_days"]).strip()
        f["due_in_days"] = max(0, min(365, int(v))) if v.lstrip("-").isdigit() else None
    if "due_time" in d:
        f["due_time"] = _clean_hhmm(d["due_time"])
    for k in ("skip_if_open", "active"):
        if k in d:
            f[k] = 1 if d[k] in (1, True, "1", "true", "on") else 0
    return f


def _validate_rule(r):
    if not (r.get("title") or "").strip():
        return "Task title is required"
    if r.get("frequency") == "weekly" and not r.get("weekdays"):
        return "Pick at least one day of the week"
    return None


def _rule_out(rid):
    return q("SELECT r.*, u.name assignee_name, u.avatar_file_id assignee_avatar, "
             "(SELECT COUNT(*) FROM tasks t WHERE t.recurring_rule_id=r.id) tasks_created "
             "FROM recurring_rules r LEFT JOIN users u ON u.id=r.assignee_id WHERE r.id=?", (rid,), one=True)


@app.get("/api/clients/<int:cid>/automations")
@login_required
def list_automations(cid):
    ids = [r["id"] for r in q("SELECT id FROM recurring_rules WHERE client_id=? ORDER BY active DESC, title", (cid,))]
    return jsonify([_rule_out(i) for i in ids])


@app.post("/api/automations")
@login_required
def create_automation():
    d = body()
    cid = int(d.get("client_id") or 0)
    if not q("SELECT 1 FROM clients WHERE id=?", (cid,), one=True):
        return bad("Choose a client")
    f = {"priority": "Medium", "start_status": "Not Started", "frequency": "weekly", "weekdays": "0",
         "day_of_month": 1, "run_time": "08:00", "due_in_days": None, "skip_if_open": 0, "active": 1, **_rule_fields(d)}
    err = _validate_rule(f)
    if err:
        return bad(err)
    f.update(client_id=cid, created_by=current_user()["id"], created_at=iso(now_utc()))
    nxt = next_run_after(f, now_utc())
    f["next_run_at"] = iso(nxt) if nxt else None
    rid = ex(f"INSERT INTO recurring_rules({','.join(f)}) VALUES({','.join('?' * len(f))})", tuple(f.values()))
    return jsonify(_rule_out(rid))


@app.put("/api/automations/<int:rid>")
@login_required
def update_automation(rid):
    rule = q("SELECT * FROM recurring_rules WHERE id=?", (rid,), one=True)
    if not rule:
        abort(404)
    f = _rule_fields(body())
    merged = {**rule, **f}
    err = _validate_rule(merged)
    if err:
        return bad(err)
    nxt = next_run_after(merged, now_utc())  # schedule may have changed: recompute from now
    f["next_run_at"] = iso(nxt) if nxt else None
    ex(f"UPDATE recurring_rules SET {','.join(k + '=?' for k in f)} WHERE id=?", (*f.values(), rid))
    return jsonify(_rule_out(rid))


@app.delete("/api/automations/<int:rid>")
@login_required
def delete_automation(rid):
    ex("UPDATE tasks SET recurring_rule_id=NULL WHERE recurring_rule_id=?", (rid,))
    ex("DELETE FROM recurring_rules WHERE id=?", (rid,))
    return jsonify(ok=True)


@app.post("/api/automations/<int:rid>/run")
@login_required
def run_automation_now(rid):
    rule = q("SELECT * FROM recurring_rules WHERE id=?", (rid,), one=True)
    if not rule:
        abort(404)
    return jsonify(task_id=create_task_from_rule(rule))


# ---------------------------------------------------------------- files
def _save_upload(kind, ref_id):
    fs = request.files.get("file")
    if not fs or not fs.filename:
        return None
    name = secure_filename(fs.filename) or "file"
    stored = f"{uuid.uuid4().hex}_{name}"
    fs.save(os.path.join(UPLOAD_DIR, stored))
    size = os.path.getsize(os.path.join(UPLOAD_DIR, stored))
    fid = ex("INSERT INTO files(kind,ref_id,owner_id,original_name,stored_name,mime,size,created_at) "
             "VALUES(?,?,?,?,?,?,?,?)",
             (kind, ref_id, current_user()["id"], fs.filename, stored, fs.mimetype, size, iso(now_utc())))
    return fid


def _remove_file(f):
    try:
        os.remove(os.path.join(UPLOAD_DIR, f["stored_name"]))
    except OSError:
        pass
    ex("DELETE FROM files WHERE id=?", (f["id"],))


def _can_access_file(f):
    u = current_user()
    if is_exec() or f["owner_id"] == u["id"]:
        return True
    if f["kind"] in ("task", "avatar"):
        return True
    if f["kind"] == "resource":
        r = q("SELECT shared FROM resources WHERE file_id=?", (f["id"],), one=True)
        return bool(r and r["shared"])
    return False  # bank QR: owner + executives only


@app.post("/api/tasks/<int:tid>/import-resources")
@login_required
def import_resources(tid):
    """Attach saved Resources to a task: links become task links, files are copied onto the task."""
    if not q("SELECT 1 FROM tasks WHERE id=?", (tid,), one=True):
        abort(404)
    d = body()
    ids = [int(i) for i in (d.get("ids") or []) if str(i).isdigit()][:100]
    only = d.get("only")  # "links" or "files" to take just that part of each resource
    u = current_user()
    have_urls = {r["url"] for r in q("SELECT url FROM task_links WHERE task_id=?", (tid,))}
    have_files = {(r["original_name"], r["size"]) for r in q(
        "SELECT original_name, size FROM files WHERE kind='task' AND ref_id=?", (tid,))}
    added_links = added_files = 0
    for rid in ids:
        r = q("SELECT * FROM resources WHERE id=?", (rid,), one=True)
        if not r or not (r["shared"] or r["owner_id"] == u["id"] or is_exec()):
            continue  # only resources this person can see
        if only != "files" and r["url"] and r["url"] not in have_urls:
            ex("INSERT INTO task_links(task_id,url,label,created_at) VALUES(?,?,?,?)",
               (tid, r["url"], r["title"], iso(now_utc())))
            have_urls.add(r["url"])
            added_links += 1
        src = q("SELECT * FROM files WHERE id=?", (r["file_id"],), one=True) if r["file_id"] and only != "links" else None
        if src and (src["original_name"], src["size"]) not in have_files:
            # A separate copy, so deleting it from the task never affects the Resource (or vice versa).
            stored = f"{uuid.uuid4().hex}_{secure_filename(src['original_name']) or 'file'}"
            shutil.copyfile(os.path.join(UPLOAD_DIR, src["stored_name"]), os.path.join(UPLOAD_DIR, stored))
            ex("INSERT INTO files(kind,ref_id,owner_id,original_name,stored_name,mime,size,created_at) "
               "VALUES(?,?,?,?,?,?,?,?)", ("task", tid, u["id"], src["original_name"], stored, src["mime"],
                                           src["size"], iso(now_utc())))
            have_files.add((src["original_name"], src["size"]))
            added_files += 1
    return jsonify(task=_task_full(tid), added_links=added_links, added_files=added_files)


@app.post("/api/tasks/<int:tid>/files")
@login_required
def upload_task_file(tid):
    if not _save_upload("task", tid):
        return bad("No file selected")
    return jsonify(_task_full(tid))


@app.get("/api/files/<int:fid>")
def get_file(fid):
    if not current_user():
        # Opened from a Google Chat link while signed out: sign in first, then come back to the download.
        return redirect("/?" + urlencode({"next": request.full_path.rstrip("?")}))
    f = q("SELECT * FROM files WHERE id=?", (fid,), one=True)
    if not f or not _can_access_file(f):
        abort(404)
    inline = request.args.get("inline") == "1"
    return send_file(os.path.join(UPLOAD_DIR, f["stored_name"]), mimetype=f["mime"],
                     as_attachment=not inline, download_name=f["original_name"])


@app.delete("/api/files/<int:fid>")
@login_required
def delete_file(fid):
    f = q("SELECT * FROM files WHERE id=?", (fid,), one=True)
    if not f:
        abort(404)
    if not (is_exec() or f["owner_id"] == current_user()["id"] or f["kind"] == "task"):
        abort(403)
    if f["kind"] == "qr":
        ex("UPDATE users SET qr_file_id=NULL WHERE qr_file_id=?", (fid,))
    _remove_file(f)
    return jsonify(ok=True)


# ---------------------------------------------------------------- EOD reports
@app.get("/api/eods")
@login_required
def list_eods():
    uid = request.args.get("user_id")
    if is_exec():
        if uid:
            rows = q("SELECT e.*, u.name user_name, u.avatar_file_id user_avatar, c.name client_name FROM eods e JOIN users u ON u.id=e.user_id "
                     "LEFT JOIN clients c ON c.id=e.client_id WHERE e.user_id=? ORDER BY e.id DESC LIMIT 200", (int(uid),))
        else:
            rows = q("SELECT e.*, u.name user_name, u.avatar_file_id user_avatar, c.name client_name FROM eods e JOIN users u ON u.id=e.user_id "
                     "LEFT JOIN clients c ON c.id=e.client_id ORDER BY e.id DESC LIMIT 200")
    else:
        rows = q("SELECT e.*, u.name user_name, u.avatar_file_id user_avatar, c.name client_name FROM eods e JOIN users u ON u.id=e.user_id "
                 "LEFT JOIN clients c ON c.id=e.client_id WHERE e.user_id=? ORDER BY e.id DESC LIMIT 200",
                 (current_user()["id"],))
    return jsonify(rows)


@app.post("/api/eods")
@login_required
def create_eod():
    u = current_user()
    d = body()
    if not (d.get("accomplishments") or "").strip():
        return bad("Please list what you accomplished today")
    worked, _ = today_seconds(u["id"])
    eod_date = d.get("eod_date") or local_today().isoformat()
    client = q("SELECT * FROM clients WHERE id=?", (int(d.get("client_id") or 0),), one=True)
    eid = ex("INSERT INTO eods(user_id,eod_date,client_id,accomplishments,blockers,tomorrow,notes,worked_seconds,created_at) "
             "VALUES(?,?,?,?,?,?,?,?,?)",
             (u["id"], eod_date, client["id"] if client else None, d["accomplishments"].strip(),
              (d.get("blockers") or "").strip(), (d.get("tomorrow") or "").strip(), (d.get("notes") or "").strip(),
              worked, iso(now_utc())))
    lines = [f"📝 *EOD Report — {u['name']}*", f"_{eod_date}_" + (f" · {client['name']}" if client else "") +
             f" · {worked / 3600:.2f} hrs logged", "", "*✅ Accomplished*", d["accomplishments"].strip()]
    if (d.get("blockers") or "").strip():
        lines += ["", "*⛔ Blockers*", d["blockers"].strip()]
    if (d.get("tomorrow") or "").strip():
        lines += ["", "*📌 Plan for tomorrow*", d["tomorrow"].strip()]
    if (d.get("notes") or "").strip():
        lines += ["", "*🗒 Notes*", d["notes"].strip()]
    ok, msg = chat_post(settings()["chat_webhook_eod"], "\n".join(lines))
    ex("UPDATE eods SET chat_status=? WHERE id=?", ("sent" if ok else "not sent", eid))
    return jsonify(id=eid, chat_ok=ok, chat_message=msg)


# ---------------------------------------------------------------- employee profile
@app.get("/api/profile/<int:uid>")
@login_required
def profile(uid):
    if not can_see_user(uid):
        abort(403)
    u = q("SELECT * FROM users WHERE id=?", (uid,), one=True)
    if not u:
        abort(404)
    entry, brk = live_status(uid)
    return jsonify(
        user=user_out(u, True), cutoff=cutoff_summary(u),
        status="On Break" if brk else ("On Shift" if entry else "Off"),
        kpis=q("SELECT * FROM kpis WHERE user_id=? ORDER BY id DESC", (uid,)),
        wins=q("SELECT * FROM wins WHERE user_id=? ORDER BY win_date DESC, id DESC", (uid,)),
        incidents=q("SELECT i.*, r.name reporter FROM incidents i LEFT JOIN users r ON r.id=i.reported_by "
                    "WHERE i.user_id=? ORDER BY incident_date DESC, id DESC", (uid,)),
        metrics=q("SELECT * FROM metrics WHERE user_id=? ORDER BY week_start DESC, id DESC", (uid,)),
        qr=q("SELECT id, original_name, mime, created_at FROM files WHERE id=?", (u["qr_file_id"],), one=True)
        if u["qr_file_id"] else None,
        company_direction=settings()["company_direction"],
    )


@app.post("/api/profile/<int:uid>/qr")
@login_required
def upload_qr(uid):
    if not can_see_user(uid):
        abort(403)
    fs = request.files.get("file")
    if not fs or fs.mimetype not in SAFE_IMAGE_TYPES:
        return bad("Please upload a PNG, JPG, or WebP image of your bank QR code")
    old = q("SELECT f.* FROM files f JOIN users u ON u.qr_file_id=f.id WHERE u.id=?", (uid,), one=True)
    fid = _save_upload("qr", uid)
    ex("UPDATE files SET owner_id=? WHERE id=?", (uid, fid))
    ex("UPDATE users SET qr_file_id=? WHERE id=?", (fid, uid))
    if old:
        _remove_file(old)
    return jsonify(ok=True, file_id=fid)


@app.post("/api/users/<int:uid>/avatar")
@login_required
def upload_avatar(uid):
    if not can_see_user(uid):
        abort(403)
    fs = request.files.get("file")
    if not fs or fs.mimetype not in SAFE_IMAGE_TYPES:
        return bad("Please choose a PNG, JPG, WebP, or GIF image")
    old = q("SELECT f.* FROM files f JOIN users u ON u.avatar_file_id=f.id WHERE u.id=?", (uid,), one=True)
    fid = _save_upload("avatar", uid)
    ex("UPDATE files SET owner_id=? WHERE id=?", (uid, fid))
    ex("UPDATE users SET avatar_file_id=? WHERE id=?", (fid, uid))
    if old:
        _remove_file(old)
    return jsonify(user=user_out(q("SELECT * FROM users WHERE id=?", (uid,), one=True), True))


@app.delete("/api/users/<int:uid>/avatar")
@login_required
def delete_avatar(uid):
    if not can_see_user(uid):
        abort(403)
    old = q("SELECT f.* FROM files f JOIN users u ON u.avatar_file_id=f.id WHERE u.id=?", (uid,), one=True)
    ex("UPDATE users SET avatar_file_id=NULL WHERE id=?", (uid,))
    if old:
        _remove_file(old)
    return jsonify(ok=True)


# Generic CRUD for profile sub-records. Rules per table:
#   who may create, which fields an employee may edit, which fields only executives may edit.
PROFILE_TABLES = {
    "kpis": {"fields": ("title", "target", "current", "unit", "period", "due_date"),
             "emp_create": False, "emp_edit": ("current",), "date": None},
    "wins": {"fields": ("win_date", "title", "description"), "emp_create": True,
             "emp_edit": ("win_date", "title", "description"), "date": "win_date"},
    "incidents": {"fields": ("incident_date", "title", "description", "severity", "action_taken", "employee_response"),
                  "emp_create": False, "emp_edit": ("employee_response",), "date": "incident_date"},
    "metrics": {"fields": ("week_start", "metric", "achieved", "target", "unit", "notes", "alignment", "exec_comment"),
                "emp_create": True, "emp_edit": ("week_start", "metric", "achieved", "target", "unit", "notes"),
                "date": "week_start"},
}
NUMERIC = {"target", "current", "achieved"}


def _clean(table, d, allowed):
    out = {}
    for k in allowed:
        if k in d:
            v = d[k]
            out[k] = float(v or 0) if k in NUMERIC else (v or "").strip() if isinstance(v, str) else v
    return out


@app.post("/api/profile/<int:uid>/<table>")
@login_required
def profile_create(uid, table):
    cfg = PROFILE_TABLES.get(table)
    if not cfg or not can_see_user(uid):
        abort(404)
    if not is_exec() and not cfg["emp_create"]:
        abort(403)
    allowed = cfg["fields"] if is_exec() else cfg["emp_edit"]
    f = _clean(table, body(), allowed)
    if cfg["date"] and not f.get(cfg["date"]):
        f[cfg["date"]] = local_today().isoformat()
    f["user_id"] = uid
    f["created_at"] = iso(now_utc())
    if table == "wins":
        f["created_by"] = current_user()["id"]
    if table == "incidents":
        f["reported_by"] = current_user()["id"]
    ex(f"INSERT INTO {table}({','.join(f)}) VALUES({','.join('?' * len(f))})", tuple(f.values()))
    return jsonify(ok=True)


@app.put("/api/profile/<int:uid>/<table>/<int:rid>")
@login_required
def profile_update(uid, table, rid):
    cfg = PROFILE_TABLES.get(table)
    if not cfg or not can_see_user(uid):
        abort(404)
    f = _clean(table, body(), cfg["fields"] if is_exec() else cfg["emp_edit"])
    if f:
        ex(f"UPDATE {table} SET {','.join(k + '=?' for k in f)} WHERE id=? AND user_id=?", (*f.values(), rid, uid))
    return jsonify(ok=True)


@app.delete("/api/profile/<int:uid>/<table>/<int:rid>")
@login_required
def profile_delete(uid, table, rid):
    cfg = PROFILE_TABLES.get(table)
    if not cfg or not can_see_user(uid):
        abort(404)
    if not is_exec() and not cfg["emp_create"]:
        abort(403)
    ex(f"DELETE FROM {table} WHERE id=? AND user_id=?", (rid, uid))
    return jsonify(ok=True)


# ---------------------------------------------------------------- resources
@app.get("/api/resources")
@login_required
def list_resources():
    u = current_user()
    rows = q("SELECT r.*, u.name owner_name, f.original_name file_name FROM resources r "
             "LEFT JOIN users u ON u.id=r.owner_id LEFT JOIN files f ON f.id=r.file_id "
             "WHERE r.shared=1 OR r.owner_id=? ORDER BY r.category, r.title", (u["id"],))
    return jsonify(rows)


@app.post("/api/resources")
@login_required
def create_resource():
    d = body()
    if not (d.get("title") or "").strip():
        return bad("Title is required")
    shared = 1 if d.get("shared") in ("1", "true", True, 1) else 0
    url = (d.get("url") or "").strip()
    if url and not url.startswith(("http://", "https://")):
        url = "https://" + url
    rid = ex("INSERT INTO resources(owner_id,title,url,category,description,shared,created_at) VALUES(?,?,?,?,?,?,?)",
             (current_user()["id"], d["title"].strip(), url, (d.get("category") or "General").strip() or "General",
              (d.get("description") or "").strip(), shared, iso(now_utc())))
    fid = _save_upload("resource", rid)
    if fid:
        ex("UPDATE resources SET file_id=? WHERE id=?", (fid, rid))
    if not url and not fid:
        ex("DELETE FROM resources WHERE id=?", (rid,))
        return bad("Add a link or attach a file")
    return jsonify(ok=True)


@app.delete("/api/resources/<int:rid>")
@login_required
def delete_resource(rid):
    r = q("SELECT * FROM resources WHERE id=?", (rid,), one=True)
    if not r:
        abort(404)
    if not (is_exec() or r["owner_id"] == current_user()["id"]):
        abort(403)
    if r["file_id"]:
        f = q("SELECT * FROM files WHERE id=?", (r["file_id"],), one=True)
        if f:
            _remove_file(f)
    ex("DELETE FROM resources WHERE id=?", (rid,))
    return jsonify(ok=True)


# ---------------------------------------------------------------- settings
@app.get("/api/settings")
@exec_required
def get_settings():
    return jsonify(settings())


@app.put("/api/settings")
@exec_required
def put_settings():
    d = body()
    for k in DEFAULT_SETTINGS:
        if k in d:
            v = str(d[k]).strip()
            if k.startswith("chat_webhook") and v and not valid_webhook(v):
                return bad("Google Chat webhook URLs start with https://chat.googleapis.com/")
            if k == "auto_archive_days" and not (v.isdigit() and int(v) <= 365):
                return bad("Auto-archive days must be a number from 0 to 365")
            if k == "task_digest_time" and not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", v):
                return bad("Digest time must look like 09:00")
            if k == "timezone":
                try:
                    ZoneInfo(v)
                except Exception:
                    return bad("Unknown timezone")
            ex("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)", (k, v))
    g.pop("settings", None)
    return jsonify(settings())


@app.post("/api/settings/test-webhook")
@exec_required
def test_webhook():
    which = body().get("which")
    key, label = {"eod": ("chat_webhook_eod", "EOD"), "tasks": ("chat_webhook_tasks", "Task alerts"),
                  "tasks_done": ("chat_webhook_tasks_done", "Completed tasks")}.get(
        which, ("chat_webhook_shift", "Shift"))
    ok, msg = chat_post(settings().get(key), f"✅ Test message from Her Haus Hub ({label} channel)")
    return jsonify(ok=ok, message=msg), (200 if ok else 400)


# ---------------------------------------------------------------- frontend
@app.get("/healthz")
def healthz():
    db().execute("SELECT 1")
    return jsonify(ok=True)


def _asset_version():
    """A fingerprint of the app's code. Changes whenever app.js or styles.css change (content, not file dates)."""
    h = hashlib.sha256()
    for name in ("app.js", "styles.css"):
        with open(os.path.join(app.static_folder, name), "rb") as f:
            h.update(f.read())
    return h.hexdigest()[:12]


ASSET_VERSION = _asset_version()


def _index_html():
    # Asset URLs carry the code fingerprint, so a browser can never mix an old app.js with a new server.
    html = open(os.path.join(app.static_folder, "index.html"), encoding="utf-8").read()
    for name in ("styles.css", "app.js"):
        html = html.replace(f"/static/{name}", f"/static/{name}?v={ASSET_VERSION}")
    html = html.replace("<head>", f'<head>\n  <meta name="app-version" content="{ASSET_VERSION}">', 1)
    resp = Response(html, mimetype="text/html")
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return resp


@app.get("/")
def index():
    resp = _index_html()
    if request.args.get("fresh"):
        # Reached via the app's automatic fresh reload: drop any stale copies of the Hub this browser kept.
        resp.headers["Clear-Site-Data"] = '"cache"'
    return resp


@app.errorhandler(404)
def not_found(_e):
    if request.path.startswith("/api/"):
        return jsonify(error="Not found"), 404
    return _index_html()


@app.errorhandler(403)
def forbidden(_e):
    return jsonify(error="You don't have access to that"), 403


@app.errorhandler(413)
def too_large(_e):
    return jsonify(error="File is too large (25 MB max)"), 413


@app.errorhandler(500)
def server_error(e):
    """Give API callers a readable message. Executives also see the underlying error to speed up support."""
    if not request.path.startswith("/api/"):
        return Response("Something went wrong. Please try again.", status=500)
    err = getattr(e, "original_exception", None) or e
    msg = "Something went wrong on the server. Please try again — if it keeps happening, tell an executive."
    try:
        if is_exec():
            msg = f"Server error: {type(err).__name__}: {str(err)[:200]}"
    except Exception:
        pass
    return jsonify(error=msg), 500


init_db()
DB_STALL_SECONDS = int(os.environ.get("DB_STALL_SECONDS") or 25)


def _db_watchdog():
    """Self-healing: if one database call hangs (Render's disk has stalled before), every request queues behind
    it and the site stops answering. Log where it's stuck, then exit this worker; gunicorn starts a fresh one
    within a second or two, so the site recovers on its own instead of staying down."""
    while True:
        _clock.sleep(5)
        since = _shared_db.busy_since
        if since and _clock.monotonic() - since > DB_STALL_SECONDS:
            print(f"[watchdog] a database call has been stuck for over {DB_STALL_SECONDS}s — restarting the app "
                  f"worker (pid {os.getpid()}). Where each thread was:", flush=True)
            faulthandler.dump_traceback(file=sys.stdout, all_threads=True)
            sys.stdout.flush()
            os._exit(1)   # exit code 1 = gunicorn respawns the worker (code 3 would stop the whole server)


if os.environ.get("DISABLE_SCHEDULER") != "1":
    threading.Thread(target=_scheduler_loop, daemon=True, name="automations").start()
    threading.Thread(target=_db_watchdog, daemon=True, name="db-watchdog").start()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5050)), debug=False, threaded=True)
