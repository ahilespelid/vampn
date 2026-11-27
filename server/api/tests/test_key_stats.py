"""Статистика по ключам: /v1/stats/keys и /v1/stats/keys/{имя}. Данные кладём прямо в фейковое хранилище."""
from datetime import datetime, timedelta


def put(env, name, **kw):
    row = dict(key_name=name, up_total=0, down_total=0, connections=0, tracked_since=datetime(2026, 11, 20),
               first_seen_at=None, last_seen_at=None, last_client_ip=None, last_server=None, last_server_ip=None)
    row.update(kw)
    env.store.key_stats[name] = row


def traffic(env, name, ago, up, down):
    env.store.key_traffic.append(dict(key_name=name, hour=env.clock() - ago, up_bytes=up, down_bytes=down))


def event(env, eid, name, kind, ago, old=None, new=None, server="основной", server_ip="198.51.100.7"):
    env.store.key_events.append(dict(id=eid, ts=env.clock() - ago, key_name=name, kind=kind, old_value=old, new_value=new,
                                     server=server, server_ip=server_ip))


def keys_of(env, h):
    r = env.client.get("/v1/stats/keys", headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def test_stats_require_login(env):
    assert env.client.get("/v1/stats/keys").status_code == 401
    assert env.client.get("/v1/stats/keys/griga").status_code == 401


def test_user_sees_only_own_key(env):
    put(env, "griga", up_total=100, down_total=900, connections=3)
    put(env, "mio", up_total=5, down_total=5)
    h, _ = env.login("griga@example.com")
    body = keys_of(env, h)
    assert [k["name"] for k in body["keys"]] == ["griga"]
    k = body["keys"][0]
    assert (k["up_total"], k["down_total"], k["connections"]) == (100, 900, 3)
    assert body["totals"]["keys"] == 1 and body["totals"]["down_total"] == 900 and body["totals"]["online"] == 0


def test_shared_email_sees_both_names_even_without_data(env):
    h, _ = env.login("shared@example.com")
    assert [k["name"] for k in keys_of(env, h)["keys"]] == ["andrey", "mio"]


def test_admin_sees_everyone_including_removed_and_unknown_keys(env):
    put(env, "ghost", down_total=1)  # ключ есть в статистике, пользователя в базе нет
    env.store.revoke_user("old", "revoked_in_app", env.clock())
    h, _ = env.login("boss@example.com")
    keys = {k["name"]: k for k in keys_of(env, h)["keys"]}
    assert set(keys) == {"ahilespelid", "griga", "mio", "andrey", "old", "ghost"}
    assert keys["griga"]["added_at"] == "2026-01-01T00:00:00Z" and keys["griga"]["removed_at"] is None
    assert keys["old"]["active"] is False and keys["old"]["removed_at"] == "2026-11-24T12:00:00Z"
    assert keys["old"]["removed_reason"] == "revoked_in_app"
    assert keys["ghost"]["role"] is None and keys["ghost"]["added_at"] is None


def test_keys_sorted_by_traffic_and_totals_added_up(env):
    put(env, "griga", up_total=1, down_total=1, connections=1)
    put(env, "mio", up_total=500, down_total=500, connections=4)
    put(env, "andrey", up_total=10, down_total=10, connections=2)
    h, _ = env.login("boss@example.com")
    body = keys_of(env, h)
    assert [k["name"] for k in body["keys"]][:3] == ["mio", "andrey", "griga"]
    assert body["totals"]["connections"] == 7 and body["totals"]["up_total"] == 511 and body["totals"]["keys"] == 5


def test_period_sums_and_online_flag(env):
    now = env.clock()
    put(env, "griga", last_seen_at=now - timedelta(seconds=60))
    traffic(env, "griga", timedelta(hours=2), 10, 100)
    traffic(env, "griga", timedelta(days=3), 20, 200)
    traffic(env, "griga", timedelta(days=20), 40, 400)
    traffic(env, "griga", timedelta(days=40), 80, 800)  # старше 30 дней в суммы не входит
    h, _ = env.login("griga@example.com")
    k = keys_of(env, h)["keys"][0]
    assert (k["up_24h"], k["down_24h"]) == (10, 100)
    assert (k["up_7d"], k["down_7d"]) == (30, 300)
    assert (k["up_30d"], k["down_30d"]) == (70, 700)
    assert k["online"] is True and keys_of(env, h)["totals"]["online"] == 1
    env.store.key_stats["griga"]["last_seen_at"] = now - timedelta(seconds=600)
    assert keys_of(env, h)["keys"][0]["online"] is False


def test_key_without_data_yet_is_zeros_not_error(env):
    h, _ = env.login("griga@example.com")
    k = keys_of(env, h)["keys"][0]
    assert k["name"] == "griga" and k["up_total"] == 0 and k["connections"] == 0 and k["last_seen_at"] is None
    assert k["online"] is False and k["last_client_ip"] is None
    d = env.client.get("/v1/stats/keys/griga", headers=h).json()
    assert d["days"] == [] and d["client_ips"] == [] and d["events"] == [] and d["issued"] == []


def test_key_detail(env):
    now = env.clock()
    put(env, "griga", up_total=1, down_total=2, connections=2, last_client_ip="198.51.100.50", last_server="основной",
        last_server_ip="203.0.113.77", last_seen_at=now - timedelta(seconds=30))
    traffic(env, "griga", timedelta(hours=1), 10, 100)
    traffic(env, "griga", timedelta(hours=2), 5, 50)
    traffic(env, "griga", timedelta(days=2), 7, 70)
    event(env, 1, "griga", "connect", timedelta(days=1), new="203.0.113.5")
    event(env, 2, None, "server_ip", timedelta(hours=20), old="198.51.100.7", new="203.0.113.77", server_ip="203.0.113.77")
    event(env, 3, "griga", "connect", timedelta(hours=2), new="198.51.100.50", server_ip="203.0.113.77")
    event(env, 4, "griga", "client_ip", timedelta(hours=2), old="203.0.113.5", new="198.51.100.50", server_ip="203.0.113.77")
    event(env, 5, "mio", "connect", timedelta(hours=1), new="192.0.2.77")  # чужое событие в ответ не попадает
    uid = env.store.get_user("griga")["id"]
    env.store.add_key(uid, "griga", "created", "system", now - timedelta(days=30))
    env.store.add_key(uid, "griga", "reissued", "ahilespelid", now - timedelta(days=2))
    h, _ = env.login("griga@example.com")
    r = env.client.get("/v1/stats/keys/griga", headers=h)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["name"] == "griga" and (d["last_client_ip"], d["last_server"], d["last_server_ip"]) == \
        ("198.51.100.50", "основной", "203.0.113.77")
    assert d["days"] == [{"day": "2026-11-22", "up": 7, "down": 70}, {"day": "2026-11-24", "up": 15, "down": 150}]
    assert [(e["kind"], e["key"]) for e in d["events"]] == \
        [("client_ip", "griga"), ("connect", "griga"), ("server_ip", None), ("connect", "griga")]
    assert d["events"][0]["old"] == "203.0.113.5" and d["events"][0]["new"] == "198.51.100.50"
    assert d["events"][2]["old"] == "198.51.100.7" and d["events"][2]["new"] == "203.0.113.77"
    assert d["client_ips"] == [{"ip": "198.51.100.50", "connects": 1, "last_at": "2026-11-24T10:00:00Z"},
                               {"ip": "203.0.113.5", "connects": 1, "last_at": "2026-11-23T12:00:00Z"}]
    assert [i["reason"] for i in d["issued"]] == ["reissued", "created"]
    assert "issued_by" not in d["issued"][0]


def test_detail_permissions(env):
    put(env, "mio", down_total=5)
    put(env, "ghost", down_total=1)
    h, _ = env.login("griga@example.com")
    assert env.client.get("/v1/stats/keys/mio", headers=h).status_code == 404       # чужой
    assert env.client.get("/v1/stats/keys/nobody", headers=h).status_code == 404    # несуществующий: тот же ответ
    assert env.client.get("/v1/stats/keys/ghost", headers=h).status_code == 404
    assert env.client.get("/v1/stats/keys/bad name", headers=h).status_code == 400
    assert env.client.get("/v1/stats/keys/x';--", headers=h).status_code == 400
    hb, _ = env.login("boss@example.com")
    assert env.client.get("/v1/stats/keys/mio", headers=hb).status_code == 200
    assert env.client.get("/v1/stats/keys/old", headers=hb).status_code == 200      # удалённый тоже
    ghost = env.client.get("/v1/stats/keys/ghost", headers=hb)
    assert ghost.status_code == 200 and ghost.json()["role"] is None and ghost.json()["issued"] == []
    assert env.client.get("/v1/stats/keys/nobody", headers=hb).status_code == 404


def test_shared_email_can_open_both_details(env):
    h, _ = env.login("shared@example.com")
    assert env.client.get("/v1/stats/keys/mio", headers=h).status_code == 200
    assert env.client.get("/v1/stats/keys/andrey", headers=h).status_code == 200
    assert env.client.get("/v1/stats/keys/griga", headers=h).status_code == 404
