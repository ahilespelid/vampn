import pytest

from vampn_api import cells
from vampn_api.commands import VampnRunner, build_argv
from vampn_api.errors import BadRequest

TOKEN = "eyJ0b2tlbiI6InNlY3JldC10aW1ld2ViLTEyMzQ1Njc4OTAifQ.abc-DEF_123"


# ---------- разрешённые и запрещённые команды ----------
@pytest.mark.parametrize("sub,arg,expected", [
    ("cells", "", ["cells"]), ("spawnstatus", "", ["spawnstatus", "40"]),
    ("spawn", "", ["spawn"]), ("spawn", "second", ["spawn", "second"]), ("spawn", "acc-2_x", ["spawn", "acc-2_x"]),
    ("account-list", "", ["account", "list", "--tsv"]), ("account-add", "second", ["account", "add", "second"]),
    ("account-default", "second", ["account", "default", "second"]), ("account-del", "second", ["account", "del", "second"]),
    ("celldel", "2", ["celldel", "2", "--yes"]), ("celldel", "30", ["celldel", "30", "--yes"]),
])
def test_cell_commands_allowed(sub, arg, expected):
    assert build_argv(sub, arg) == expected


@pytest.mark.parametrize("sub,arg", [
    ("cells", "x"), ("spawnstatus", "5"), ("spawn", "A b"), ("spawn", "x;id"), ("spawn", "$(id)"), ("spawn", "--force"), ("spawn", "a" * 25),
    ("account-list", "x"), ("account-add", ""), ("account-add", "Bad Name"), ("account-add", "x y"), ("account-del", "../x"), ("account-default", ""),
    ("celldel", ""), ("celldel", "1"), ("celldel", "0"), ("celldel", "31"), ("celldel", "02"), ("celldel", "2 --force"),
    ("celldel", "-2"), ("celldel", "2;id"), ("celldel", "२"),
    ("account", "list"), ("spawnrun", "main"), ("installscript", ""),
])
def test_cell_commands_forbidden(sub, arg):
    with pytest.raises(BadRequest):
        build_argv(sub, arg)


def test_cell_del_never_gets_force():
    for n in range(2, 31):
        argv = build_argv("celldel", str(n))
        assert argv == ["celldel", str(n), "--yes"] and "--force" not in argv


# ---------- токен идёт только в stdin ----------
def test_runner_passes_token_through_stdin_not_argv(monkeypatch):
    seen = {}

    class P:
        returncode, stdout, stderr = 0, "ok", ""

    def fake_run(cmd, **kw):
        seen["cmd"], seen["kw"] = cmd, kw
        return P()

    monkeypatch.setattr("vampn_api.commands.subprocess.run", fake_run)
    VampnRunner("/usr/local/sbin/vampn").run("account-add", "second", stdin=TOKEN + "\n")
    assert TOKEN not in " ".join(seen["cmd"]) and seen["kw"]["input"] == TOKEN + "\n"
    assert seen["cmd"][:3] == ["sudo", "-n", "/usr/local/sbin/vampn"] and seen["cmd"][3:] == ["account", "add", "second"]
    VampnRunner("/usr/local/sbin/vampn").run("cells")
    assert "input" not in seen["kw"] and seen["kw"]["stdin"] is not None


# ---------- разбор вывода ----------
def test_parse_cells_handles_missing_values():
    rows = cells.parse_cells("ЯЧЕЙКА\tИМЯ\tIP\tПОЛЬЗОВАТЕЛЕЙ\tЛИМИТ\tРУКОПОЖАТИЕ\tСОСТОЯНИЕ\n1\tvampn\t1.2.3.4\t18\t1000\t89s\tактивна\n2\tvampn_2\t-\t0\t1000\t-\tсоздаётся\nмусор\n")
    assert rows == [
        {"cell": 1, "name": "vampn", "ip": "1.2.3.4", "users": 18, "limit": 1000, "handshake": "89s", "state": "активна"},
        {"cell": 2, "name": "vampn_2", "ip": None, "users": 0, "limit": 1000, "handshake": None, "state": "создаётся"}]


def test_parse_accounts():
    rows = cells.parse_accounts("main\tok\t5081.8\tRUB\t1\t\nspare\tdenied\t\t\t0\tUnauthorized\nx\tnone\t\t\t0\t\nBAD NAME\tok\t1\tRUB\t0\t\n")
    assert [r["name"] for r in rows] == ["main", "spare", "x"]
    assert rows[0] == {"name": "main", "status": "ok", "balance": 5081.8, "currency": "RUB", "default": True, "message": None}
    assert rows[1]["status"] == "denied" and rows[1]["message"] == "Unauthorized" and rows[1]["balance"] is None


@pytest.mark.parametrize("out,state", [
    ("состояние: queued: старт\n", "queued"), ("состояние: running: ждём IP\n2026 x\n", "running"),
    ("состояние: done: ячейка 2 (vampn_2) 1.2.3.4\n", "done"), ("состояние: failed: шаг: причина\n", "failed"),
    ("состояние: нет запусков\n", "none"), ("", "none"),
])
def test_parse_spawn_state(out, state):
    assert cells.parse_spawn(out)["state"] == state


# ---------- роли ----------
ADMIN_ONLY = [
    ("get", "/v1/admin/cells", None), ("get", "/v1/admin/timeweb/accounts", None),
    ("post", "/v1/admin/timeweb/accounts", {"name": "second", "token": TOKEN}),
    ("post", "/v1/admin/timeweb/accounts/second/default", None), ("delete", "/v1/admin/timeweb/accounts/second", None),
    ("post", "/v1/admin/spawn", {}), ("get", "/v1/admin/spawn", None), ("post", "/v1/admin/cells/2/delete", {"confirm": True}),
]


@pytest.mark.parametrize("method,path,body", ADMIN_ONLY)
def test_ordinary_user_and_anonymous_are_refused(env, method, path, body):
    h, _ = env.login("griga@example.com")
    kw = {"json": body} if body is not None else {}
    assert getattr(env.client, method)(path, headers=h, **kw).status_code == 403
    assert getattr(env.client, method)(path, **kw).status_code == 401
    assert env.runner.calls == [] and env.runner.stdins == []


# ---------- точки API ----------
def test_admin_sees_cells_and_accounts(env):
    h, _ = env.login("boss@example.com")
    c = env.client.get("/v1/admin/cells", headers=h).json()["cells"]
    assert [x["cell"] for x in c] == [1, 2] and c[0]["users"] == 18 and c[1]["state"] == "ошибка"
    a = env.client.get("/v1/admin/timeweb/accounts", headers=h).json()["accounts"]
    assert a[0]["name"] == "main" and a[0]["default"] is True and a[1]["status"] == "denied"
    assert "token" not in str(a).lower()


def test_account_add_sends_token_only_via_stdin_and_never_echoes_it(env):
    h, _ = env.login("boss@example.com")
    r = env.client.post("/v1/admin/timeweb/accounts", headers=h, json={"name": "second", "token": "  " + TOKEN + " "})
    assert r.status_code == 200 and TOKEN not in r.text
    assert env.runner.calls == [("account-add", "second")] and env.runner.stdins == [("account-add", TOKEN + "\n")]
    assert TOKEN not in str(env.runner.calls)


@pytest.mark.parametrize("body", [
    {"name": "main", "token": TOKEN}, {"name": "spare", "token": TOKEN}, {"name": "Bad Name", "token": TOKEN}, {"name": "", "token": TOKEN},
    {"name": "x" * 25, "token": TOKEN}, {"name": "second", "token": "short"}, {"name": "second", "token": "has space in it " * 3},
    {"name": "second", "token": "a;rm -rf /" * 4}, {"name": "second"}, {"token": TOKEN},
])
def test_account_add_validates_input(env, body):
    h, _ = env.login("boss@example.com")
    assert env.client.post("/v1/admin/timeweb/accounts", headers=h, json=body).status_code in (400, 422)
    assert env.runner.calls == []


def test_account_add_error_text_does_not_contain_token(env):
    h, _ = env.login("boss@example.com")
    env.runner.fail.add("account-add")
    r = env.client.post("/v1/admin/timeweb/accounts", headers=h, json={"name": "second", "token": TOKEN})
    assert r.status_code == 502 and TOKEN not in r.text


def test_account_default_and_delete(env):
    h, _ = env.login("boss@example.com")
    assert env.client.post("/v1/admin/timeweb/accounts/second/default", headers=h).status_code == 200
    assert env.client.delete("/v1/admin/timeweb/accounts/second", headers=h).status_code == 200
    assert env.client.delete("/v1/admin/timeweb/accounts/main", headers=h).status_code == 400
    assert env.client.delete("/v1/admin/timeweb/accounts/spare", headers=h).status_code == 400
    assert env.client.post("/v1/admin/timeweb/accounts/BAD/default", headers=h).status_code == 400
    assert env.runner.calls == [("account-default", "second"), ("account-del", "second")]


def test_spawn_starts_in_background_and_reports_progress(env):
    h, _ = env.login("boss@example.com")
    assert env.client.post("/v1/admin/spawn", headers=h, json={}).status_code == 200
    assert env.client.post("/v1/admin/spawn", headers=h, json={"account": "second"}).status_code == 200
    assert env.runner.calls == [("spawn", ""), ("spawn", "second")]
    s = env.client.get("/v1/admin/spawn", headers=h).json()
    assert s["state"] == "running" and "vampn_3" in s["detail"] and len(s["log"]) == 2


def test_spawn_rejects_bad_account_and_surfaces_vampn_refusal(env):
    h, _ = env.login("boss@example.com")
    for acct in ("A B", "x;id", "a" * 25, "$(id)"):
        assert env.client.post("/v1/admin/spawn", headers=h, json={"account": acct}).status_code in (400, 422)
    assert env.runner.calls == []
    env.runner.fail.add("spawn")  # например «аренда уже идёт»
    assert env.client.post("/v1/admin/spawn", headers=h, json={}).status_code == 502


def test_cell_delete_needs_confirmation_and_valid_number(env):
    h, _ = env.login("boss@example.com")
    assert env.client.post("/v1/admin/cells/2/delete", headers=h, json={}).status_code == 400
    assert env.client.post("/v1/admin/cells/2/delete", headers=h, json={"confirm": False}).status_code == 400
    for n in (1, 0, 31, -3):
        assert env.client.post("/v1/admin/cells/%d/delete" % n, headers=h, json={"confirm": True}).status_code == 400
    assert env.client.post("/v1/admin/cells/x/delete", headers=h, json={"confirm": True}).status_code == 422
    assert env.runner.calls == []
    assert env.client.post("/v1/admin/cells/2/delete", headers=h, json={"confirm": True}).status_code == 200
    assert env.runner.calls == [("celldel", "2")]


def test_token_is_not_written_to_the_log(env, caplog):
    import logging
    h, _ = env.login("boss@example.com")
    with caplog.at_level(logging.DEBUG):
        env.client.post("/v1/admin/timeweb/accounts", headers=h, json={"name": "second", "token": TOKEN})
        env.client.post("/v1/admin/spawn", headers=h, json={"account": "second"})
    assert TOKEN not in caplog.text and "SPAWN" in caplog.text
