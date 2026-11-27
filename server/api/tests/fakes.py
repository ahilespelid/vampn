"""Фейки для тестов: хранилище в памяти с тем же интерфейсом, что MySQLStore, почта, команды, push, часы."""
from datetime import datetime, timedelta

from vampn_api.commands import Result, build_argv
from vampn_api.store import NOTIF_FIELDS


class Clock:
    def __init__(self):
        self.t = datetime(2026, 11, 24, 12, 0, 0)

    def __call__(self):
        return self.t

    def advance(self, **kw):
        self.t += timedelta(**kw)


class FakeStore:
    def __init__(self):
        self.users, self.events, self.codes, self.locks = [], [], [], {}
        self.sessions, self.devices, self.keys, self.notifs, self.metrics = [], [], [], [], []
        self.key_stats, self.key_traffic, self.key_events = {}, [], []
        self._id = 0

    def _next(self):
        self._id += 1
        return self._id

    def add(self, name, email, role="user", active=True):
        u = dict(id=self._next(), name=name, email=email, role=role, active=1 if active else 0,
                 revoked_at=None, revoked_reason=None, created_at=datetime(2026, 1, 1))
        self.users.append(u)
        return u

    # пользователи
    def accounts_by_email(self, email):
        return [u for u in self.users if u["email"] == email and u["active"]]

    def get_user(self, name):
        return next((u for u in self.users if u["name"] == name), None)

    def get_user_by_id(self, uid):
        return next((u for u in self.users if u["id"] == uid), None)

    def list_users(self):
        return list(self.users)

    def create_user(self, name, email, role):
        return self.add(name, email, role)["id"]

    def restore_user(self, name, email):
        u = self.get_user(name)
        u.update(active=1, revoked_at=None, revoked_reason=None, email=email)

    def set_email(self, name, email):
        self.get_user(name)["email"] = email

    def set_role(self, name, role):
        self.get_user(name)["role"] = role

    def revoke_user(self, name, reason, now):
        self.get_user(name).update(active=0, revoked_at=now, revoked_reason=reason)

    def add_event(self, user_id, event, old, new, source):
        self.events.append(dict(id=self._next(), user_id=user_id, name=self.get_user_by_id(user_id)["name"], event=event,
                                old_value=old, new_value=new, source=source, created_at=datetime(2026, 11, 24)))

    def list_events(self, user_id=None, limit=100):
        return [e for e in reversed(self.events) if user_id is None or e["user_id"] == user_id][:limit]

    # коды
    def count_codes_since(self, email, since):
        return len([c for c in self.codes if c["email"] == email and c["created_at"] >= since])

    def insert_code(self, email, code_hash, expires_at, ip, now):
        c = dict(id=self._next(), email=email, code_hash=code_hash, attempts=0, expires_at=expires_at, used_at=None,
                 created_at=now)
        self.codes.append(c)
        return c["id"]

    def latest_active_code(self, email, now):
        rows = [c for c in self.codes if c["email"] == email and c["used_at"] is None and c["expires_at"] > now]
        return rows[-1] if rows else None

    def bump_attempt(self, code_id):
        c = next(c for c in self.codes if c["id"] == code_id)
        c["attempts"] += 1
        return c["attempts"]

    def mark_code_used(self, code_id, now):
        next(c for c in self.codes if c["id"] == code_id)["used_at"] = now

    # блокировки
    def get_lock(self, scope, now):
        r = self.locks.get(scope)
        return r["locked_until"] if r and r["locked_until"] and r["locked_until"] > now else None

    def lock(self, scope, until, now):
        self.locks[scope] = dict(fails=0, locked_until=until, updated_at=now)

    def add_fail(self, scope, now, limit, lock_seconds, window_seconds=3600):
        r = self.locks.get(scope)
        fails = r["fails"] if r and r["updated_at"] > now - timedelta(seconds=window_seconds) else 0
        fails += 1
        until = None
        if fails >= limit:
            until, fails = now + timedelta(seconds=lock_seconds), 0
        self.locks[scope] = dict(fails=fails, locked_until=until, updated_at=now)
        return until

    def clear_fails(self, scope):
        self.locks.pop(scope, None)

    # сессии и устройства
    def create_session(self, user_id, device_id, token_hash, expires_at, now):
        s = dict(session_id=self._next(), user_id=user_id, device_id=device_id, token_hash=token_hash,
                 expires_at=expires_at, revoked=False)
        self.sessions.append(s)
        return s["session_id"]

    def get_session(self, token_hash, now):
        return next((s for s in self.sessions if s["token_hash"] == token_hash and not s["revoked"] and s["expires_at"] > now), None)

    def revoke_session(self, token_hash, now):
        for s in self.sessions:
            if s["token_hash"] == token_hash:
                s["revoked"] = True

    def revoke_user_sessions(self, user_ids, now):
        for s in self.sessions:
            if s["user_id"] in user_ids:
                s["revoked"] = True

    def upsert_device(self, user_id, platform, name, push_token, now):
        d = next((d for d in self.devices if d["push_token"] == push_token), None)
        if d:
            d.update(user_id=user_id, platform=platform)
            return d["id"]
        d = dict(id=self._next(), user_id=user_id, platform=platform, push_token=push_token)
        self.devices.append(d)
        return d["id"]

    def devices_by_email(self, email):
        ids = {u["id"] for u in self.users if u["email"] == email}
        return [d for d in self.devices if d["user_id"] in ids]

    # ключи и уведомления
    def add_key(self, user_id, key_name, reason, issued_by, now):
        k = dict(id=self._next(), user_id=user_id, user_name=self.get_user_by_id(user_id)["name"], key_name=key_name,
                 reason=reason, issued_by=issued_by, issued_at=now)
        self.keys.append(k)
        return k["id"]

    def list_keys(self, user_ids, limit=100):
        rows = [k for k in reversed(self.keys) if user_ids is None or k["user_id"] in user_ids]
        return [{kk: v for kk, v in k.items() if kk != "user_id"} for k in rows][:limit]

    def add_notification(self, user_id, key_id, kind, title, now):
        n = dict(id=self._next(), user_id=user_id, user_name=self.get_user_by_id(user_id)["name"], key_id=key_id, kind=kind,
                 title=title, email_sent_at=None, push_sent_at=None, delivered_at=None, read_at=None, created_at=now)
        self.notifs.append(n)
        return n["id"]

    def list_notifications(self, user_ids, limit=100):
        return [{kk: v for kk, v in n.items() if kk != "user_id"} for n in reversed(self.notifs) if n["user_id"] in user_ids][:limit]

    def recent_key_notification(self, user_id, since):
        rows = [n for n in self.notifs if n["user_id"] == user_id and n["kind"] == "key" and n["created_at"] >= since]
        return {"id": rows[-1]["id"], "key_id": rows[-1]["key_id"]} if rows else None

    def notifications_signature(self, user_ids):
        rows = [n for n in list(self.notifs) if n["user_id"] in user_ids]
        return (len(rows), max((n["id"] for n in rows), default=0)) + tuple(
            len([n for n in rows if n[f]]) for f in NOTIF_FIELDS)

    def mark_notification(self, nid, user_ids, field, now):
        if field not in NOTIF_FIELDS:
            return False
        n = next((n for n in self.notifs if n["id"] == nid and n["user_id"] in user_ids), None)
        if not n:
            return False
        n[field] = n[field] or now
        return True

    def query_metrics(self, server, metric, since, limit=2000):
        return [m for m in self.metrics if m["server"] == server and m["metric"] == metric and m["ts"] >= since]

    # статистика по ключам: тесты кладут данные прямо в key_stats (имя -> строка), key_traffic и key_events (списки)
    def key_stats_list(self, names=None):
        return [dict(r) for n, r in sorted(self.key_stats.items()) if names is None or n in names]

    def key_traffic_sums(self, names, since):
        out = {}
        for t in self.key_traffic:
            if t["hour"] >= since and (names is None or t["key_name"] in names):
                up, down = out.get(t["key_name"], (0, 0))
                out[t["key_name"]] = (up + t["up_bytes"], down + t["down_bytes"])
        return out

    def key_traffic_daily(self, name, since):
        days = {}
        for t in self.key_traffic:
            if t["key_name"] == name and t["hour"] >= since:
                up, down = days.get(t["hour"].date(), (0, 0))
                days[t["hour"].date()] = (up + t["up_bytes"], down + t["down_bytes"])
        return [dict(day=d, up=u, down=w) for d, (u, w) in sorted(days.items())]

    def key_client_ips(self, name, limit=20):
        ips = {}
        for e in self.key_events:
            if e["key_name"] == name and e["kind"] in ("connect", "client_ip") and e["new_value"] is not None:
                n, last = ips.get(e["new_value"], (0, e["ts"]))
                ips[e["new_value"]] = (n + (1 if e["kind"] == "connect" else 0), max(last, e["ts"]))
        rows = [dict(ip=ip, connects=n, last_at=last) for ip, (n, last) in ips.items()]
        return sorted(rows, key=lambda r: r["last_at"], reverse=True)[:limit]

    def key_events_list(self, name, limit=50):
        rows = [e for e in self.key_events if e["key_name"] in (name, None)]
        return sorted(rows, key=lambda e: (e["ts"], e["id"]), reverse=True)[:limit]


class FakeMailer:
    def __init__(self):
        self.sent = []

    def send_code(self, email, code, ttl_minutes):
        self.sent.append((email, code))
        return True

    def last_code(self, email):
        return [c for e, c in self.sent if e == email][-1]


class FakeRunner:
    def __init__(self):
        self.calls = []
        self.outputs = {"link": "vpn://TESTLINK", "keyconf": "[Interface]\nPrivateKey = TEST\n",
                        "cells": "ЯЧЕЙКА\tИМЯ\tIP\tПОЛЬЗОВАТЕЛЕЙ\tЛИМИТ\tРУКОПОЖАТИЕ\tСОСТОЯНИЕ\n1\tvampn\t82.97.246.204\t18\t1000\t89s\tактивна\n2\tvampn_2\t203.0.113.9\t0\t1000\t-\tошибка\n",
                        "account-list": "main\tok\t5081.8\tRUB\t1\t\nspare\tdenied\t\t\t0\tUnauthorized\n",
                        "spawnstatus": "состояние: running: создание сервера vampn_3\n2026-11-27 11:00:01 ячейка 3\n2026-11-27 11:00:05 создание сервера vampn_3\n"}
        self.codes = {}
        self.fail = set()  # подкоманды, которые должны упасть
        self.stdins = []   # (подкоманда, stdin): секреты не попадают в calls

    def run_ok(self, sub, arg="", stdin=""):
        build_argv(sub, arg)  # те же проверки, что в бою
        self.calls.append((sub, arg))
        if stdin:
            self.stdins.append((sub, stdin))
        if sub in self.fail:
            from vampn_api.errors import CommandFailed
            raise CommandFailed("тестовый сбой " + sub)
        return self.outputs.get(sub, "ok " + sub)

    def run(self, sub, arg="", timeout=0, stdin=""):
        return Result(self.codes.get(sub, 0), self.run_ok(sub, arg, stdin), "")


class FakePush:
    def __init__(self, delivered=1):
        self.sent, self.delivered = [], delivered

    def send(self, devices, title, body=""):
        self.sent.append((len(devices), title))
        return self.delivered if devices else 0
