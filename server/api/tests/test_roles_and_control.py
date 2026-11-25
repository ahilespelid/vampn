import pytest

from vampn_api.commands import build_argv, extract_link
from vampn_api.errors import BadRequest, CommandFailed


# ---------- роли ----------
def test_ordinary_user_cannot_see_or_add_users(env):
    h, _ = env.login("griga@example.com")
    assert env.client.get("/v1/admin/users", headers=h).status_code == 403
    assert env.client.post("/v1/admin/users", headers=h, json={"name": "x", "email": "x@example.com"}).status_code == 403
    assert env.client.patch("/v1/admin/users/mio", headers=h, json={"active": False}).status_code == 403
    assert env.client.get("/v1/admin/events", headers=h).status_code == 403


def test_admin_sees_users(env):
    h, _ = env.login("boss@example.com")
    r = env.client.get("/v1/admin/users", headers=h)
    assert r.status_code == 200 and {u["name"] for u in r.json()["users"]} >= {"griga", "old"}


def test_ordinary_user_can_control_service_but_not_force_or_emergency(env):
    h, _ = env.login("griga@example.com")
    assert env.client.get("/v1/status", headers=h).status_code == 200
    assert env.client.post("/v1/control/rotate", headers=h, json={}).status_code == 200
    assert env.client.post("/v1/control/reboot", headers=h, json={}).status_code == 200
    assert env.client.post("/v1/control/rotate", headers=h, json={"force": True}).status_code == 403
    assert env.client.post("/v1/control/emergency", headers=h, json={"mode": "on"}).status_code == 403
    assert env.client.post("/v1/control/emergency", headers=h, json={"mode": "status"}).status_code == 200


def test_admin_can_force_and_emergency(env):
    h, _ = env.login("boss@example.com")
    assert env.client.post("/v1/control/rotate", headers=h, json={"force": True}).status_code == 200
    assert env.client.post("/v1/control/emergency", headers=h, json={"mode": "on"}).status_code == 200
    assert ("rotate", "--force") in env.runner.calls and ("emergency", "on") in env.runner.calls


# ---------- ключи ----------
def test_user_gets_only_own_key_link(env):
    h, _ = env.login("griga@example.com")
    r = env.client.post("/v1/keys/griga/link", headers=h)
    assert r.status_code == 200 and r.json()["link"] == "vpn://TESTLINK"
    assert env.client.post("/v1/keys/mio/link", headers=h).status_code == 404
    assert env.client.post("/v1/keys/bad name/link", headers=h).status_code in (400, 404)


def test_shared_email_can_manage_both_names(env):
    h, _ = env.login("shared@example.com")
    assert env.client.post("/v1/keys/mio/link", headers=h).status_code == 200
    assert env.client.post("/v1/keys/andrey/link", headers=h).status_code == 200


def test_admin_can_fetch_any_active_key(env):
    h, _ = env.login("boss@example.com")
    assert env.client.post("/v1/keys/griga/link", headers=h).status_code == 200
    assert env.client.post("/v1/keys/old/link", headers=h).status_code == 404  # отозванный


def test_reissue_records_key_notification_and_push(env):
    hd, _ = env.login("griga@example.com", {"platform": "android", "name": "Pixel", "push_token": "tok-g"})
    r = env.client.post("/v1/keys/griga/reissue", headers=hd)
    assert r.status_code == 200
    nid = r.json()["notification_id"]
    n = env.store.notifs[0]
    assert n["email_sent_at"] is not None and n["push_sent_at"] is not None
    assert env.push.sent == [(1, "Новый ключ VPN")]
    keys = env.client.get("/v1/keys", headers=hd).json()["keys"]
    assert len(keys) == 1 and keys[0]["reason"] == "reissued"
    lst = env.client.get("/v1/notifications", headers=hd).json()["notifications"]
    assert lst[0]["id"] == nid and lst[0]["read_at"] is None
    assert env.client.post("/v1/notifications/%d/delivered" % nid, headers=hd).status_code == 200
    assert env.client.post("/v1/notifications/%d/read" % nid, headers=hd).status_code == 200
    lst = env.client.get("/v1/notifications", headers=hd).json()["notifications"]
    assert lst[0]["delivered_at"] and lst[0]["read_at"]


def _vampn_hook_on_reissue(env):
    """Как хук в почтовой части vampn: при отправке письма с ключом сам заводит ключ и уведомление."""
    real = env.runner.run_ok

    def run_ok(sub, arg=""):
        out = real(sub, arg)
        if sub == "reissue":
            user = env.store.get_user(arg)
            kid = env.store.add_key(user["id"], arg, "reissued", "vampn", env.clock())
            nid = env.store.add_notification(user["id"], kid, "key", "Новый ключ VPN", env.clock())
            env.store.mark_notification(nid, [user["id"]], "email_sent_at", env.clock())
        return out

    env.runner.run_ok = run_ok


def test_reissue_does_not_duplicate_notification_made_by_vampn(env):
    _vampn_hook_on_reissue(env)
    hd, _ = env.login("griga@example.com", {"platform": "android", "name": "Pixel", "push_token": "tok-g"})
    r = env.client.post("/v1/keys/griga/reissue", headers=hd)
    assert r.status_code == 200
    assert len(env.store.keys) == 1 and len(env.store.notifs) == 1
    assert r.json() == {"key_id": env.store.keys[0]["id"], "notification_id": env.store.notifs[0]["id"]}
    assert env.store.keys[0]["issued_by"] == "vampn"
    assert env.store.notifs[0]["push_sent_at"] is not None  # push уходит и для уведомления, заведённого vampn


def test_reissue_ignores_old_notification_and_makes_its_own(env):
    hd, _ = env.login("griga@example.com")
    uid = env.store.get_user("griga")["id"]
    kid = env.store.add_key(uid, "griga", "reissued", "vampn", env.clock())
    env.store.add_notification(uid, kid, "key", "Новый ключ VPN: сменился адрес сервера", env.clock())
    env.clock.advance(minutes=10)
    r = env.client.post("/v1/keys/griga/reissue", headers=hd)
    assert r.status_code == 200
    assert len(env.store.keys) == 2 and len(env.store.notifs) == 2
    assert r.json()["notification_id"] == env.store.notifs[1]["id"]


def test_notifications_not_visible_to_others(env):
    hg, _ = env.login("griga@example.com")
    env.client.post("/v1/keys/griga/reissue", headers=hg)
    hs, _ = env.login("shared@example.com")
    assert env.client.get("/v1/notifications", headers=hs).json()["notifications"] == []
    nid = env.store.notifs[0]["id"]
    assert env.client.post("/v1/notifications/%d/read" % nid, headers=hs).status_code == 404


def test_push_not_marked_when_nothing_delivered(env):
    env.push.delivered = 0
    hg, _ = env.login("griga@example.com", {"platform": "android", "name": "x", "push_token": "t"})
    env.client.post("/v1/keys/griga/reissue", headers=hg)
    assert env.store.notifs[0]["push_sent_at"] is None


def test_history_visible_to_admin_for_all(env):
    hg, _ = env.login("griga@example.com")
    env.client.post("/v1/keys/griga/reissue", headers=hg)
    hb, _ = env.login("boss@example.com")
    assert len(env.client.get("/v1/keys?all=true", headers=hb).json()["keys"]) == 1
    assert len(env.client.get("/v1/keys?all=true", headers=hg).json()["keys"]) == 1  # у обычного all игнорируется, только свои


# ---------- пользователи (суперадмин) ----------
def test_admin_creates_user_and_event_logged(env):
    h, _ = env.login("boss@example.com")
    r = env.client.post("/v1/admin/users", headers=h, json={"name": "newbie", "email": "NEW@example.com"})
    assert r.status_code == 200
    u = env.store.get_user("newbie")
    assert u["email"] == "new@example.com" and u["role"] == "user"
    assert env.store.events[-1]["event"] == "created" and env.store.events[-1]["source"] == "app"
    assert env.client.post("/v1/admin/users", headers=h, json={"name": "newbie", "email": "n@example.com"}).status_code == 409


def test_admin_create_validates_input(env):
    h, _ = env.login("boss@example.com")
    assert env.client.post("/v1/admin/users", headers=h, json={"name": "bad name", "email": "a@example.com"}).status_code == 400
    assert env.client.post("/v1/admin/users", headers=h, json={"name": "ok", "email": "not-an-email"}).status_code == 400


def test_admin_creating_revoked_name_restores_it(env):
    h, _ = env.login("boss@example.com")
    assert env.client.post("/v1/admin/users", headers=h, json={"name": "old", "email": "old2@example.com"}).status_code == 200
    u = env.store.get_user("old")
    assert u["active"] == 1 and u["email"] == "old2@example.com" and env.store.events[-1]["event"] == "restored"


def test_revoke_is_soft_and_kills_sessions(env):
    hg, _ = env.login("griga@example.com")
    hb, _ = env.login("boss@example.com")
    assert env.client.patch("/v1/admin/users/griga", headers=hb, json={"active": False}).status_code == 200
    u = env.store.get_user("griga")
    assert u is not None and u["active"] == 0 and u["revoked_at"] and u["revoked_reason"] == "revoked_in_app"
    assert env.client.get("/v1/me", headers=hg).status_code == 401
    assert env.store.events[-1]["event"] == "revoked"


def test_cannot_revoke_or_demote_last_admin(env):
    hb, _ = env.login("boss@example.com")
    assert env.client.patch("/v1/admin/users/ahilespelid", headers=hb, json={"active": False}).status_code == 409
    assert env.client.patch("/v1/admin/users/ahilespelid", headers=hb, json={"role": "user"}).status_code == 409


def test_email_and_role_change_logged(env):
    hb, _ = env.login("boss@example.com")
    env.client.patch("/v1/admin/users/griga", headers=hb, json={"email": "g2@example.com", "role": "admin"})
    kinds = [e["event"] for e in env.store.events]
    assert "email_changed" in kinds and "role_changed" in kinds
    assert env.store.get_user("griga")["email"] == "g2@example.com"


# ---------- команды vampn ----------
@pytest.mark.parametrize("sub,arg,expected", [
    ("status", "", ["status"]), ("server", "", ["server"]), ("list", "", ["list"]),
    ("link", "ivan", ["link", "ivan"]), ("reissue", "a.b-c_1", ["reissue", "a.b-c_1"]),
    ("rotate", "", ["rotate"]), ("rotate", "--force", ["rotate", "--force"]),
    ("reboot", "hard", ["reboot", "hard"]), ("emergency", "on", ["emergency", "on"]),
    ("keyconf", "ivan", ["keyconf", "ivan"]), ("resendall", "", ["resendall"]), ("mailstatus", "", ["mailstatus"]),
])
def test_allowed_commands(sub, arg, expected):
    assert build_argv(sub, arg) == expected


@pytest.mark.parametrize("sub,arg", [
    ("status", "x"), ("link", ""), ("link", "a b"), ("link", "a;rm"), ("link", "../x"), ("link", "$(id)"),
    ("rotate", "--evil"), ("reboot", "soft"), ("emergency", ""), ("emergency", "maybe"),
    ("mirror", ""), ("users", ""), ("sync", ""), ("bash", ""), ("", ""), ("mailtest", "a@b.ru"),
    ("resendall", "x"), ("mailstatus", "x"), ("keyconf", ""), ("keyconf", "a b"), ("keyconf", "$(id)"),
])
def test_forbidden_commands(sub, arg):
    with pytest.raises(BadRequest):
        build_argv(sub, arg)


def test_extract_link():
    assert extract_link("текст\n  vpn://abc \nещё") == "vpn://abc"
    with pytest.raises(CommandFailed):
        extract_link("нет ссылки")


# ---------- ключ-токен и QR, рассылка всем ----------
def test_key_link_returns_token_and_conf_for_qr(env):
    h, _ = env.login("griga@example.com")
    r = env.client.post("/v1/keys/griga/link", headers=h)
    assert r.status_code == 200
    assert r.json()["link"] == "vpn://TESTLINK" and r.json()["conf"].startswith("[Interface]")
    assert ("keyconf", "griga") in env.runner.calls


def test_key_link_survives_missing_conf(env):
    env.runner.fail.add("keyconf")
    h, _ = env.login("griga@example.com")
    r = env.client.post("/v1/keys/griga/link", headers=h)
    assert r.status_code == 200 and r.json()["link"] == "vpn://TESTLINK" and r.json()["conf"] is None


def test_user_cannot_resend_all_or_read_mail_status(env):
    h, _ = env.login("griga@example.com")
    assert env.client.post("/v1/admin/keys/resendall", headers=h).status_code == 403
    assert env.client.get("/v1/admin/mail-status", headers=h).status_code == 403
    assert ("resendall", "") not in env.runner.calls


def test_admin_resend_all_reports_summary(env):
    env.runner.outputs["resendall"] = "  a: принято почтовым сервером\nИТОГ: принято 3 из 3\n"
    h, _ = env.login("boss@example.com")
    r = env.client.post("/v1/admin/keys/resendall", headers=h)
    assert r.status_code == 200 and r.json() == {"ok": True, "summary": "ИТОГ: принято 3 из 3"}


def test_admin_resend_all_partial_failure_is_a_result_not_an_error(env):
    env.runner.outputs["resendall"] = "ИТОГ: принято 2 из 3, не ушло: b\n"
    env.runner.codes["resendall"] = 1
    h, _ = env.login("boss@example.com")
    r = env.client.post("/v1/admin/keys/resendall", headers=h)
    assert r.status_code == 200 and r.json()["ok"] is False and "не ушло: b" in r.json()["summary"]


def test_admin_mail_status(env):
    env.runner.outputs["mailstatus"] = "ИМЯ ПОЧТА\n"
    env.runner.codes["mailstatus"] = 1
    h, _ = env.login("boss@example.com")
    r = env.client.get("/v1/admin/mail-status", headers=h)
    assert r.status_code == 200 and r.json() == {"ok": False, "text": "ИМЯ ПОЧТА\n"}
