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

MAP_W, MAP_H = 106, 38
POS_TTL = 25          # seconds without a poll before someone's live position is dropped
EVENT_TTL = 90
GAMES = ("snake", "dash", "duel", "type")
SCORE_COLS = {"snake": "snake", "dash": "dash", "duel": "duel", "type": "typerace"}   # game -> office_scores column
LOOK = {"skin": 6, "hairStyle": 5, "hair": 8, "shirt": 10, "pants": 5, "acc": 4}
MODES = ("", "meeting", "social")
CARRY = ("coffee", "drink", "snack", "water", "burger", "paper", "ball")   # what someone can be holding
ACTS = ("toilet", "wash", "nurse", "grill", "hoop", "dance", "wave", "drive", "film", "paint", "present", "write", "kick")   # what someone is doing right now
EMOTES = ("dance", "wave", "shout", "fart", "poop", "pee", "honk")
MESSES = []           # [{"id", "kind": "poop"|"pee", "x", "y", "uid", "t"}] floor messes anyone can clean up
MESS_TTL, MESS_MAX = 900, 40
_last_emote = {}      # uid -> time of their last emote (a little rate limit)
DUEL_TYPES = ("inv", "acc", "dec", "bye", "lock", "rev")

SCHEMA_SQLITE = """
CREATE TABLE IF NOT EXISTS office_profiles(
  user_id INTEGER PRIMARY KEY, look TEXT DEFAULT '', note TEXT DEFAULT '', mode TEXT DEFAULT '', updated_at TEXT);
CREATE TABLE IF NOT EXISTS office_scores(
  user_id INTEGER PRIMARY KEY, snake INTEGER DEFAULT 0, dash INTEGER DEFAULT 0, duel INTEGER DEFAULT 0, updated_at TEXT);
"""
SCHEMA_PG = SCHEMA_SQLITE
NO_ID_TABLES = {"office_profiles", "office_scores"}
# columns added after the first Office release (best Type Race words per minute)
SQLITE_COLUMNS = [("office_scores", "typerace", "INTEGER DEFAULT 0")]
PG_MIGRATIONS = [f"ALTER TABLE {t} ADD COLUMN IF NOT EXISTS {c} {d}" for t, c, d in SQLITE_COLUMNS]

# Type Race: one shared race at a time. Everyone in the Office can join while it's open; the first to type the
# whole script wins. Lives in memory like the rest of the live Office.
RACE = {"r": None}
RACE_PHRASES = [
    "Hi, this is Her Haus calling about your property. Are you still thinking about selling it as-is for cash?",
    "We buy houses in any condition, so you never have to fix, clean or list. Can I ask a few quick questions?",
    "What would you need to walk away with for the house to make sense for you and your family?",
    "Our offer is cash with no fees or commissions, and we can close on the date that works best for you.",
    "Thanks for your time today. I will send the purchase agreement over by email within the next hour.",
    "Comps on this street sold for about two hundred thousand, so our offer reflects the repairs it needs.",
    "Following up on our call last week. Did you get a chance to look over the offer we sent for the house?",
]
RACE_LIMIT = 150          # seconds a race may run before it ends on its own



def _next():
    _seq[0] += 1
    return _seq[0]


def _prune(now):
    for uid in [u for u, p in POS.items() if now - p["t"] > POS_TTL]:
        POS.pop(uid, None)
    EVENTS[:] = [e for e in EVENTS if now - e["t"] < EVENT_TTL][-200:]
    MESSES[:] = [m for m in MESSES if now - m["t"] < MESS_TTL][-MESS_MAX:]
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


def _exec_ids():
    """The two Executive Offices belong to the first two executive accounts (the first is the one the Hub was set up with)."""
    return [r["id"] for r in H.q("SELECT id FROM users WHERE role='executive' AND active=1 ORDER BY id LIMIT 2")]


def _owner_id():
    ids = _exec_ids()
    return ids[0] if ids else None


def _race_tick(now):
    r = RACE["r"]
    if not r:
        return
    if r["state"] == "countdown" and now >= r["start_at"]:
        r["state"] = "racing"
    if r["state"] == "racing" and (now > r["start_at"] + RACE_LIMIT or (r["players"] and all(p["done"] for p in r["players"].values()))):
        r["state"], r["ended_at"] = "done", now
    stale = (r["state"] == "lobby" and now - r["created"] > 900) or (r["state"] == "done" and now - r["ended_at"] > 600)
    if stale or not r["players"]:
        RACE["r"] = None


def _race_out(now):
    r = RACE["r"]
    if not r:
        return None
    players = [{"id": uid, "pos": p["pos"], "done": p["done"], "wpm": p["wpm"], "place": p["place"], "secs": p["secs"]}
               for uid, p in sorted(r["players"].items(), key=lambda kv: kv[1]["joined"])]
    return {"id": r["id"], "host": r["host"], "state": r["state"], "phrase": r["phrase"] if r["state"] != "lobby" else "",
            "length": len(r["phrase"]), "start_at": r["start_at"], "limit": RACE_LIMIT, "players": players}


def _save_type_score(uid, wpm):
    cur = H.q("SELECT * FROM office_scores WHERE user_id=?", (uid,), one=True) or {}
    vals = {g: int(cur.get(col) or 0) for g, col in SCORE_COLS.items()}
    vals["type"] = max(vals["type"], wpm)
    _write_scores(uid, vals)


def _write_scores(uid, vals):
    H.ex("INSERT INTO office_scores(user_id,snake,dash,duel,typerace,updated_at) VALUES(?,?,?,?,?,?) "
         "ON CONFLICT(user_id) DO UPDATE SET snake=excluded.snake, dash=excluded.dash, duel=excluded.duel, "
         "typerace=excluded.typerace, updated_at=excluded.updated_at",
         (uid, vals["snake"], vals["dash"], vals["duel"], vals["type"], H.iso(H.now_utc())))


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
            "pos": {k: pos.get(k) for k in ("x", "y", "g", "car", "carry", "act", "dir")} if pos else None,
        })
    return out


def _race():
    """Today's Deadline Race: everyone with time-blocked tasks today, ranked.

    Progress = share of today's planned block minutes whose tasks are Done.
    Minutes ahead = for each finished task, how long before its deadline it was done (no deadline: before its
    block ended); an open task past its deadline counts the minutes it is late against you.
    Order: people who finished every block first (most minutes ahead wins), then everyone else by progress,
    then minutes ahead.
    """
    today = H.local_today()
    tz, now = H.tz(), H.now_utc()
    rows = H.q("SELECT t.id, t.title, t.status, t.assignee_id, t.deadline, t.deadline_time, t.completed_at, "
               "t.block_start, t.block_end, u.name, u.avatar_file_id FROM tasks t "
               "JOIN clients c ON c.id=t.client_id JOIN users u ON u.id=t.assignee_id "
               "WHERE t.block_date=? AND t.block_start IS NOT NULL AND t.block_end IS NOT NULL "
               "AND t.archived_at IS NULL AND c.archived=0 AND u.active=1 ORDER BY t.block_start",
               (today.isoformat(),))
    people = {}
    for t in rows:
        try:
            start = H.datetime.combine(today, H.time.fromisoformat(t["block_start"]), tzinfo=tz)
            end = H.datetime.combine(today, H.time.fromisoformat(t["block_end"]), tzinfo=tz)
            due = H.deadline_moment(t) if t["deadline"] else end
        except (ValueError, TypeError):
            continue
        mins = max(1, int((end - start).total_seconds() // 60))
        done = t["status"] == "Done" and bool(t["completed_at"])
        r = people.setdefault(t["assignee_id"], {
            "id": t["assignee_id"], "name": t["name"], "avatar_file_id": t["avatar_file_id"], "blocks": 0, "done": 0,
            "planned_min": 0, "done_min": 0, "pace_min": 0, "ahead_min": 0, "late": False, "finished_at": None, "now": None, "next": None})
        r["blocks"] += 1
        r["planned_min"] += mins
        r["pace_min"] += max(0, min(mins, int((now - start).total_seconds() // 60)))   # where the plan says they should be
        block = {"title": t["title"], "start": t["block_start"], "end": t["block_end"]}
        if done:
            finished = H.parse_dt(t["completed_at"])
            r["done"] += 1
            r["done_min"] += mins
            r["ahead_min"] += int((due - finished).total_seconds() // 60)
            if not r["finished_at"] or finished.isoformat() > r["finished_at"]:
                r["finished_at"] = finished.isoformat()
        else:
            if now > due:
                r["late"] = True
                r["ahead_min"] -= int((now - due).total_seconds() // 60)
            if start <= now < end and not r["now"]:
                r["now"] = block
            elif now < start and not r["next"]:
                r["next"] = block
    racers = list(people.values())
    for r in racers:
        r["progress"] = round(r["done_min"] / r["planned_min"], 4) if r["planned_min"] else 0
        r["pace"] = round(r["pace_min"] / r["planned_min"], 4) if r["planned_min"] else 0
        r["state"] = "finished" if r["done"] == r["blocks"] else ("late" if r["late"] else "racing")
        if r["state"] != "finished":
            r["finished_at"] = None
    racers.sort(key=lambda r: (r["state"] != "finished", -r["ahead_min"] if r["state"] == "finished" else 0,
                               -r["progress"], -r["ahead_min"], r["finished_at"] or "", r["name"]))
    for i, r in enumerate(racers):
        r["rank"] = i + 1
    return {"date": today.isoformat(), "racers": racers}


def _general_space(uid):
    """The Google Chat space Office chat goes to: a space named 'General' that this person belongs to."""
    if not getattr(H.gchat, "configured", lambda: False)():
        return None
    try:
        return H.q("SELECT s.id, s.gname, s.display_name FROM chat_spaces s JOIN chat_members m ON m.space_id=s.id "
                   "WHERE m.user_id=? AND s.space_type='SPACE' AND lower(s.display_name) LIKE ? "
                   "AND EXISTS (SELECT 1 FROM google_accounts g WHERE g.user_id=m.user_id AND g.refresh_token IS NOT NULL AND g.refresh_token!='') "
                   "ORDER BY CASE WHEN lower(s.display_name)='general' THEN 0 ELSE 1 END, s.last_active DESC LIMIT 1",
                   (uid, "%general%"), one=True)
    except Exception:
        return None


def _post_to_chat(uid, space, text, shout):
    """Post an Office chat line into the General space as that person (runs in the background)."""
    gc = H.gchat
    try:
        body = {"text": ("📣 " if shout else "🏢 ") + text + "  _(from the Office)_"}
        m = gc.gapi(uid, "POST", f"/v1/{space['gname']}/messages", body=body)
        gc._ingest(space["id"], uid, [m], notify=True)
    except (gc.NotConnected, gc.GoogleError) as e:
        print(f"[office] couldn't post to {space['display_name']} for user {uid}: {e}", flush=True)
    except Exception as e:   # never let a chat hiccup break the Office
        print(f"[office] chat post failed: {type(e).__name__}: {e}", flush=True)


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
        scores = {r["user_id"]: {g: r.get(col) or 0 for g, col in SCORE_COLS.items()}
                  for r in H.q("SELECT * FROM office_scores")}
        return jsonify(me=uid, owner_id=_owner_id(), exec_ids=_exec_ids(), people=_team(), scores=scores,
                       events=events, inbox=inbox, seq=seq, server_time=time.time(),
                       messes=[{k: m[k] for k in ("id", "kind", "x", "y", "uid")} for m in MESSES])

    @app.get("/api/office/race")
    @lr
    def office_race():
        return jsonify(_race())

    @app.post("/api/office/move")
    @lr
    def office_move():
        uid, d = H.current_user()["id"], H.body()
        x, y = _int(d.get("x"), 0, MAP_W - 1), _int(d.get("y"), 0, MAP_H - 1)
        g = d.get("g") if d.get("g") in GAMES else None
        extra = {"car": bool(d.get("car")), "carry": d.get("carry") if d.get("carry") in CARRY else None,
                 "act": d.get("act") if d.get("act") in ACTS else None,
                 "dir": d.get("dir") if d.get("dir") in ("up", "down", "left", "right") else None}
        with _lock:
            if d.get("leave"):
                POS.pop(uid, None)
            elif x is not None and y is not None:
                POS[uid] = {"x": x, "y": y, "g": g, "t": time.time(), **extra}
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
        uid, d = H.current_user()["id"], H.body()
        text = " ".join(str(d.get("text") or "").split())[:120]
        if not text:
            return H.bad("Say something first")
        shout = bool(d.get("shout"))
        with _lock:
            EVENTS.append({"seq": _next(), "uid": uid, "text": text, "t": time.time(), "shout": shout})
            _prune(time.time())
        space = _general_space(uid)
        if space:
            threading.Thread(target=_post_to_chat, args=(uid, space, text, shout), daemon=True).start()
        return jsonify(ok=True, chat=space["display_name"] if space else None)

    @app.post("/api/office/emote")
    @lr
    def office_emote():
        uid, d, now = H.current_user()["id"], H.body(), time.time()
        emote = d.get("emote")
        if emote not in EMOTES or emote == "shout":
            return H.bad("Unknown move")
        with _lock:
            if now - _last_emote.get(uid, 0) < 1.5:
                return H.bad("Slow down a little", 429)
            pos = POS.get(uid)
            if not pos:
                return H.bad("Walk into the Office first")
            _last_emote[uid] = now
            ev = {"seq": _next(), "uid": uid, "kind": "emote", "what": emote, "x": pos["x"], "y": pos["y"], "t": now}
            if emote in ("poop", "pee"):
                MESSES.append({"id": ev["seq"], "kind": emote, "x": pos["x"], "y": pos["y"], "uid": uid, "t": now})
                ev["mess"] = ev["seq"]
            EVENTS.append(ev)
            _prune(now)
        return jsonify(ok=True)

    @app.post("/api/office/mess/clean")
    @lr
    def office_clean():
        uid, now = H.current_user()["id"], time.time()
        mid = _int(H.body().get("id"), 1, 10 ** 12)
        with _lock:
            m = next((m for m in MESSES if m["id"] == mid), None)
            if not m:
                return jsonify(ok=True, gone=True)
            MESSES.remove(m)
            EVENTS.append({"seq": _next(), "uid": uid, "kind": "emote", "what": "clean", "x": m["x"], "y": m["y"],
                           "mess": mid, "by": m["uid"], "t": now})
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
        if game not in ("snake", "dash", "duel"):      # Type Race results are recorded by the server, not posted
            return H.bad("Unknown game")
        cur = H.q("SELECT * FROM office_scores WHERE user_id=?", (uid,), one=True) or {}
        vals = {g: int(cur.get(col) or 0) for g, col in SCORE_COLS.items()}
        if game == "duel":
            vals["duel"] += 1                     # one more duel won against a teammate
        else:
            v = _int(d.get("value"), 0, 100000)
            if v is None:
                return H.bad("Bad score")
            vals[game] = max(vals[game], v)
        _write_scores(uid, vals)
        return jsonify(scores=vals)

    # ---------------- Type Race
    @app.get("/api/office/type")
    @lr
    def type_state():
        now = time.time()
        with _lock:
            _race_tick(now)
            return jsonify(race=_race_out(now), now=now, me=H.current_user()["id"])

    @app.post("/api/office/type/join")
    @lr
    def type_join():
        u, now = H.current_user(), time.time()
        with _lock:
            _race_tick(now)
            r = RACE["r"]
            if not r or r["state"] == "done":
                import random
                r = RACE["r"] = {"id": _next(), "host": u["id"], "state": "lobby", "phrase": random.choice(RACE_PHRASES),
                                 "players": {}, "created": now, "start_at": None, "ended_at": None, "finishers": 0}
                EVENTS.append({"seq": _next(), "uid": u["id"], "kind": "type", "what": "open", "text": "opened a Type Race", "t": now})
            if u["id"] not in r["players"]:
                if r["state"] != "lobby":
                    return H.bad("A race is already running. You can join the next one.", 409)
                if len(r["players"]) >= 8:
                    return H.bad("This race is full (8 players). Join the next one.", 409)
                r["players"][u["id"]] = {"pos": 0, "done": False, "wpm": 0, "place": None, "secs": None, "joined": now}
            return jsonify(race=_race_out(now), now=now, me=u["id"])

    @app.post("/api/office/type/start")
    @lr
    def type_start():
        uid, now = H.current_user()["id"], time.time()
        with _lock:
            r = RACE["r"]
            if not r or uid not in r["players"] or r["state"] != "lobby":
                return H.bad("There's no race waiting to start")
            r["state"], r["start_at"] = "countdown", now + 3.5
            return jsonify(race=_race_out(now), now=now, me=uid)

    @app.post("/api/office/type/progress")
    @lr
    def type_progress():
        uid, now = H.current_user()["id"], time.time()
        winner = None
        with _lock:
            _race_tick(now)
            r = RACE["r"]
            if not r or uid not in r["players"] or r["state"] != "racing":
                return jsonify(race=_race_out(now), now=now, me=uid)
            p = r["players"][uid]
            pos = _int(H.body().get("pos"), 0, len(r["phrase"]))
            if pos is not None and not p["done"]:
                p["pos"] = max(p["pos"], pos)
                if p["pos"] >= len(r["phrase"]):
                    secs = max(1.0, now - r["start_at"])
                    r["finishers"] += 1
                    p.update(done=True, secs=round(secs, 1), place=r["finishers"],
                             wpm=min(300, round(len(r["phrase"]) / 5 / (secs / 60))))
                    if p["place"] == 1:
                        winner = p["wpm"]
                        EVENTS.append({"seq": _next(), "uid": uid, "kind": "type", "what": "win",
                                       "text": f"won the Type Race at {p['wpm']} WPM", "t": now})
                    _race_tick(now)
            out, wpm, done = _race_out(now), p["wpm"], p["done"]
        if done and wpm:
            _save_type_score(uid, wpm)
        return jsonify(race=out, now=now, me=uid, won=bool(winner))

    @app.post("/api/office/type/leave")
    @lr
    def type_leave():
        uid, now = H.current_user()["id"], time.time()
        with _lock:
            r = RACE["r"]
            if r and uid in r["players"] and not (r["state"] in ("racing", "done") and r["players"][uid]["done"]):
                r["players"].pop(uid, None)
                if r["host"] == uid and r["players"]:
                    r["host"] = next(iter(r["players"]))
            _race_tick(now)
            return jsonify(race=_race_out(now), now=now, me=uid)

