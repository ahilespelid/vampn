"""Вход по коду на почту: лимиты, блокировки, сессии. Логика не зависит от конкретной базы (см. store.py)."""
import logging
from dataclasses import dataclass
from datetime import timedelta

from . import security
from .errors import InvalidCode, Locked, Unauthorized

log = logging.getLogger("vampn_api.auth")


@dataclass
class Principal:
    session_id: int
    user_id: int
    email: str
    accounts: list  # активные учётки с этой почтой: dict(id,name,email,role)
    token: str = ""

    @property
    def is_admin(self) -> bool:
        return any(a["role"] == "admin" for a in self.accounts)

    @property
    def names(self) -> list:
        return [a["name"] for a in self.accounts]

    @property
    def ids(self) -> list:
        return [a["id"] for a in self.accounts]

    @property
    def role(self) -> str:
        return "admin" if self.is_admin else "user"


class AuthService:
    def __init__(self, store, mailer, settings, now_fn, on_lockout=None):
        self.store, self.mailer, self.s, self.now = store, mailer, settings, now_fn
        self.on_lockout = on_lockout or (lambda email, ip: log.warning("блокировка входа: %s / %s", email, ip))

    # ---------- блокировки ----------
    def _check_locks(self, email, ip):
        now = self.now()
        for scope in ("email:" + email, "ip:" + ip):
            until = self.store.get_lock(scope, now)
            if until:
                raise Locked("слишком много попыток, повторите позже", retry_after=int((until - now).total_seconds()))

    # ---------- запрос кода ----------
    def request_code(self, email_raw: str, ip: str) -> None:
        """Ответ одинаков для известной и неизвестной почты: код создаётся всегда, письмо уходит только известной."""
        email = security.normalize_email(email_raw)
        if not security.valid_email(email):
            return
        self._check_locks(email, ip)
        now = self.now()
        if self.store.count_codes_since(email, now - timedelta(hours=1)) >= self.s.codes_per_hour:
            raise Locked("слишком много запросов кода, повторите позже", retry_after=3600)
        known = bool(self.store.accounts_by_email(email))
        code = security.new_code()
        self.store.insert_code(email, security.hash_code(self.s.secret, email, code),
                               now + timedelta(seconds=self.s.code_ttl_seconds), ip, now)
        if known:
            self.mailer.send_code(email, code, self.s.code_ttl_seconds // 60)

    # ---------- проверка кода ----------
    def verify_code(self, email_raw: str, code: str, ip: str, device=None):
        email = security.normalize_email(email_raw)
        code = (code or "").strip()
        self._check_locks(email, ip)
        now = self.now()
        row = self.store.latest_active_code(email, now)
        accounts = self.store.accounts_by_email(email) if row else []
        if not row or not accounts:
            self._ip_fail(email, ip)
            raise InvalidCode("неверный или просроченный код", attempts_left=0)
        attempts = self.store.bump_attempt(row["id"])
        left = max(self.s.code_max_attempts - attempts, 0)
        if not (code.isdigit() and len(code) == 4 and security.check_code(self.s.secret, email, code, row["code_hash"])):
            self._ip_fail(email, ip)
            if attempts >= self.s.code_max_attempts:
                self.store.mark_code_used(row["id"], now)
                self.store.lock("email:" + email, now + timedelta(seconds=self.s.lock_seconds), now)
                self.on_lockout(email, ip)
                raise Locked("слишком много попыток, повторите позже", retry_after=self.s.lock_seconds)
            raise InvalidCode("неверный код", attempts_left=left)
        self.store.mark_code_used(row["id"], now)
        self.store.clear_fails("email:" + email)
        primary = accounts[0]
        device_id = None
        if device and device.get("push_token"):
            device_id = self.store.upsert_device(primary["id"], device.get("platform") or "android",
                                                 device.get("name"), device["push_token"], now)
        token = security.new_token()
        expires = now + timedelta(days=self.s.session_days)
        self.store.create_session(primary["id"], device_id, security.hash_token(token), expires, now)
        return token, expires, accounts

    def _ip_fail(self, email, ip):
        until = self.store.add_fail("ip:" + ip, self.now(), self.s.ip_fail_limit, self.s.lock_seconds)
        if until:
            self.on_lockout("(ip)", ip)

    # ---------- сессия ----------
    def authenticate(self, token: str) -> Principal:
        if not token:
            raise Unauthorized("нужен вход")
        now = self.now()
        sess = self.store.get_session(security.hash_token(token), now)
        if not sess:
            raise Unauthorized("сессия недействительна")
        user = self.store.get_user_by_id(sess["user_id"])
        if not user or not user["active"]:
            raise Unauthorized("доступ отозван")
        accounts = self.store.accounts_by_email(user["email"])
        if not accounts:
            raise Unauthorized("доступ отозван")
        return Principal(sess["session_id"], user["id"], user["email"], accounts)

    def logout(self, token: str) -> None:
        self.store.revoke_session(security.hash_token(token), self.now())
