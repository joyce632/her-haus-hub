"""Office: the Hub's walkable pixel office.

Everyone shows up as a character whose place and animation come from real Hub data:
clocked out = drove home, on Lunch/Break = Lunch room/Break room, on shift = acting out their
In Progress task (calls, contracts, comps, showings...). People can add a note or pick a
meeting/content mode, design their character, chat in speech bubbles and play arcade games.

Character looks, notes and arcade scores are saved in the database. Live things (where each person
is standing, chat bubbles, duel moves) are kept in memory and passed around by polling, the same way
huddles work, so it runs on the existing single app worker. They reset if the app restarts.
"""
import json
import threading
import time

from flask import jsonify, request

H = None
_lock = threading.RLock()
POS = {}          # uid -> {"x", "y", "g", "t"}   where someone with the Office open is standing
EVENTS = []       # [{"seq", "uid", "text", "t"}]  chat bubbles, everyone sees them
INBOX = {}        # uid -> [{"seq", "from", "data", "t"}]   duel moves addressed to one person
_seq = [0]

MAP_W, MAP_H = 72, 38
POS_TTL = 25          # seconds without a poll before someone's live position is dropped
EVENT_TTL = 90
GAMES = ("snake", "dash", "duel")
LOOK = {"skin": 6, "hairStyle": 5, "hair": 8, "shirt": 10, "pants": 5, "acc": 4}
MODES = ("", "meeting", "social")
DUEL_TYPES = ("inv", "acc", "dec", "bye", "lock", "rev")

SCHEMA_SQLITE = """
CREATE TABLE IF NOT EXISTS office_profiles(
  user_id INTEGER PRIMARY KEY, look TEXT DEFAULT '', note TEXT DEFAULT '', mode TEXT DEFAULT '', updated_at TEXT);
CREATE TABLE IF NOT EXISTS office_scores(
  user_id INTEGER PRIMARY KEY, snake INTEGER DEFAULT 0, dash INTEGER DEFAULT 0, duel INTEGER DEFAULT 0, updated_at TEXT);
"""
SCHEMA_PG = SCHEMA_SQLITE
NO_ID_TABLES = {"office_profiles", "office_scores"}


def _next():
    _seq[0] += 1
    return _seq[0]


def _prune(now):
    for uid in [u for u, p in POS.items() if now - p["t"] > POS_TTL]:
        POS.pop(uid, None)
    EVENTS[:] = [e for e in EVENTS if now - e["t"] < EVENT_TTL][-200:]
    for uid in list(INBOX):
        INBOX[uid] = [m for m in INBOX[uid] if now - m["t"] < EVENT_TTL][-100:]
        if not INBOX[uid]:
            INBOX.pop(uid, None)


def _clean_look(raw):
    try:
        v = json.loads(raw) if isinstance(raw, str) else raw
    except ValueError:
        return None
    if not isinstance(v, dict):
        return None
    out = {}
    for k, n in LOOK.items():
        x = v.get(k)
        if not isinstance(x, int) or isinstance(x, bool) or not 0 <= x < n:
            return None
        out[k] = x
    return out


def _int(v, lo, hi):
    if isinstance(v, bool):
        return None
    try:
        v = int(v)
    except (TypeError, ValueError):
        return None
    return v if lo <= v <= hi else None


def _owner_id():
    """The Executive Office belongs to the first executive account (the one the Hub was set up with)."""
    r = H.q("SELECT id FROM users WHERE role='executive' AND active=1 ORDER BY id LIMIT 1", one=True)
    return r["id"] if r else None


def _team():
    users = H.q("SELECT id, name, role, position, avatar_file_id FROM users WHERE active=1 ORDER BY id")
    entries = {r["id"]: r for r in H.q("SELECT id, user_id, clock_in FROM time_entries WHERE clock_out IS NULL")}
    on_shift = {e["user_id"]: e for e in entries.values()}
    breaks = {}
    for b in H.q('SELECT entry_id, user_id, kind, start FROM breaks WHERE "end" IS NULL'):
        if b["entry_id"] in entries:
            breaks[b["user_id"]] = b
    tasks = {}
    for t in H.q("SELECT t.id, t.title, t.assignee_id, t.updated_at, c.name client FROM tasks t "
                 "JOIN clients c ON c.id=t.client_id WHERE t.status='In Progress' AND t.archived_at IS NULL "
                 "AND c.archived=0 AND t.assignee_id IS NOT NULL ORDER BY t.updated_at DESC, t.id DESC"):
        tasks.setdefault(t["assignee_id"], {"id": t["id"], "title": t["title"], "client": t["client"]})
    profiles = {r["user_id"]: r for r in H.q("SELECT * FROM office_profiles")}
    seen = getattr(H, "huddles", None)
    last_seen = seen.LAST_SEEN if seen else {}
    now = time.time()
    out = []
    for u in users:
        uid = u["id"]
        b, e = breaks.get(uid), on_shift.get(uid)
        shift = ("lunch" if b["kind"] == "Lunch" else "break") if b else ("on" if e else "off")
        p = profiles.get(uid) or {}
        pos = POS.get(uid)
        out.append({
            "id": uid, "name": u["name"], "role": u["role"], "position": u["position"] or "",
            "avatar_file_id": u["avatar_file_id"], "shift": shift,
            "since": (b or {}).get("start") or (e or {}).get("clock_in"),
            "task": tasks.get(uid), "note": p.get("note") or "", "mode": p.get("mode") or "",
            "look": _clean_look(p.get("look") or "") if p.get("look") else None,
            "online": now - last_seen.get(uid, 0) < 70,
            "pos": {"x": pos["x"], "y": pos["y"], "g": pos.get("g")} if pos else None,
        })
    return out


def register(module):
    global H
    H = module
    app, lr = H.app, H.login_required

    @app.get("/api/office/state")
    @lr
    def office_state():
        uid = H.current_user()["id"]
        since = _int(request.args.get("since"), 0, 10 ** 12) or 0
        now = time.time()
        with _lock:
            _prune(now)
            if uid in POS:
                POS[uid]["t"] = now          # still on the Office page
            events = [e for e in EVENTS if e["seq"] > since]
            inbox = [m for m in INBOX.get(uid, []) if m["seq"] > since]
            seq = _seq[0]
        scores = {r["user_id"]: {"snake": r["snake"] or 0, "dash": r["dash"] or 0, "duel": r["duel"] or 0}
                  for r in H.q("SELECT * FROM office_scores")}
        return jsonify(me=uid, owner_id=_owner_id(), people=_team(), scores=scores,
                       events=events, inbox=inbox, seq=seq, server_time=time.time())

    @app.post("/api/office/move")
    @lr
    def office_move():
        uid, d = H.current_user()["id"], H.body()
        x, y = _int(d.get("x"), 0, MAP_W - 1), _int(d.get("y"), 0, MAP_H - 1)
        g = d.get("g") if d.get("g") in GAMES else None
        with _lock:
            if d.get("leave"):
                POS.pop(uid, None)
            elif x is not None and y is not None:
                POS[uid] = {"x": x, "y": y, "g": g, "t": time.time()}
        return jsonify(ok=True)

    @app.post("/api/office/profile")
    @lr
    def office_profile():
        uid, d = H.current_user()["id"], H.body()
        cur = H.q("SELECT * FROM office_profiles WHERE user_id=?", (uid,), one=True) or {}
        look = cur.get("look") or ""
        if "look" in d:
            clean = _clean_look(d.get("look"))
            if not clean:
                return H.bad("That character look isn't valid")
            look = json.dumps(clean)
        note = (str(d.get("note") or "").strip()[:80]) if "note" in d else (cur.get("note") or "")
        mode = d.get("mode") if "mode" in d else (cur.get("mode") or "")
        if mode not in MODES:
            return H.bad("Unknown office mode")
        H.ex("INSERT INTO office_profiles(user_id,look,note,mode,updated_at) VALUES(?,?,?,?,?) "
             "ON CONFLICT(user_id) DO UPDATE SET look=excluded.look, note=excluded.note, mode=excluded.mode, "
             "updated_at=excluded.updated_at", (uid, look, note, mode, H.iso(H.now_utc())))
        return jsonify(ok=True)

    @app.post("/api/office/say")
    @lr
    def office_say():
        uid = H.current_user()["id"]
        text = " ".join(str(H.body().get("text") or "").split())[:120]
        if not text:
            return H.bad("Say something first")
        with _lock:
            EVENTS.append({"seq": _next(), "uid": uid, "text": text, "t": time.time()})
            _prune(time.time())
        return jsonify(ok=True)

    @app.post("/api/office/duel")
    @lr
    def office_duel():
        uid, d = H.current_user()["id"], H.body()
        to = _int(d.get("to"), 1, 10 ** 9)
        kind = d.get("t")
        gid = str(d.get("g") or "")[:12]
        if kind not in DUEL_TYPES or not to or to == uid or not gid:
            return H.bad("Bad duel message")
        if not H.q("SELECT 1 FROM users WHERE id=? AND active=1", (to,), one=True):
            return H.bad("That person isn't on the team")
        data = {"t": kind, "g": gid}
        r = _int(d.get("r"), 1, 99)
        if r:
            data["r"] = r
        if d.get("p") in ("rock", "paper", "scissors"):
            data["p"] = d["p"]
        with _lock:
            INBOX.setdefault(to, []).append({"seq": _next(), "from": uid, "data": data, "t": time.time()})
        return jsonify(ok=True)

    @app.post("/api/office/score")
    @lr
    def office_score():
        uid, d = H.current_user()["id"], H.body()
        game = d.get("game")
        if game not in GAMES:
            return H.bad("Unknown game")
        cur = H.q("SELECT * FROM office_scores WHERE user_id=?", (uid,), one=True) or {}
        vals = {k: int(cur.get(k) or 0) for k in GAMES}
        if game == "duel":
            vals["duel"] += 1                     # one more duel won against a teammate
        else:
            v = _int(d.get("value"), 0, 100000)
            if v is None:
                return H.bad("Bad score")
            vals[game] = max(vals[game], v)
        H.ex("INSERT INTO office_scores(user_id,snake,dash,duel,updated_at) VALUES(?,?,?,?,?) "
             "ON CONFLICT(user_id) DO UPDATE SET snake=excluded.snake, dash=excluded.dash, duel=excluded.duel, "
             "updated_at=excluded.updated_at", (uid, vals["snake"], vals["dash"], vals["duel"], H.iso(H.now_utc())))
        return jsonify(scores=vals)
