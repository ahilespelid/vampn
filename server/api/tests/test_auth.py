def test_unknown_email_gets_same_answer_and_no_mail(env):
    r = env.client.post("/v1/auth/request", json={"email": "nobody@example.com"})
    assert r.status_code == 200 and r.json() == {"ok": True}
    assert env.mailer.sent == []


def test_known_email_gets_four_digit_code(env):
    r = env.client.post("/v1/auth/request", json={"email": "Griga@Example.com "})
    assert r.status_code == 200
    (email, code), = env.mailer.sent
    assert email == "griga@example.com" and len(code) == 4 and code.isdigit()


def test_login_flow_and_me(env):
    h, body = env.login("griga@example.com")
    assert body["user"]["role"] == "user" and body["user"]["accounts"] == [{"name": "griga", "role": "user"}]
    r = env.client.get("/v1/me", headers=h)
    assert r.status_code == 200 and r.json()["role"] == "user"


def test_code_is_single_use(env):
    env.client.post("/v1/auth/request", json={"email": "griga@example.com"})
    code = env.mailer.last_code("griga@example.com")
    assert env.client.post("/v1/auth/verify", json={"email": "griga@example.com", "code": code}).status_code == 200
    r = env.client.post("/v1/auth/verify", json={"email": "griga@example.com", "code": code})
    assert r.status_code == 401


def test_code_expires_after_10_minutes(env):
    env.client.post("/v1/auth/request", json={"email": "griga@example.com"})
    code = env.mailer.last_code("griga@example.com")
    env.clock.advance(minutes=10, seconds=1)
    assert env.client.post("/v1/auth/verify", json={"email": "griga@example.com", "code": code}).status_code == 401


def test_wrong_code_counts_attempts_then_locks_for_an_hour(env):
    env.client.post("/v1/auth/request", json={"email": "griga@example.com"})
    real = env.mailer.last_code("griga@example.com")
    wrong = "0000" if real != "0000" else "1111"
    for left in (5, 4, 3, 2, 1):
        r = env.client.post("/v1/auth/verify", json={"email": "griga@example.com", "code": wrong})
        assert r.status_code == 401 and r.json()["attempts_left"] == left
    r = env.client.post("/v1/auth/verify", json={"email": "griga@example.com", "code": wrong})
    assert r.status_code == 429 and int(r.headers["Retry-After"]) == 3600
    # даже верный код и новый запрос во время блокировки не проходят
    assert env.client.post("/v1/auth/verify", json={"email": "griga@example.com", "code": real}).status_code == 429
    assert env.client.post("/v1/auth/request", json={"email": "griga@example.com"}).status_code == 429
    env.clock.advance(hours=1, seconds=1)
    assert env.client.post("/v1/auth/request", json={"email": "griga@example.com"}).status_code == 200


def test_at_most_three_codes_per_hour(env):
    for _ in range(3):
        assert env.client.post("/v1/auth/request", json={"email": "griga@example.com"}).status_code == 200
    assert env.client.post("/v1/auth/request", json={"email": "griga@example.com"}).status_code == 429
    env.clock.advance(hours=1, seconds=1)
    assert env.client.post("/v1/auth/request", json={"email": "griga@example.com"}).status_code == 200


def test_limit_applies_to_unknown_email_too(env):
    codes = [env.client.post("/v1/auth/request", json={"email": "ghost@example.com"}).status_code for _ in range(4)]
    assert codes == [200, 200, 200, 429]  # нельзя отличить известную почту по лимиту


def test_revoked_user_cannot_login_and_session_dies(env):
    h, _ = env.login("griga@example.com")
    env.store.revoke_user("griga", "x", env.clock())
    assert env.client.get("/v1/me", headers=h).status_code == 401
    env.client.post("/v1/auth/request", json={"email": "griga@example.com"})
    assert env.mailer.sent[-1][0] != "griga@example.com" or len(env.mailer.sent) == 1


def test_logout_kills_session(env):
    h, _ = env.login()
    assert env.client.post("/v1/auth/logout", headers=h).status_code == 200
    assert env.client.get("/v1/me", headers=h).status_code == 401


def test_session_expires(env):
    h, _ = env.login()
    env.clock.advance(days=31)
    assert env.client.get("/v1/me", headers=h).status_code == 401


def test_no_token_is_unauthorized(env):
    assert env.client.get("/v1/me").status_code == 401
    assert env.client.get("/v1/me", headers={"Authorization": "Bearer junk"}).status_code == 401


def test_shared_email_gets_both_accounts(env):
    h, body = env.login("shared@example.com")
    assert sorted(a["name"] for a in body["user"]["accounts"]) == ["andrey", "mio"]


def test_device_registered_on_login(env):
    env.login("griga@example.com", {"platform": "ios", "name": "iPhone", "push_token": "tok-1"})
    assert [d["push_token"] for d in env.store.devices] == ["tok-1"]
