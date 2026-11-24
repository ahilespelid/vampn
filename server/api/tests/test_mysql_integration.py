"""Интеграционный тест на настоящей MySQL-совместимой базе. Запуск:
VAMPN_TEST_DB=127.0.0.1:3399:vampn:testpw:vampn_test pytest tests/test_mysql_integration.py
Без переменной тест пропускается. База должна быть пустой тестовой (таблицы очищаются!)."""
import os

import pymysql
import pytest
from fastapi.testclient import TestClient

from fakes import FakeMailer, FakePush, FakeRunner
from vampn_api.config import Settings
from vampn_api.main import create_app
from vampn_api.store import MySQLStore

DSN = os.environ.get("VAMPN_TEST_DB")
pytestmark = pytest.mark.skipif(not DSN, reason="VAMPN_TEST_DB не задана")


@pytest.fixture
def db():
    host, port, user, pw, name = DSN.split(":")
    s = Settings(db_host=host, db_port=int(port), db_user=user, db_password=pw, db_name=name, secret="itest")
    conn = pymysql.connect(host=host, port=int(port), user=user, password=pw, database=name, autocommit=True)
    cur = conn.cursor()
    cur.execute("SET FOREIGN_KEY_CHECKS=0")
    for t in ("user_events", "notifications", "`keys`", "sessions", "devices", "login_codes", "login_attempts", "metrics", "users"):
        cur.execute("TRUNCATE TABLE " + t)
    cur.execute("SET FOREIGN_KEY_CHECKS=1")
    for n, e, r in (("ahilespelid", "boss@example.com", "admin"), ("griga", "griga@example.com", "user"),
                    ("mio", "shared@example.com", "user"), ("andrey", "shared@example.com", "user")):
        cur.execute("INSERT INTO users (name,email,role) VALUES (%s,%s,%s)", (n, e, r))
    mailer, runner, push = FakeMailer(), FakeRunner(), FakePush()
    app = create_app(s, MySQLStore(s), mailer, runner, push)
    c = TestClient(app)

    def login(email, device=None):
        c.post("/v1/auth/request", json={"email": email})
        body = {"email": email, "code": mailer.last_code(email)}
        if device:
            body["device"] = device
        r = c.post("/v1/auth/verify", json=body)
        assert r.status_code == 200, r.text
        return {"Authorization": "Bearer " + r.json()["token"]}, r.json()

    yield c, cur, login, mailer, runner, push
    conn.close()


def test_full_flow_on_real_database(db):
    c, cur, login, mailer, runner, push = db
    hg, body = login("griga@example.com", {"platform": "android", "name": "Pixel", "push_token": "tok-real-1"})
    assert body["user"]["accounts"] == [{"name": "griga", "role": "user"}]
    assert c.get("/v1/me", headers=hg).json()["email"] == "griga@example.com"

    # повторный вход с тем же push_token не создаёт второе устройство
    login("griga@example.com", {"platform": "android", "name": "Pixel", "push_token": "tok-real-1"})
    cur.execute("SELECT COUNT(*) FROM devices")
    assert cur.fetchone()[0] == 1

    r = c.post("/v1/keys/griga/reissue", headers=hg)
    assert r.status_code == 200
    nid = r.json()["notification_id"]
    notes = c.get("/v1/notifications", headers=hg).json()["notifications"]
    assert notes[0]["email_sent_at"] and notes[0]["push_sent_at"] and notes[0]["read_at"] is None
    assert c.post("/v1/notifications/%d/read" % nid, headers=hg).status_code == 200
    assert c.post("/v1/notifications/%d/read" % nid, headers=hg).status_code == 200  # повтор не ломается
    notes = c.get("/v1/notifications", headers=hg).json()["notifications"]
    assert notes[0]["read_at"] and notes[0]["delivered_at"]
    assert len(c.get("/v1/keys", headers=hg).json()["keys"]) == 1

    hs, sbody = login("shared@example.com")
    assert sorted(a["name"] for a in sbody["user"]["accounts"]) == ["andrey", "mio"]
    assert c.get("/v1/notifications", headers=hs).json()["notifications"] == []


def test_admin_flow_and_soft_revoke_on_real_database(db):
    c, cur, login, *_ = db
    hb, _ = login("boss@example.com")
    assert c.post("/v1/admin/users", headers=hb, json={"name": "newbie", "email": "new@example.com"}).status_code == 200
    users = {u["name"]: u for u in c.get("/v1/admin/users", headers=hb).json()["users"]}
    assert users["newbie"]["active"] is True and users["newbie"]["role"] == "user"

    hg, _ = login("griga@example.com")
    assert c.patch("/v1/admin/users/griga", headers=hb, json={"active": False}).status_code == 200
    assert c.get("/v1/me", headers=hg).status_code == 401
    cur.execute("SELECT active, revoked_at IS NOT NULL, revoked_reason FROM users WHERE name='griga'")
    assert cur.fetchone() == (0, 1, "revoked_in_app")
    cur.execute("SELECT COUNT(*) FROM users WHERE name='griga'")
    assert cur.fetchone()[0] == 1  # запись остаётся

    assert c.post("/v1/admin/users", headers=hb, json={"name": "griga", "email": "griga@example.com"}).status_code == 200
    events = [e["event"] for e in c.get("/v1/admin/events?name=griga", headers=hb).json()["events"]]
    assert events == ["restored", "revoked"]


def test_lockout_persists_in_database(db):
    c, cur, login, mailer, *_ = db
    c.post("/v1/auth/request", json={"email": "griga@example.com"})
    real = mailer.last_code("griga@example.com")
    wrong = "0000" if real != "0000" else "1111"
    codes = [c.post("/v1/auth/verify", json={"email": "griga@example.com", "code": wrong}).status_code for _ in range(6)]
    assert codes == [401, 401, 401, 401, 401, 429]
    assert c.post("/v1/auth/verify", json={"email": "griga@example.com", "code": real}).status_code == 429
    cur.execute("SELECT locked_until > UTC_TIMESTAMP() FROM login_attempts WHERE scope_key='email:griga@example.com'")
    assert cur.fetchone()[0] == 1
