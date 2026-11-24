import os
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
sys.path.insert(0, os.path.dirname(__file__))

from fakes import Clock, FakeMailer, FakePush, FakeRunner, FakeStore  # noqa: E402
from vampn_api.config import Settings  # noqa: E402
from vampn_api.main import create_app  # noqa: E402


@pytest.fixture
def env():
    class E:
        pass
    e = E()
    e.clock, e.store, e.mailer, e.runner, e.push = Clock(), FakeStore(), FakeMailer(), FakeRunner(), FakePush()
    e.settings = Settings(secret="test-secret")
    e.store.add("ahilespelid", "boss@example.com", "admin")
    e.store.add("griga", "griga@example.com")
    e.store.add("mio", "shared@example.com")
    e.store.add("andrey", "shared@example.com")
    e.store.add("old", "old@example.com", active=False)
    e.app = create_app(e.settings, e.store, e.mailer, e.runner, e.push, e.clock)
    e.client = TestClient(e.app)

    def login(email="griga@example.com", device=None):
        e.client.post("/v1/auth/request", json={"email": email})
        body = {"email": email, "code": e.mailer.last_code(email)}
        if device:
            body["device"] = device
        r = e.client.post("/v1/auth/verify", json=body)
        assert r.status_code == 200, r.text
        return {"Authorization": "Bearer " + r.json()["token"]}, r.json()

    e.login = login
    return e
