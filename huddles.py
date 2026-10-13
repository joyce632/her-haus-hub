"""Huddles: live voice calls inside Her Haus Hub (like Slack huddles), tied to a chat.

Audio flows directly between browsers (WebRTC, peer-to-peer). This server only keeps track of who is in
which huddle and passes the short connection messages between browsers ("signaling"), over plain HTTP
polling — so it runs on the existing single app worker with no extra services. State lives in memory: if the
app restarts, open huddles end and people simply start a new one.
"""
import json
import os
import threading
import time
import uuid

from flask import jsonify, request

H = None
_lock = threading.RLock()
HUDDLES = {}      # huddle id -> {id, space_id, started_by, started_at, participants: {uid: {...}}, invited: {uid: by}}
SIGNALS = {}      # uid -> [ {seq, from, huddle, type, data} ]
_seq = [0]
STALE_SECONDS = 25   # a participant whose browser stops checking in this long is dropped


def ice_servers():
    """STUN by default; set HUDDLE_ICE_SERVERS (JSON) to add a TURN relay for strict networks."""
    try:
        extra = json.loads(os.environ.get("HUDDLE_ICE_SERVERS") or "[]")
    except ValueError:
        extra = []
    return [{"urls": ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"]}] + extra


def _user(uid):
    return H.q("SELECT id, name, avatar_file_id FROM users WHERE id=? AND active=1", (uid,), one=True)


def _space_members(sid):
    return {r["user_id"] for r in H.q("SELECT user_id FROM chat_members WHERE space_id=?", (sid,))}


def _space(sid):
    return H.q("SELECT * FROM chat_spaces WHERE id=?", (sid,), one=True)


def _cleanup():
    """Drop people whose browsers went quiet, and end empty huddles."""
    now = time.time()
    for hid in list(HUDDLES):
        h = HUDDLES[hid]
        for uid in [u for u, p in h["participants"].items() if p["seen"] < now - STALE_SECONDS]:
            h["participants"].pop(uid, None)
            _broadcast(h, uid, "leave", {})
        if not h["participants"] and h["started_at"] < now - 10:
            HUDDLES.pop(hid, None)


def _broadcast(h, from_uid, kind, data):
    for uid in h["participants"]:
        if uid != from_uid:
            _push(uid, from_uid, h["id"], kind, data)


def _push(to_uid, from_uid, hid, kind, data):
    _seq[0] += 1
    q = SIGNALS.setdefault(to_uid, [])
    q.append({"seq": _seq[0], "from": from_uid, "huddle": hid, "type": kind, "data": data})
    del q[:-500]   # never let a queue grow without bound


def _leave_others(uid, keep_hid):
    """Someone can only be in one huddle at a time."""
    for hid in list(HUDDLES):
        h = HUDDLES[hid]
        if hid != keep_hid and uid in h["participants"]:
            h["participants"].pop(uid, None)
            _broadcast(h, uid, "leave", {})
            if not h["participants"]:
                HUDDLES.pop(hid, None)


def _out(h, me):
    sp = _space(h["space_id"]) or {}
    people = []
    for uid, p in h["participants"].items():
        u = _user(uid)
        if u:
            people.append({"id": uid, "name": u["name"], "avatar_file_id": u["avatar_file_id"], "muted": p["muted"], "sharing": p.get("sharing", False),
                           "joined_at": p["joined"], "is_me": uid == me})
    starter = _user(h["started_by"]) or {}
    return {"id": h["id"], "space_id": h["space_id"], "space_title": sp.get("display_name") or "", "space_type": sp.get("space_type") or "",
            "started_by": starter.get("name", ""), "started_at": h["started_at"], "participants": people,
            "in_it": me in h["participants"], "invited_me": me in h["invited"] and me not in h["participants"],
            "invited_by": (_user(h["invited"].get(me)) or {}).get("name", "") if me in h["invited"] else ""}


def _can_see(h, uid):
    return uid in h["participants"] or uid in h["invited"] or uid in _space_members(h["space_id"])


def visible_huddles(uid):
    """Huddles this person can see: in chats they're part of, or ones they've been invited to."""
    with _lock:
        _cleanup()
        return [_out(h, uid) for h in HUDDLES.values() if h["participants"] and _can_see(h, uid)]


def register(module):
    global H
    H = module
    app, lr = H.app, H.login_required

    def _get(hid, uid, must_be_in=False):
        h = HUDDLES.get(hid)
        if not h or (must_be_in and uid not in h["participants"]) or not _can_see(h, uid):
            H.abort(404)
        return h

    @app.get("/api/huddles")
    @lr
    def huddles_list():
        return jsonify(huddles=visible_huddles(H.current_user()["id"]), ice=ice_servers())

    @app.post("/api/huddles/start")
    @lr
    def huddle_start():
        u = H.current_user()
        sid = int(H.body().get("space_id") or 0)
        if u["id"] not in _space_members(sid):
            H.abort(404)
        with _lock:
            _cleanup()
            h = next((x for x in HUDDLES.values() if x["space_id"] == sid and x["participants"]), None)
            started = h is None
            if started:
                h = {"id": uuid.uuid4().hex[:12], "space_id": sid, "started_by": u["id"], "started_at": time.time(),
                     "participants": {}, "invited": {}}
                HUDDLES[h["id"]] = h
                sp = _space(sid)
                if sp and sp["space_type"] != "SPACE":   # DMs / group chats: ring everyone else in the chat
                    for other in _space_members(sid) - {u["id"]}:
                        h["invited"][other] = u["id"]
                        _ring(other, u, h)
            _leave_others(u["id"], h["id"])
            others = [x for x in h["participants"] if x != u["id"]]
            h["participants"][u["id"]] = {"joined": time.time(), "seen": time.time(), "muted": False}
            h["invited"].pop(u["id"], None)
            _broadcast(h, u["id"], "join", {})
            out = _out(h, u["id"])
        if started:
            _announce(u, sid)
        return jsonify(huddle=out, peers=others, started=started, ice=ice_servers())

    @app.post("/api/huddles/<hid>/join")
    @lr
    def huddle_join(hid):
        u = H.current_user()
        with _lock:
            _cleanup()
            h = _get(hid, u["id"])
            _leave_others(u["id"], hid)
            others = [x for x in h["participants"] if x != u["id"]]
            h["participants"][u["id"]] = {"joined": time.time(), "seen": time.time(), "muted": False}
            h["invited"].pop(u["id"], None)
            SIGNALS.pop(u["id"], None)   # start clean
            _broadcast(h, u["id"], "join", {})
            out = _out(h, u["id"])
        return jsonify(huddle=out, peers=others, ice=ice_servers())

    @app.post("/api/huddles/<hid>/leave")
    @lr
    def huddle_leave(hid):
        u = H.current_user()
        with _lock:
            h = HUDDLES.get(hid)
            if h and u["id"] in h["participants"]:
                h["participants"].pop(u["id"], None)
                _broadcast(h, u["id"], "leave", {})
                if not h["participants"]:
                    HUDDLES.pop(hid, None)
            SIGNALS.pop(u["id"], None)
        return jsonify(ok=True)

    @app.post("/api/huddles/<hid>/decline")
    @lr
    def huddle_decline(hid):
        u = H.current_user()
        with _lock:
            h = HUDDLES.get(hid)
            if h:
                h["invited"].pop(u["id"], None)
                _broadcast(h, u["id"], "declined", {"name": u["name"]})
        return jsonify(ok=True)

    @app.post("/api/huddles/<hid>/invite")
    @lr
    def huddle_invite(hid):
        u = H.current_user()
        ids = [int(i) for i in (H.body().get("user_ids") or []) if str(i).isdigit()][:20]
        with _lock:
            h = _get(hid, u["id"], must_be_in=True)
            invited = []
            for uid in ids:
                if uid in h["participants"] or not _user(uid):
                    continue
                h["invited"][uid] = u["id"]
                _ring(uid, u, h)
                invited.append(uid)
            out = _out(h, u["id"])
        return jsonify(invited=invited, huddle=out)

    @app.put("/api/huddles/<hid>/me")
    @lr
    def huddle_me(hid):
        u = H.current_user()
        with _lock:
            h = _get(hid, u["id"], must_be_in=True)
            d = H.body()
            me = h["participants"][u["id"]]
            if "muted" in d:
                me["muted"] = bool(d.get("muted"))
            if "sharing" in d:
                if d.get("sharing") and any(p.get("sharing") for uid, p in h["participants"].items() if uid != u["id"]):
                    return H.bad("Someone else is already sharing their screen", 409)
                me["sharing"] = bool(d.get("sharing"))
            _broadcast(h, u["id"], "state", {"muted": me["muted"], "sharing": me.get("sharing", False)})
        return jsonify(ok=True)

    @app.post("/api/huddles/<hid>/signal")
    @lr
    def huddle_signal(hid):
        """Pass a WebRTC offer / answer / ICE candidate to one other person in the huddle."""
        u = H.current_user()
        d = request.get_json(silent=True) or {}
        kind = d.get("type")
        if kind not in ("offer", "answer", "ice", "reoffer", "reanswer"):   # re-: adding/removing a shared screen mid-call
            return H.bad("Unknown signal")
        payload = json.dumps(d.get("data"))
        if len(payload) > 60_000:
            return H.bad("Signal too large")
        with _lock:
            h = _get(hid, u["id"], must_be_in=True)
            to = int(d.get("to") or 0)
            if to not in h["participants"]:
                return H.bad("They left the huddle", 410)
            _push(to, u["id"], hid, kind, d.get("data"))
        return jsonify(ok=True)

    @app.get("/api/huddles/<hid>/poll")
    @lr
    def huddle_poll(hid):
        """Every second while you're in a huddle: check in, collect signals for you, get who's here."""
        u = H.current_user()
        since = int(request.args.get("since") or 0)
        with _lock:
            h = HUDDLES.get(hid)
            if h and u["id"] in h["participants"]:
                h["participants"][u["id"]]["seen"] = time.time()   # check in first, then tidy up the others
            _cleanup()
            h = HUDDLES.get(hid)
            if not h or u["id"] not in h["participants"]:
                return jsonify(ended=True, signals=[], huddle=None)
            q = SIGNALS.get(u["id"], [])
            mine = [s for s in q if s["seq"] > since and s["huddle"] == hid]
            SIGNALS[u["id"]] = [s for s in q if s["seq"] > since]
            return jsonify(ended=False, signals=mine, huddle=_out(h, u["id"]))


def _ring(uid, by, h):
    """Invitation: a hub notification (rings in their browser) for the person being invited."""
    H.ex("INSERT INTO notifications(user_id,actor_id,kind,task_id,chat_space_id,snippet,created_at) VALUES(?,?,?,?,?,?,?)",
         (uid, by["id"], "huddle_invite", None, h["space_id"], f"{by['name']} invited you to a huddle", H.iso(H.now_utc())))


def _announce(u, sid):
    """Spaces: post a short note in Google Chat so people there know a huddle is on."""
    sp = _space(sid)
    if not sp or sp["space_type"] != "SPACE":
        return
    base = (H.settings().get("app_url") or "").rstrip("/") or request.url_root.rstrip("/")
    text = f"🎧 *{u['name']}* started a huddle — <{base}/#/chat/{sid}|join in Her Haus Hub>"

    def run():
        try:
            with H.app.app_context():
                H.gchat.gapi(u["id"], "POST", f"/v1/{sp['gname']}/messages", body={"text": text})
        except Exception as e:   # the huddle works either way
            print(f"[huddle] announce failed: {e!r}", flush=True)
    threading.Thread(target=run, daemon=True).start()
