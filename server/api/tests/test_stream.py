import asyncio

from fastapi.testclient import TestClient

from vampn_api.config import Settings, load_settings
from vampn_api.main import create_app
from vampn_api.stream import notification_stream, sse


class Ticker:
    """Фальшивое время: sleep ничего не ждёт, а двигает часы и даёт вмешаться между опросами."""

    def __init__(self, on_tick=None):
        self.t = 0.0
        self.ticks = 0
        self.on_tick = on_tick

    def clock(self):
        return self.t

    async def sleep(self, seconds):
        self.t += seconds
        self.ticks += 1
        if self.on_tick:
            self.on_tick(self)


def collect(signature, still_valid=lambda: True, ticker=None, **kw):
    ticker = ticker or Ticker()
    opts = dict(poll=3, heartbeat=100, recheck=100, max_seconds=12)
    opts.update(kw)

    async def run():
        return [c async for c in notification_stream(signature, still_valid, sleep=ticker.sleep, clock=ticker.clock, **opts)]

    return asyncio.run(run())


def kinds(chunks):
    return [c.split("\n")[0][len("event: "):] for c in chunks if c.startswith("event:")]


# ---------- сам поток ----------
def test_frame_format():
    assert sse("ready") == "event: ready\ndata: {}\n\n"
    assert sse("x", {"a": "б"}) == 'event: x\ndata: {"a": "б"}\n\n'


def test_stream_announces_change_and_closes_on_time():
    state = {"sig": (0,)}
    ticker = Ticker(lambda t: state.update(sig=(1,)) if t.ticks == 2 else None)
    chunks = collect(lambda: state["sig"], ticker=ticker)
    assert chunks[0] == "retry: 3000\n\n"
    assert kinds(chunks) == ["ready", "changed", "bye"]


def test_stream_without_changes_only_pings():
    chunks = collect(lambda: (0,), heartbeat=5, max_seconds=13)
    assert kinds(chunks) == ["ready", "bye"]
    assert chunks.count(": ping\n\n") == 2


def test_change_resets_the_ping_timer():
    state = {"sig": (0,)}
    ticker = Ticker(lambda t: state.update(sig=(t.ticks,)) if t.ticks <= 2 else None)
    chunks = collect(lambda: state["sig"], ticker=ticker, heartbeat=5, max_seconds=13)
    # изменения на 3-й и 6-й секундах; после них пинг не раньше чем через heartbeat
    assert kinds(chunks) == ["ready", "changed", "changed", "bye"]
    assert chunks.count(": ping\n\n") == 1


def test_stream_stops_when_session_is_gone():
    chunks = collect(lambda: (0,), still_valid=lambda: False, recheck=5)
    assert kinds(chunks) == ["ready", "unauthorized"]


def test_stream_reports_database_failure_and_stops():
    calls = {"n": 0}

    def flaky():
        calls["n"] += 1
        if calls["n"] > 1:
            raise RuntimeError("db down")
        return (0,)

    assert kinds(collect(flaky)) == ["ready", "error"]

    def broken():
        raise RuntimeError("db down")

    assert kinds(collect(broken)) == ["error"]


# ---------- эндпоинт ----------
def fast_client(env, **extra):
    s = Settings(secret="test-secret", stream_poll_seconds=0.01, stream_heartbeat_seconds=0.05,
                 stream_recheck_seconds=0.05, stream_max_seconds=0.3, **extra)
    return TestClient(create_app(s, env.store, env.mailer, env.runner, env.push, env.clock))


def on_poll(env, nth, action):
    """Выполняет action при n-м опросе подписи: так изменение приходит ровно во время потока, без таймеров."""
    original, calls = env.store.notifications_signature, {"n": 0}

    def spy(ids):
        calls["n"] += 1
        if calls["n"] == nth:
            action()
        return original(ids)

    env.store.notifications_signature = spy


def test_stream_requires_login(env):
    assert env.client.get("/v1/notifications/stream").status_code == 401
    assert env.client.get("/v1/notifications/stream", headers={"Authorization": "Bearer nope"}).status_code == 401


def test_stream_opens_and_closes_by_time(env):
    h, _ = env.login("griga@example.com")
    r = fast_client(env).get("/v1/notifications/stream", headers=h)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/event-stream")
    assert r.headers["cache-control"] == "no-cache"
    assert r.text.startswith("retry: 3000")
    assert "event: ready" in r.text and "event: bye" in r.text
    assert "event: changed" not in r.text


def test_stream_reports_a_new_notification(env):
    h, _ = env.login("griga@example.com")
    uid = env.store.get_user("griga")["id"]
    on_poll(env, 3, lambda: env.store.add_notification(uid, None, "key", "Новый ключ VPN", env.clock()))
    r = fast_client(env).get("/v1/notifications/stream", headers=h)
    assert "event: changed" in r.text


def test_stream_reports_status_change_of_an_existing_notification(env):
    h, _ = env.login("griga@example.com")
    uid = env.store.get_user("griga")["id"]
    nid = env.store.add_notification(uid, None, "key", "Новый ключ VPN", env.clock())
    on_poll(env, 3, lambda: env.store.mark_notification(nid, [uid], "read_at", env.clock()))
    r = fast_client(env).get("/v1/notifications/stream", headers=h)
    assert "event: changed" in r.text


def test_stream_ignores_notifications_of_other_people(env):
    h, _ = env.login("griga@example.com")
    other = env.store.get_user("mio")["id"]
    on_poll(env, 3, lambda: env.store.add_notification(other, None, "key", "Чужой ключ", env.clock()))
    r = fast_client(env).get("/v1/notifications/stream", headers=h)
    assert "event: changed" not in r.text


def test_stream_closes_when_the_session_is_revoked(env):
    h, _ = env.login("griga@example.com")
    uid = env.store.get_user("griga")["id"]
    on_poll(env, 2, lambda: env.store.revoke_user_sessions([uid], env.clock()))
    r = fast_client(env).get("/v1/notifications/stream", headers=h)
    assert "event: unauthorized" in r.text and "event: bye" not in r.text


# ---------- настройки ----------
def test_stream_settings_defaults_and_env():
    s = load_settings({})
    assert (s.stream_poll_seconds, s.stream_heartbeat_seconds, s.stream_recheck_seconds, s.stream_max_seconds) == (3.0, 15.0, 30.0, 1800.0)
    s = load_settings({"STREAM_POLL_SECONDS": "0.5", "STREAM_MAX_SECONDS": "60"})
    assert s.stream_poll_seconds == 0.5 and s.stream_max_seconds == 60.0
