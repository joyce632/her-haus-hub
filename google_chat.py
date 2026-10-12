"""Google Chat inside Her Haus Hub — two-way sync with the team's real Google Chat spaces.

How it works
- Each person connects their own Google account once (OAuth, "Internal" app in the company's Google Workspace).
  The hub then acts as them: it sees exactly the spaces, group chats and DMs they're in, and messages they send
  from the hub appear in Google Chat under their name.
- A background thread checks every connected person's spaces every ~15 seconds (one cheap call each) and pulls
  new messages only from spaces that changed. Older history is imported in the background, newest first.
- While someone has a conversation open, its latest messages are re-read every few seconds, which also picks up
  edits, deletions and reactions.
- Refresh tokens are stored encrypted (key derived from SECRET_KEY).

Setup (Google admin, once): a Google Cloud project with the Chat API + People API enabled, an Internal OAuth
consent screen, a Web OAuth client with redirect URI https://<site>/api/google/callback, and the Chat API's
"Configuration" page filled in. Then set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server.
"""
import base64
import hashlib
import json
import os
import re
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone

from flask import jsonify, redirect, request, send_file, session

H = None   # the app module (set by register) — gives us q, ex, app, notify, current_user, …

OAUTH_URL = os.environ.get("GOOGLE_OAUTH_URL", "https://accounts.google.com/o/oauth2/v2/auth")
TOKEN_URL = os.environ.get("GOOGLE_TOKEN_URL", "https://oauth2.googleapis.com/token")
REVOKE_URL = os.environ.get("GOOGLE_REVOKE_URL", "https://oauth2.googleapis.com/revoke")
USERINFO_URL = os.environ.get("GOOGLE_USERINFO_URL", "https://openidconnect.googleapis.com/v1/userinfo")
CHAT_API = os.environ.get("GOOGLE_CHAT_API", "https://chat.googleapis.com").rstrip("/")
PEOPLE_API = os.environ.get("GOOGLE_PEOPLE_API", "https://people.googleapis.com").rstrip("/")
SCOPES = [
    "openid", "email", "profile",
    "https://www.googleapis.com/auth/chat.spaces.readonly",
    "https://www.googleapis.com/auth/chat.messages",            # read, send, edit, delete, react
    "https://www.googleapis.com/auth/chat.memberships.readonly",
    "https://www.googleapis.com/auth/directory.readonly",       # teammates' names and photos
]
SYNC_SECONDS = int(os.environ.get("GCHAT_SYNC_SECONDS", "15"))
REFRESH_SECONDS = 6          # how often an open conversation is re-read from Google
PAGE = 50                    # messages per page in the hub
UPLOAD_LIMIT = 25 * 1024 * 1024

SCHEMA_SQLITE = """
CREATE TABLE IF NOT EXISTS google_accounts(
  user_id INTEGER PRIMARY KEY, google_id TEXT, email TEXT, name TEXT, refresh_token TEXT, access_token TEXT,
  token_expires REAL DEFAULT 0, connected_at TEXT, last_sync TEXT, sync_error TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS chat_spaces(
  id INTEGER PRIMARY KEY, gname TEXT UNIQUE NOT NULL, display_name TEXT DEFAULT '', space_type TEXT DEFAULT 'SPACE',
  threading TEXT DEFAULT '', last_active TEXT, synced_through TEXT, backfill_done INTEGER DEFAULT 0,
  refreshed_at REAL DEFAULT 0, members_json TEXT, members_at REAL DEFAULT 0, client_id INTEGER, created_at TEXT);
CREATE TABLE IF NOT EXISTS chat_members(space_id INTEGER NOT NULL, user_id INTEGER NOT NULL, PRIMARY KEY(space_id, user_id));
CREATE TABLE IF NOT EXISTS chat_messages(
  id INTEGER PRIMARY KEY, gname TEXT UNIQUE NOT NULL, space_id INTEGER NOT NULL, thread_name TEXT,
  thread_reply INTEGER DEFAULT 0, sender_gid TEXT DEFAULT '', sender_type TEXT DEFAULT 'HUMAN', sender_name TEXT DEFAULT '',
  text TEXT DEFAULT '', annotations TEXT DEFAULT '[]', attachments TEXT DEFAULT '[]', reactions TEXT DEFAULT '[]',
  card_text TEXT DEFAULT '', create_time TEXT, update_time TEXT, deleted INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS ix_chatmsg_space ON chat_messages(space_id, create_time);
CREATE INDEX IF NOT EXISTS ix_chatmsg_thread ON chat_messages(space_id, thread_name);
CREATE TABLE IF NOT EXISTS chat_people(gid TEXT PRIMARY KEY, name TEXT DEFAULT '', email TEXT DEFAULT '', photo TEXT DEFAULT '', updated_at REAL DEFAULT 0);
CREATE TABLE IF NOT EXISTS chat_reads(space_id INTEGER NOT NULL, user_id INTEGER NOT NULL, last_read TEXT, PRIMARY KEY(space_id, user_id));
CREATE TABLE IF NOT EXISTS chat_my_reactions(message_id INTEGER NOT NULL, user_id INTEGER NOT NULL, emoji TEXT NOT NULL, PRIMARY KEY(message_id, user_id, emoji));
"""
SCHEMA_PG = (SCHEMA_SQLITE.replace("id INTEGER PRIMARY KEY, gname", "id SERIAL PRIMARY KEY, gname"))
TABLES = ["google_accounts", "chat_spaces", "chat_members", "chat_messages", "chat_people", "chat_reads", "chat_my_reactions"]
NO_ID_TABLES = {"google_accounts", "chat_members", "chat_people", "chat_reads", "chat_my_reactions"}


class GoogleError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


class NotConnected(Exception):
    pass


def configured():
    return bool(os.environ.get("GOOGLE_CLIENT_ID") and os.environ.get("GOOGLE_CLIENT_SECRET"))


# ---------------------------------------------------------------- small helpers
def _fernet():
    from cryptography.fernet import Fernet
    key = hashlib.sha256(("herhaus-google-chat:" + H.app.config["SECRET_KEY"]).encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def _enc(s):
    return _fernet().encrypt(s.encode()).decode() if s else ""


def _dec(s):
    try:
        return _fernet().decrypt(s.encode()).decode() if s else ""
    except Exception:
        return ""


def norm_time(s):
    """Google timestamps → one fixed format (UTC, microseconds) so they compare correctly as text."""
    if not s:
        return None
    m = re.match(r"^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d+))?(Z|[+-]\d\d:\d\d)?$", s)
    if not m:
        return s
    frac = (m.group(2) or "")[:6].ljust(6, "0")
    tz = m.group(3) or "Z"
    dt = datetime.fromisoformat(f"{m.group(1)}.{frac}" + ("+00:00" if tz == "Z" else tz))
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def now_norm():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _http(method, url, token=None, params=None, body=None, form=None, raw=None, content_type=None, binary=False, timeout=25):
    if params:
        url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params, doseq=True)
    headers, data = {}, None
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if body is not None:
        data, headers["Content-Type"] = json.dumps(body).encode(), "application/json; charset=UTF-8"
    elif form is not None:
        data, headers["Content-Type"] = urllib.parse.urlencode(form).encode(), "application/x-www-form-urlencoded"
    elif raw is not None:
        data, headers["Content-Type"] = raw, content_type
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=H._ssl_ctx) as r:
            payload = r.read()
            if binary:
                return payload, r.headers.get("Content-Type", "application/octet-stream")
            return json.loads(payload or b"{}")
    except urllib.error.HTTPError as e:
        detail = e.read()[:3000]
        try:
            j = json.loads(detail)
            err = j.get("error")
            msg = (err.get("message") if isinstance(err, dict) else None) or j.get("error_description") or str(err)
            if isinstance(err, str):
                msg = f"{err}: {j.get('error_description', '')}"
        except Exception:
            msg = detail.decode("utf-8", "replace")[:300] or str(e)
        raise GoogleError(e.code, msg)
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise GoogleError(0, f"Couldn't reach Google: {e}")


_locks = {}
_locks_guard = threading.Lock()


def _lock(key):
    with _locks_guard:
        return _locks.setdefault(key, threading.Lock())


def _account(uid):
    return H.q("SELECT * FROM google_accounts WHERE user_id=?", (uid,), one=True)


def access_token(uid, force=False):
    a = _account(uid)
    if not a or not a["refresh_token"]:
        raise NotConnected()
    if not force and a["access_token"] and (a["token_expires"] or 0) > time.time() + 60:
        return _dec(a["access_token"])
    with _lock(f"token:{uid}"):
        a = _account(uid)
        if not force and a["access_token"] and (a["token_expires"] or 0) > time.time() + 60:
            return _dec(a["access_token"])
        try:
            r = _http("POST", TOKEN_URL, form={"client_id": os.environ["GOOGLE_CLIENT_ID"],
                                               "client_secret": os.environ["GOOGLE_CLIENT_SECRET"],
                                               "refresh_token": _dec(a["refresh_token"]), "grant_type": "refresh_token"})
        except GoogleError as e:
            if e.status in (400, 401) and "invalid_grant" in str(e):
                H.ex("UPDATE google_accounts SET refresh_token='', access_token='', sync_error=? WHERE user_id=?",
                     ("Google access was removed or expired — reconnect Google Chat.", uid))
                raise NotConnected()
            raise
        H.ex("UPDATE google_accounts SET access_token=?, token_expires=? WHERE user_id=?",
             (_enc(r["access_token"]), time.time() + int(r.get("expires_in", 3600)), uid))
        return r["access_token"]


def gapi(uid, method, path, base=None, **kw):
    """Call a Google API as this person; refreshes the access token once if Google rejects it."""
    url = (base or CHAT_API) + path
    try:
        return _http(method, url, token=access_token(uid), **kw)
    except GoogleError as e:
        if e.status != 401:
            raise
        return _http(method, url, token=access_token(uid, force=True), **kw)


# ---------------------------------------------------------------- people (names & photos)
def _gid_num(gid):
    return (gid or "").split("/", 1)[-1]


def resolve_people(uid, gids):
    want = sorted({g for g in gids if g and g.startswith("users/") and g != "users/all"})
    if not want:
        return
    fresh = {r["gid"] for r in H.q(f"SELECT gid FROM chat_people WHERE updated_at>? AND gid IN ({','.join('?' * len(want))})",
                                   (time.time() - 7 * 86400, *want))}
    need = [g for g in want if g not in fresh]
    for i in range(0, len(need), 50):
        chunk = need[i:i + 50]
        try:
            r = gapi(uid, "GET", "/v1/people:batchGet", base=PEOPLE_API,
                     params=[("resourceNames", f"people/{_gid_num(g)}") for g in chunk] + [("personFields", "names,emailAddresses,photos")])
        except (GoogleError, NotConnected):
            return   # names are a nice-to-have; the hub falls back to what Chat itself returned
        for res in r.get("responses", []):
            person = res.get("person") or {}
            gid = "users/" + _gid_num(res.get("requestedResourceName") or person.get("resourceName") or "")
            name = ((person.get("names") or [{}])[0]).get("displayName", "")
            email = ((person.get("emailAddresses") or [{}])[0]).get("value", "")
            photo = ((person.get("photos") or [{}])[0]).get("url", "")
            if not H.q("SELECT 1 FROM chat_people WHERE gid=?", (gid,), one=True):
                H.ex("INSERT OR IGNORE INTO chat_people(gid,name,email,photo,updated_at) VALUES(?,?,?,?,?)", (gid, name, email, photo, time.time()))
            else:
                H.ex("UPDATE chat_people SET name=?, email=?, photo=?, updated_at=? WHERE gid=?", (name, email, photo, time.time(), gid))


def _people_map(gids):
    gids = sorted({g for g in gids if g})
    out = {}
    if not gids:
        return out
    marks = ",".join("?" * len(gids))
    for r in H.q(f"SELECT gid, name, email, photo FROM chat_people WHERE gid IN ({marks})", gids):
        out[r["gid"]] = dict(r)
    # Hub users: by connected Google account, then by matching email — gives hub avatars and names.
    for r in H.q(f"SELECT a.google_id, u.id, u.name, u.email, u.avatar_file_id FROM google_accounts a JOIN users u ON u.id=a.user_id "
                 f"WHERE a.google_id IN ({marks})", [_gid_num(g) for g in gids]):
        p = out.setdefault("users/" + r["google_id"], {"gid": "users/" + r["google_id"], "name": r["name"], "email": r["email"], "photo": ""})
        p.update(user_id=r["id"], avatar_file_id=r["avatar_file_id"], name=p.get("name") or r["name"])
    emails = {p["email"].lower(): g for g, p in out.items() if p.get("email") and not p.get("user_id")}
    if emails:
        for r in H.q(f"SELECT id, name, email, avatar_file_id FROM users WHERE lower(email) IN ({','.join('?' * len(emails))})", list(emails)):
            p = out[emails[r["email"].lower()]]
            p.update(user_id=r["id"], avatar_file_id=r["avatar_file_id"], name=p.get("name") or r["name"])
    return out


def _hub_user_for_gid(gid):
    if not gid:
        return None
    r = H.q("SELECT user_id FROM google_accounts WHERE google_id=?", (_gid_num(gid),), one=True)
    if r:
        return r["user_id"]
    p = H.q("SELECT email FROM chat_people WHERE gid=?", (gid,), one=True)
    if p and p["email"]:
        u = H.q("SELECT id FROM users WHERE lower(email)=lower(?)", (p["email"],), one=True)
        return u and u["id"]
    return None


# ---------------------------------------------------------------- spaces
def _upsert_space(s):
    gname = s["name"]
    fields = {"display_name": s.get("displayName") or "", "space_type": s.get("spaceType") or ("DIRECT_MESSAGE" if s.get("type") == "DM" else "SPACE"),
              "threading": s.get("spaceThreadingState") or "", "last_active": norm_time(s.get("lastActiveTime"))}
    row = H.q("SELECT id FROM chat_spaces WHERE gname=?", (gname,), one=True)
    if row:
        H.ex("UPDATE chat_spaces SET display_name=?, space_type=?, threading=?, last_active=COALESCE(?, last_active) WHERE id=?",
             (*fields.values(), row["id"]))
        return row["id"]
    H.ex("INSERT OR IGNORE INTO chat_spaces(gname,display_name,space_type,threading,last_active,created_at) VALUES(?,?,?,?,?,?)",
         (gname, *fields.values(), H.iso(H.now_utc())))
    return H.q("SELECT id FROM chat_spaces WHERE gname=?", (gname,), one=True)["id"]


def sync_spaces(uid):
    spaces, token = [], None
    for _ in range(20):
        params = {"pageSize": 1000}
        if token:
            params["pageToken"] = token
        r = gapi(uid, "GET", "/v1/spaces", params=params)
        spaces += r.get("spaces", [])
        token = r.get("nextPageToken")
        if not token:
            break
    seen = []
    for s in spaces:
        if s.get("singleUserBotDm"):
            continue
        sid = _upsert_space(s)
        seen.append(sid)
        if not H.q("SELECT 1 FROM chat_members WHERE space_id=? AND user_id=?", (sid, uid), one=True):
            H.ex("INSERT OR IGNORE INTO chat_members(space_id,user_id) VALUES(?,?)", (sid, uid))
            # Joining (or connecting) starts with everything already read, so history doesn't flood the unread counts.
            H.ex("INSERT OR IGNORE INTO chat_reads(space_id,user_id,last_read) VALUES(?,?,?)", (sid, uid, now_norm()))
    keep = set(seen)
    for r in H.q("SELECT space_id FROM chat_members WHERE user_id=?", (uid,)):
        if r["space_id"] not in keep:
            H.ex("DELETE FROM chat_members WHERE space_id=? AND user_id=?", (r["space_id"], uid))
    return seen


def refresh_members(sid, uid, force=False):
    sp = H.q("SELECT * FROM chat_spaces WHERE id=?", (sid,), one=True)
    if not force and sp["members_json"] and (sp["members_at"] or 0) > time.time() - 86400:
        return json.loads(sp["members_json"])
    members, token = [], None
    for _ in range(10):
        params = {"pageSize": 1000}
        if token:
            params["pageToken"] = token
        r = gapi(uid, "GET", f"/v1/{sp['gname']}/members", params=params)
        for m in r.get("memberships", []):
            mem = m.get("member") or {}
            if mem.get("name") and mem.get("type", "HUMAN") == "HUMAN":
                members.append(mem["name"])
        token = r.get("nextPageToken")
        if not token:
            break
    H.ex("UPDATE chat_spaces SET members_json=?, members_at=? WHERE id=?", (json.dumps(members), time.time(), sid))
    resolve_people(uid, members)
    return members


# ---------------------------------------------------------------- messages
def _message_fields(m):
    sender = m.get("sender") or {}
    annotations = []
    for a in m.get("annotations") or []:
        if a.get("type") == "USER_MENTION":
            annotations.append({"start": a.get("startIndex", 0), "length": a.get("length", 0),
                                "user": ((a.get("userMention") or {}).get("user") or {}).get("name", "")})
    attachments = []
    for a in m.get("attachment") or m.get("attachments") or []:
        attachments.append({"name": a.get("contentName") or "attachment", "type": a.get("contentType") or "",
                            "resource": (a.get("attachmentDataRef") or {}).get("resourceName", ""),
                            "drive": (a.get("driveDataRef") or {}).get("driveFileId", ""),
                            "download": a.get("downloadUri") or "", "source": a.get("source") or ""})
    reactions = []
    for e in m.get("emojiReactionSummaries") or []:
        emo = e.get("emoji") or {}
        label = emo.get("unicode") or (":" + ((emo.get("customEmoji") or {}).get("emojiName") or "emoji").strip(":") + ":")
        reactions.append({"emoji": label, "count": int(e.get("reactionCount") or 0)})
    card = ""
    if not m.get("text") and (m.get("cardsV2") or m.get("cards")):
        card = m.get("fallbackText") or "Card message — open in Google Chat to view"
    return {
        "thread_name": (m.get("thread") or {}).get("name") or "", "thread_reply": 1 if m.get("threadReply") else 0,
        "sender_gid": sender.get("name", ""), "sender_type": sender.get("type", "HUMAN"), "sender_name": sender.get("displayName", ""),
        "text": m.get("text") or "", "annotations": json.dumps(annotations), "attachments": json.dumps(attachments),
        "reactions": json.dumps(reactions), "card_text": card, "create_time": norm_time(m.get("createTime")) or now_norm(),
        "update_time": norm_time(m.get("lastUpdateTime")), "deleted": 1 if m.get("deleteTime") else 0,
    }


def _store(sid, m):
    """Insert or update one message. Returns the new row id when it was inserted, else None."""
    f = _message_fields(m)
    row = H.q("SELECT id FROM chat_messages WHERE gname=?", (m["name"],), one=True)
    if row:
        H.ex("UPDATE chat_messages SET " + ",".join(f"{k}=?" for k in f) + " WHERE id=?", (*f.values(), row["id"]))
        return None
    H.ex("INSERT OR IGNORE INTO chat_messages(gname,space_id," + ",".join(f) + ") VALUES(" + ",".join("?" * (len(f) + 2)) + ")",
         (m["name"], sid, *f.values()))
    r = H.q("SELECT id FROM chat_messages WHERE gname=?", (m["name"],), one=True)
    return r and r["id"]


def _ingest(sid, uid, msgs, notify, complete_from=None):
    """Store messages. Notify people about new ones. If the batch covers everything newer than `complete_from`,
    move the space's synced_through mark forward so the next incremental sync starts from there."""
    sp = H.q("SELECT * FROM chat_spaces WHERE id=?", (sid,), one=True)
    through = sp["synced_through"]
    new_ids, newest = [], through
    for m in msgs:
        if not m.get("name"):
            continue
        rid = _store(sid, m)
        ct = norm_time(m.get("createTime"))
        if rid and notify and through and ct and ct > through:
            new_ids.append(rid)
        if ct and (not newest or ct > newest):
            newest = ct
    if complete_from is not None and newest and newest != through:
        H.ex("UPDATE chat_spaces SET synced_through=? WHERE id=? AND (synced_through IS NULL OR synced_through<?)", (newest, sid, newest))
    resolve_people(uid, [_message_fields(m)["sender_gid"] for m in msgs])
    for rid in new_ids:
        _notify_message(sid, rid)
    return len(new_ids)


def _notify_message(sid, mid):
    m = H.q("SELECT * FROM chat_messages WHERE id=?", (mid,), one=True)
    sp = H.q("SELECT * FROM chat_spaces WHERE id=?", (sid,), one=True)
    if not m or m["deleted"] or m["create_time"] < (datetime.now(timezone.utc) - timedelta(hours=6)).strftime("%Y-%m-%dT%H:%M:%S"):
        return
    sender_uid = _hub_user_for_gid(m["sender_gid"])
    people = _people_map([m["sender_gid"]])
    sender_name = (people.get(m["sender_gid"]) or {}).get("name") or m["sender_name"] or "Someone"
    files = [a["name"] for a in json.loads(m["attachments"] or "[]")]
    snippet = (m["text"] or m["card_text"] or ("📎 " + ", ".join(files) if files else ""))[:200]
    members = [r["user_id"] for r in H.q("SELECT user_id FROM chat_members WHERE space_id=?", (sid,))]
    mentioned = {a["user"] for a in json.loads(m["annotations"] or "[]")}
    for uid in members:
        if uid == sender_uid:
            continue
        gid = (H.q("SELECT google_id FROM google_accounts WHERE user_id=?", (uid,), one=True) or {}).get("google_id")
        if "users/all" in mentioned or (gid and f"users/{gid}" in mentioned):
            _notify(uid, "chat_mention", sender_uid, sender_name, sid, snippet)
        elif sp["space_type"] == "DIRECT_MESSAGE":
            _notify(uid, "chat_dm", sender_uid, sender_name, sid, snippet)


def _notify(uid, kind, actor_id, actor_label, sid, snippet):
    H.ex("INSERT INTO notifications(user_id,actor_id,actor_label,kind,task_id,chat_space_id,snippet,created_at) VALUES(?,?,?,?,?,?,?,?)",
         (uid, actor_id, actor_label, kind, None, sid, snippet[:240], H.iso(H.now_utc())))


def sync_space_messages(sid, uid):
    sp = H.q("SELECT * FROM chat_spaces WHERE id=?", (sid,), one=True)
    with _lock(f"space:{sid}"):
        sp = H.q("SELECT * FROM chat_spaces WHERE id=?", (sid,), one=True)
        if not sp["synced_through"]:
            # First look at this space: newest messages now; older history is imported by backfill_step.
            r = gapi(uid, "GET", f"/v1/{sp['gname']}/messages", params={"pageSize": 200, "orderBy": "createTime desc", "showDeleted": "true"})
            msgs = r.get("messages", [])
            _ingest(sid, uid, msgs, notify=False)
            newest = max((norm_time(m.get("createTime")) for m in msgs), default=None) or sp["last_active"] or now_norm()
            H.ex("UPDATE chat_spaces SET synced_through=?, backfill_done=? WHERE id=?", (newest, 0 if r.get("nextPageToken") else 1, sid))
            return
        token, through = None, sp["synced_through"]
        for _ in range(10):
            params = {"pageSize": 1000, "orderBy": "createTime asc", "showDeleted": "true", "filter": f'createTime > "{through}"'}
            if token:
                params["pageToken"] = token
            r = gapi(uid, "GET", f"/v1/{sp['gname']}/messages", params=params)
            _ingest(sid, uid, r.get("messages", []), notify=True, complete_from=through)
            token = r.get("nextPageToken")
            if not token:
                break


def backfill_step(sid, uid):
    """Import one page of older history (newest first)."""
    with _lock(f"space:{sid}"):
        sp = H.q("SELECT * FROM chat_spaces WHERE id=?", (sid,), one=True)
        if sp["backfill_done"]:
            return
        oldest = (H.q("SELECT MIN(create_time) t FROM chat_messages WHERE space_id=?", (sid,), one=True) or {}).get("t")
        params = {"pageSize": 1000, "orderBy": "createTime desc", "showDeleted": "true"}
        if oldest:
            params["filter"] = f'createTime < "{oldest}"'
        r = gapi(uid, "GET", f"/v1/{sp['gname']}/messages", params=params)
        msgs = r.get("messages", [])
        _ingest(sid, uid, msgs, notify=False)
        if not msgs or not r.get("nextPageToken"):
            H.ex("UPDATE chat_spaces SET backfill_done=1 WHERE id=?", (sid,))


def refresh_recent(sid, uid):
    """Re-read the newest messages of an open conversation: new messages, edits, deletions and reactions."""
    sp = H.q("SELECT * FROM chat_spaces WHERE id=?", (sid,), one=True)
    if (sp["refreshed_at"] or 0) > time.time() - REFRESH_SECONDS:
        return
    H.ex("UPDATE chat_spaces SET refreshed_at=? WHERE id=?", (time.time(), sid))
    if not sp["synced_through"]:
        return sync_space_messages(sid, uid)
    with _lock(f"space:{sid}"):
        r = gapi(uid, "GET", f"/v1/{sp['gname']}/messages", params={"pageSize": PAGE, "orderBy": "createTime desc", "showDeleted": "true"})
        msgs = r.get("messages", [])
        oldest = min((norm_time(m.get("createTime")) for m in msgs), default=None)
        complete = not r.get("nextPageToken") or (oldest and oldest <= sp["synced_through"])
        _ingest(sid, uid, msgs, notify=True, complete_from=sp["synced_through"] if complete else None)


def refresh_in_background(sid, uid):
    def run():
        try:
            with H.app.app_context():
                refresh_recent(sid, uid)
        except (GoogleError, NotConnected) as e:
            print(f"[gchat] refresh space {sid}: {e}", flush=True)
        except Exception as e:
            print(f"[gchat] refresh space {sid} failed: {e!r}", flush=True)
    threading.Thread(target=run, daemon=True).start()


# ---------------------------------------------------------------- background sync
_status = {}   # uid -> "syncing" while a first import runs


def sync_user(uid):
    sids = sync_spaces(uid)
    if not sids:
        return
    marks = ",".join("?" * len(sids))
    rows = H.q(f"SELECT * FROM chat_spaces WHERE id IN ({marks})", sids)
    for sp in rows:   # names for DMs / group chats first, so the chat list reads right straight away
        if sp["space_type"] != "SPACE" and (not sp["members_json"] or (sp["members_at"] or 0) < time.time() - 86400):
            try:
                refresh_members(sp["id"], uid)
            except GoogleError:
                pass
    for sp in rows:
        if not sp["synced_through"] or (sp["last_active"] and sp["last_active"] > sp["synced_through"]):
            sync_space_messages(sp["id"], uid)
    # A little older history each round, most recently active spaces first.
    pending = sorted([sp for sp in rows if not sp["backfill_done"]], key=lambda s: s["last_active"] or "", reverse=True)[:3]
    for sp in pending:
        backfill_step(sp["id"], uid)


def sync_all():
    if not configured():
        return
    for a in H.q("SELECT user_id FROM google_accounts WHERE refresh_token IS NOT NULL AND refresh_token!=''"):
        uid = a["user_id"]
        with _lock(f"user:{uid}"):
            try:
                sync_user(uid)
                H.ex("UPDATE google_accounts SET last_sync=?, sync_error='' WHERE user_id=?", (H.iso(H.now_utc()), uid))
            except NotConnected:
                pass
            except GoogleError as e:
                H.ex("UPDATE google_accounts SET sync_error=? WHERE user_id=?", (str(e)[:300], uid))
                print(f"[gchat] sync user {uid}: {e}", flush=True)
            finally:
                _status.pop(uid, None)


def _loop():
    time.sleep(8)
    while True:
        try:
            with H.app.app_context():
                sync_all()
        except Exception as e:   # keep syncing no matter what
            print(f"[gchat] sync error: {e!r}", flush=True)
        time.sleep(SYNC_SECONDS)


def sync_user_now(uid):
    """Kick off a sync for one person right away (after connecting)."""
    def run():
        with H.app.app_context():
            with _lock(f"user:{uid}"):
                try:
                    sync_user(uid)
                    H.ex("UPDATE google_accounts SET last_sync=?, sync_error='' WHERE user_id=?", (H.iso(H.now_utc()), uid))
                except NotConnected:
                    pass
                except Exception as e:
                    H.ex("UPDATE google_accounts SET sync_error=? WHERE user_id=?", (str(e)[:300], uid))
                    print(f"[gchat] first sync user {uid}: {e!r}", flush=True)
                finally:
                    _status.pop(uid, None)
    _status[uid] = "syncing"
    threading.Thread(target=run, daemon=True).start()


# ---------------------------------------------------------------- output for the hub
def _member_or_404(sid):
    u = H.current_user()
    if not H.q("SELECT 1 FROM chat_members WHERE space_id=? AND user_id=?", (sid, u["id"]), one=True):
        H.abort(404)
    return H.q("SELECT * FROM chat_spaces WHERE id=?", (sid,), one=True)


def _my_gid(uid):
    a = _account(uid)
    return f"users/{a['google_id']}" if a and a["google_id"] else ""


def _space_title(sp, my_gid, people):
    if sp["display_name"]:
        return sp["display_name"]
    others = [g for g in json.loads(sp["members_json"] or "[]") if g != my_gid]
    names = [(people.get(g) or {}).get("name") for g in others]
    names = [n for n in names if n]
    if sp["space_type"] == "DIRECT_MESSAGE":
        return names[0] if names else "Direct message"
    return ", ".join(n.split(" ")[0] for n in names[:4]) + (f" +{len(names) - 4}" if len(names) > 4 else "") if names else "Group chat"


def _dm_partner(sp, my_gid):
    others = [g for g in json.loads(sp["members_json"] or "[]") if g != my_gid]
    return others[0] if sp["space_type"] == "DIRECT_MESSAGE" and others else None


def _web_link(sp):
    sid = sp["gname"].split("/", 1)[-1]
    return f"https://chat.google.com/{'dm' if sp['space_type'] == 'DIRECT_MESSAGE' else 'room'}/{sid}"


def unread_counts(uid):
    gid = _my_gid(uid)
    rows = H.q("SELECT m.space_id, COUNT(*) n FROM chat_messages m JOIN chat_members cm ON cm.space_id=m.space_id AND cm.user_id=? "
               "LEFT JOIN chat_reads r ON r.space_id=m.space_id AND r.user_id=? "
               "WHERE m.deleted=0 AND m.create_time > COALESCE(r.last_read, '') AND m.sender_gid != ? GROUP BY m.space_id",
               (uid, uid, gid))
    return {r["space_id"]: r["n"] for r in rows}


def unread_total(uid):
    if not _account(uid):
        return 0
    return sum(unread_counts(uid).values())


def _person_out(gid, people, my_gid, fallback=""):
    p = people.get(gid) or {}
    return {"gid": gid, "name": p.get("name") or fallback or "Unknown", "photo": p.get("photo") or "",
            "user_id": p.get("user_id"), "avatar_file_id": p.get("avatar_file_id"), "is_me": gid == my_gid}


def _messages_out(rows, uid):
    my_gid = _my_gid(uid)
    people = _people_map([r["sender_gid"] for r in rows])
    mine = set()
    if rows:
        marks = ",".join("?" * len(rows))
        mine = {(r["message_id"], r["emoji"]) for r in H.q(
            f"SELECT message_id, emoji FROM chat_my_reactions WHERE user_id=? AND message_id IN ({marks})", (uid, *[r["id"] for r in rows]))}
    replies = {}
    threads = sorted({r["thread_name"] for r in rows if r["thread_name"] and not r["thread_reply"]})
    if threads:
        sid = rows[0]["space_id"]
        for t in H.q(f"SELECT thread_name, COUNT(*) n, MAX(create_time) last FROM chat_messages WHERE space_id=? AND thread_reply=1 AND deleted=0 "
                     f"AND thread_name IN ({','.join('?' * len(threads))}) GROUP BY thread_name", (sid, *threads)):
            replies[t["thread_name"]] = (t["n"], t["last"])
    out = []
    for r in rows:
        atts = json.loads(r["attachments"] or "[]")
        sender = _person_out(r["sender_gid"], people, my_gid, r["sender_name"] or ("App" if r["sender_type"] == "BOT" else ""))
        sender["is_bot"] = r["sender_type"] == "BOT"
        n, last = replies.get(r["thread_name"], (0, None))
        out.append({
            "id": r["id"], "space_id": r["space_id"], "thread": r["thread_name"], "thread_reply": bool(r["thread_reply"]),
            "sender": sender, "text": "" if r["deleted"] else r["text"], "card_text": r["card_text"],
            "annotations": json.loads(r["annotations"] or "[]"),
            "attachments": [{"index": i, "name": a["name"], "type": a["type"], "is_image": a["type"].startswith("image/"),
                             "url": f"/api/chat/attachments/{r['id']}/{i}", "drive": bool(a.get("drive"))} for i, a in enumerate(atts)],
            "reactions": [{**x, "mine": (r["id"], x["emoji"]) in mine} for x in json.loads(r["reactions"] or "[]") if x.get("count")],
            "create_time": r["create_time"],
            "edited": bool(r["update_time"] and r["update_time"][:19] > r["create_time"][:19]),
            "deleted": bool(r["deleted"]), "reply_count": n, "last_reply": last,
            "can_edit": sender["is_me"] and not r["deleted"],
        })
    return out


# ---------------------------------------------------------------- routes
def _redirect_uri():
    base = (H.settings().get("app_url") or "").rstrip("/") or request.url_root.rstrip("/")
    return f"{base}/api/google/callback"


def register(module):
    global H
    H = module
    app = H.app
    lr = H.login_required

    @app.get("/api/chat/status")
    @lr
    def chat_status():
        u = H.current_user()
        a = _account(u["id"])
        spaces = H.q("SELECT COUNT(*) n, SUM(CASE WHEN s.backfill_done=1 THEN 1 ELSE 0 END) done FROM chat_members m "
                     "JOIN chat_spaces s ON s.id=m.space_id WHERE m.user_id=?", (u["id"],), one=True)
        return jsonify(configured=configured(), connected=bool(a and a["refresh_token"]), email=a and a["email"],
                       last_sync=a and a["last_sync"], error=(a and a["sync_error"]) or "",
                       syncing=u["id"] in _status, spaces=spaces["n"] or 0, history_done=spaces["done"] or 0,
                       redirect_uri=_redirect_uri() if H.is_exec() else None)

    @app.get("/api/google/connect")
    def google_connect():
        u = H.current_user()
        if not u:
            return redirect("/?" + urllib.parse.urlencode({"next": "/#/chat"}))
        if not configured():
            return redirect("/#/chat?error=" + urllib.parse.quote("Google Chat isn't set up yet"))
        state = secrets.token_urlsafe(24)
        session["g_state"] = state
        return redirect(OAUTH_URL + "?" + urllib.parse.urlencode({
            "client_id": os.environ["GOOGLE_CLIENT_ID"], "redirect_uri": _redirect_uri(), "response_type": "code",
            "scope": " ".join(SCOPES), "access_type": "offline", "prompt": "consent", "include_granted_scopes": "true",
            "state": state, "login_hint": u["email"]}))

    @app.get("/api/google/callback")
    def google_callback():
        u = H.current_user()
        if not u:
            return redirect("/")
        if request.args.get("error"):
            return redirect("/#/chat?error=" + urllib.parse.quote("Google sign-in was cancelled"))
        if not request.args.get("state") or request.args.get("state") != session.pop("g_state", None):
            return redirect("/#/chat?error=" + urllib.parse.quote("That sign-in link expired — please try again"))
        try:
            tok = _http("POST", TOKEN_URL, form={"code": request.args.get("code", ""), "client_id": os.environ["GOOGLE_CLIENT_ID"],
                                                 "client_secret": os.environ["GOOGLE_CLIENT_SECRET"], "redirect_uri": _redirect_uri(),
                                                 "grant_type": "authorization_code"})
            info = _http("GET", USERINFO_URL, token=tok["access_token"])
        except GoogleError as e:
            print(f"[gchat] connect failed for user {u['id']}: {e}", flush=True)
            return redirect("/#/chat?error=" + urllib.parse.quote("Couldn't connect to Google — please try again"))
        granted = set((tok.get("scope") or "").split())
        missing = [s for s in SCOPES[3:5] if s not in granted]
        if missing:
            return redirect("/#/chat?error=" + urllib.parse.quote("Please allow access to Google Chat on Google's screen"))
        if not tok.get("refresh_token"):
            return redirect("/#/chat?error=" + urllib.parse.quote("Google didn't grant ongoing access — please try again"))
        row = {"google_id": info.get("sub", ""), "email": info.get("email", ""), "name": info.get("name", ""),
               "refresh_token": _enc(tok["refresh_token"]), "access_token": _enc(tok["access_token"]),
               "token_expires": time.time() + int(tok.get("expires_in", 3600)), "connected_at": H.iso(H.now_utc())}
        if _account(u["id"]):
            H.ex("UPDATE google_accounts SET " + ",".join(f"{k}=?" for k in row) + ", sync_error='' WHERE user_id=?", (*row.values(), u["id"]))
        else:
            H.ex("INSERT INTO google_accounts(user_id," + ",".join(row) + ") VALUES(" + ",".join("?" * (len(row) + 1)) + ")", (u["id"], *row.values()))
        sync_user_now(u["id"])
        return redirect("/#/chat?connected=1")

    @app.post("/api/google/disconnect")
    @lr
    def google_disconnect():
        u = H.current_user()
        a = _account(u["id"])
        if a and a["refresh_token"]:
            try:
                _http("POST", REVOKE_URL, form={"token": _dec(a["refresh_token"])})
            except GoogleError:
                pass
        H.ex("DELETE FROM google_accounts WHERE user_id=?", (u["id"],))
        H.ex("DELETE FROM chat_members WHERE user_id=?", (u["id"],))
        H.ex("DELETE FROM chat_reads WHERE user_id=?", (u["id"],))
        return jsonify(ok=True)

    @app.get("/api/chat/spaces")
    @lr
    def chat_spaces():
        u = H.current_user()
        my_gid = _my_gid(u["id"])
        spaces = H.q("SELECT s.* FROM chat_spaces s JOIN chat_members m ON m.space_id=s.id WHERE m.user_id=? "
                     "ORDER BY COALESCE(s.last_active,'') DESC", (u["id"],))
        if not spaces:
            return jsonify([])
        ids = [s["id"] for s in spaces]
        marks = ",".join("?" * len(ids))
        last = {r["space_id"]: r for r in H.q(
            f"SELECT m.* FROM chat_messages m JOIN (SELECT space_id, MAX(create_time) t FROM chat_messages WHERE deleted=0 AND space_id IN ({marks}) "
            f"GROUP BY space_id) x ON x.space_id=m.space_id AND x.t=m.create_time", ids)}
        gids = [r["sender_gid"] for r in last.values()]
        for s in spaces:
            gids += json.loads(s["members_json"] or "[]")
        people = _people_map(gids)
        unread = unread_counts(u["id"])
        clients = {c["id"]: c for c in H.q("SELECT id, name, color FROM clients")}
        out = []
        for s in spaces:
            lm = last.get(s["id"])
            partner = _dm_partner(s, my_gid)
            preview = None
            if lm:
                who = "You" if lm["sender_gid"] == my_gid else (people.get(lm["sender_gid"]) or {}).get("name", lm["sender_name"] or "")
                body_text = lm["text"] or lm["card_text"] or ("📎 Attachment" if lm["attachments"] != "[]" else "")
                preview = {"who": (who or "").split(" ")[0], "text": body_text[:140], "time": lm["create_time"]}
            out.append({"id": s["id"], "title": _space_title(s, my_gid, people), "type": s["space_type"],
                        "last_active": (lm and lm["create_time"]) or s["last_active"], "unread": unread.get(s["id"], 0), "preview": preview,
                        "partner": _person_out(partner, people, my_gid) if partner else None,
                        "client": clients.get(s["client_id"]) if s["client_id"] else None, "web_link": _web_link(s),
                        "history_done": bool(s["backfill_done"])})
        out.sort(key=lambda x: x["last_active"] or "", reverse=True)
        return jsonify(out)

    @app.get("/api/chat/spaces/<int:sid>/messages")
    @lr
    def chat_messages(sid):
        u = H.current_user()
        sp = _member_or_404(sid)
        if request.args.get("live") == "1" and _account(u["id"]):
            refresh_in_background(sid, u["id"])
        thread = request.args.get("thread")
        before = request.args.get("before")   # create_time of the oldest message shown
        limit = min(int(request.args.get("limit") or PAGE), 200)
        if thread:
            rows = H.q("SELECT * FROM chat_messages WHERE space_id=? AND thread_name=? ORDER BY create_time", (sid, thread))
            return jsonify(messages=_messages_out(rows, u["id"]), more=False)
        where, args = ["space_id=?", "thread_reply=0"], [sid]
        if before:
            where.append("create_time<?")
            args.append(before)
        rows = H.q("SELECT * FROM chat_messages WHERE " + " AND ".join(where) + f" ORDER BY create_time DESC LIMIT {limit + 1}", args)
        more = len(rows) > limit or not sp["backfill_done"]
        rows = list(reversed(rows[:limit]))
        return jsonify(messages=_messages_out(rows, u["id"]), more=more, history_done=bool(sp["backfill_done"]))

    @app.post("/api/chat/spaces/<int:sid>/read")
    @lr
    def chat_read(sid):
        u = H.current_user()
        _member_or_404(sid)
        stamp = now_norm()
        if H.db().execute("UPDATE chat_reads SET last_read=? WHERE space_id=? AND user_id=?", (stamp, sid, u["id"])).rowcount == 0:
            H.ex("INSERT OR IGNORE INTO chat_reads(space_id,user_id,last_read) VALUES(?,?,?)", (sid, u["id"], stamp))
        H.ex("UPDATE notifications SET read_at=? WHERE user_id=? AND chat_space_id=? AND read_at IS NULL", (H.iso(H.now_utc()), u["id"], sid))
        return jsonify(ok=True)

    @app.get("/api/chat/spaces/<int:sid>/members")
    @lr
    def chat_members(sid):
        u = H.current_user()
        _member_or_404(sid)
        try:
            gids = refresh_members(sid, u["id"])
        except (GoogleError, NotConnected):
            gids = json.loads((H.q("SELECT members_json FROM chat_spaces WHERE id=?", (sid,), one=True) or {}).get("members_json") or "[]")
        people = _people_map(gids)
        my = _my_gid(u["id"])
        return jsonify([_person_out(g, people, my) for g in gids if g != my])

    @app.post("/api/chat/spaces/<int:sid>/messages")
    @lr
    def chat_send(sid):
        u = H.current_user()
        sp = _member_or_404(sid)
        d = request.form if request.files or request.form else (request.get_json(silent=True) or {})
        text = (d.get("text") or "").strip()
        thread = (d.get("thread") or "").strip()
        files = request.files.getlist("files")[:10]
        if not text and not files:
            return H.bad("Write a message first")
        if len(text) > 4000:
            return H.bad("Messages can be up to 4,000 characters")
        try:
            attachments = []
            for f in files:
                data = f.read()
                if len(data) > UPLOAD_LIMIT:
                    return H.bad(f"{f.filename} is over 25 MB")
                boundary = uuid.uuid4().hex
                meta = json.dumps({"filename": f.filename or "file"})
                raw = (f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{meta}\r\n"
                       f"--{boundary}\r\nContent-Type: {f.mimetype or 'application/octet-stream'}\r\n\r\n").encode() + data + f"\r\n--{boundary}--".encode()
                r = gapi(u["id"], "POST", f"/upload/v1/{sp['gname']}/attachments:upload", params={"uploadType": "multipart"},
                         raw=raw, content_type=f"multipart/related; boundary={boundary}", timeout=90)
                attachments.append({"attachmentDataRef": r.get("attachmentDataRef") or {}})
            payload, params = {"text": text}, {}
            if attachments:
                payload["attachment"] = attachments
            if thread:
                payload["thread"] = {"name": thread}
                params["messageReplyOption"] = "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD"
            m = gapi(u["id"], "POST", f"/v1/{sp['gname']}/messages", params=params, body=payload)
        except NotConnected:
            return H.bad("Connect Google Chat first", 409)
        except GoogleError as e:
            return H.bad(f"Google Chat didn't accept that: {e}", 502)
        _ingest(sid, u["id"], [m], notify=True)
        H.ex("UPDATE chat_spaces SET last_active=? WHERE id=? AND (last_active IS NULL OR last_active<?)",
             (norm_time(m.get("createTime")), sid, norm_time(m.get("createTime"))))
        row = H.q("SELECT * FROM chat_messages WHERE gname=?", (m["name"],), one=True)
        return jsonify(_messages_out([row], u["id"])[0])

    def _own_message(mid):
        u = H.current_user()
        row = H.q("SELECT * FROM chat_messages WHERE id=?", (mid,), one=True)
        if not row:
            H.abort(404)
        _member_or_404(row["space_id"])
        return u, row

    @app.put("/api/chat/messages/<int:mid>")
    @lr
    def chat_edit(mid):
        u, row = _own_message(mid)
        if row["sender_gid"] != _my_gid(u["id"]):
            return H.bad("You can only edit your own messages", 403)
        text = (H.body().get("text") or "").strip()
        if not text:
            return H.bad("Message can't be empty")
        try:
            m = gapi(u["id"], "PATCH", f"/v1/{row['gname']}", params={"updateMask": "text"}, body={"text": text})
        except GoogleError as e:
            return H.bad(f"Google Chat didn't accept that: {e}", 502)
        _store(row["space_id"], m)
        return jsonify(_messages_out([H.q("SELECT * FROM chat_messages WHERE id=?", (mid,), one=True)], u["id"])[0])

    @app.delete("/api/chat/messages/<int:mid>")
    @lr
    def chat_delete(mid):
        u, row = _own_message(mid)
        if row["sender_gid"] != _my_gid(u["id"]):
            return H.bad("You can only delete your own messages", 403)
        try:
            gapi(u["id"], "DELETE", f"/v1/{row['gname']}")
        except GoogleError as e:
            if e.status != 404:
                return H.bad(f"Google Chat didn't accept that: {e}", 502)
        H.ex("UPDATE chat_messages SET deleted=1, text='' WHERE id=?", (mid,))
        return jsonify(ok=True)

    @app.post("/api/chat/messages/<int:mid>/reactions")
    @lr
    def chat_react(mid):
        u, row = _own_message(mid)
        emoji = (H.body().get("emoji") or "").strip()
        if not emoji or len(emoji) > 16:
            return H.bad("Pick an emoji")
        gid = _my_gid(u["id"])
        try:
            found = gapi(u["id"], "GET", f"/v1/{row['gname']}/reactions",
                         params={"pageSize": 5, "filter": f'emoji.unicode = "{emoji}" AND user.name = "{gid}"'}).get("reactions", [])
            reactions = json.loads(row["reactions"] or "[]")
            entry = next((x for x in reactions if x["emoji"] == emoji), None)
            if found:
                gapi(u["id"], "DELETE", f"/v1/{found[0]['name']}")
                H.ex("DELETE FROM chat_my_reactions WHERE message_id=? AND user_id=? AND emoji=?", (mid, u["id"], emoji))
                if entry:
                    entry["count"] = max(0, entry["count"] - 1)
            else:
                gapi(u["id"], "POST", f"/v1/{row['gname']}/reactions", body={"emoji": {"unicode": emoji}})
                H.ex("INSERT OR IGNORE INTO chat_my_reactions(message_id,user_id,emoji) VALUES(?,?,?)", (mid, u["id"], emoji))
                if entry:
                    entry["count"] += 1
                else:
                    reactions.append({"emoji": emoji, "count": 1})
        except NotConnected:
            return H.bad("Connect Google Chat first", 409)
        except GoogleError as e:
            return H.bad(f"Google Chat didn't accept that: {e}", 502)
        H.ex("UPDATE chat_messages SET reactions=? WHERE id=?", (json.dumps([x for x in reactions if x["count"] > 0]), mid))
        return jsonify(_messages_out([H.q("SELECT * FROM chat_messages WHERE id=?", (mid,), one=True)], u["id"])[0])

    @app.get("/api/chat/attachments/<int:mid>/<int:idx>")
    @lr
    def chat_attachment(mid, idx):
        u, row = _own_message(mid)
        atts = json.loads(row["attachments"] or "[]")
        if idx >= len(atts):
            H.abort(404)
        a = atts[idx]
        if a.get("drive") or not a.get("resource"):
            if a.get("download"):
                return redirect(a["download"])
            if a.get("drive"):
                return redirect(f"https://drive.google.com/open?id={urllib.parse.quote(a['drive'])}")
            H.abort(404)
        cache_dir = os.path.join(H.UPLOAD_DIR, "chat_cache")
        os.makedirs(cache_dir, exist_ok=True)
        path = os.path.join(cache_dir, hashlib.sha256(a["resource"].encode()).hexdigest())
        if not os.path.exists(path):
            try:
                data, ctype = gapi(u["id"], "GET", f"/v1/media/{a['resource']}", params={"alt": "media"}, binary=True, timeout=90)
            except (GoogleError, NotConnected):
                H.abort(404)
            with open(path + ".tmp", "wb") as fh:
                fh.write(data)
            os.replace(path + ".tmp", path)
        inline = a["type"] in H.SAFE_IMAGE_TYPES and request.args.get("download") != "1"
        resp = send_file(path, mimetype=a["type"] if inline else (a["type"] or "application/octet-stream"),
                         as_attachment=not inline, download_name=a["name"])
        resp.headers["Cache-Control"] = "private, max-age=86400"
        return resp

    @app.put("/api/chat/spaces/<int:sid>/client")
    @H.exec_required
    def chat_link_client(sid):
        _member_or_404(sid)
        cid = H.body().get("client_id")
        H.ex("UPDATE chat_spaces SET client_id=? WHERE id=?", (int(cid) if cid else None, sid))
        return jsonify(ok=True)

    @app.get("/api/clients/<int:cid>/chat")
    @lr
    def client_chat(cid):
        u = H.current_user()
        rows = H.q("SELECT s.id FROM chat_spaces s JOIN chat_members m ON m.space_id=s.id AND m.user_id=? WHERE s.client_id=?", (u["id"], cid))
        return jsonify([r["id"] for r in rows])

    @app.get("/api/chat/admin")
    @H.exec_required
    def chat_admin():
        rows = H.q("SELECT u.id, u.name, u.email, u.avatar_file_id, a.email google_email, a.connected_at, a.last_sync, a.sync_error, "
                   "CASE WHEN a.refresh_token IS NOT NULL AND a.refresh_token!='' THEN 1 ELSE 0 END connected "
                   "FROM users u LEFT JOIN google_accounts a ON a.user_id=u.id WHERE u.active=1 ORDER BY u.name")
        return jsonify(configured=configured(), redirect_uri=_redirect_uri(), people=rows)

    if os.environ.get("DISABLE_SCHEDULER") != "1":
        threading.Thread(target=_loop, daemon=True, name="google-chat-sync").start()
