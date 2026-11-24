import logging
from datetime import timedelta
from typing import Optional

from fastapi import Depends, FastAPI, Header, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from . import commands, security
from .auth_service import AuthService, Principal
from .config import Settings, load_settings
from .errors import ApiError, BadRequest, Conflict, Forbidden, NotFound
from .mailer import NullPush, SmtpMailer
from .store import MySQLStore, utcnow
from .stream import notification_stream

log = logging.getLogger("vampn_api")


class RequestCode(BaseModel):
    email: str = Field(max_length=255)


class Device(BaseModel):
    platform: str = Field(default="android", pattern="^(android|ios)$")
    name: Optional[str] = Field(default=None, max_length=128)
    push_token: Optional[str] = Field(default=None, max_length=512)


class VerifyCode(BaseModel):
    email: str = Field(max_length=255)
    code: str = Field(max_length=8)
    device: Optional[Device] = None


class NewUser(BaseModel):
    name: str
    email: str
    role: str = Field(default="user", pattern="^(admin|user)$")


class UserPatch(BaseModel):
    email: Optional[str] = None
    role: Optional[str] = Field(default=None, pattern="^(admin|user)$")
    active: Optional[bool] = None


class RotateBody(BaseModel):
    force: bool = False


class RebootBody(BaseModel):
    hard: bool = False


class EmergencyBody(BaseModel):
    mode: str = Field(pattern="^(on|off|status)$")


def client_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for")
    if xff:  # за Caddy на этом же хосте: доверяем последнему значению (его добавил прокси)
        return xff.split(",")[-1].strip()[:45] or "unknown"
    return (request.client.host if request.client else "unknown")[:45]


def create_app(settings: Optional[Settings] = None, store=None, mailer=None, runner=None, push=None, now_fn=utcnow) -> FastAPI:
    s = settings or load_settings()
    store = store or MySQLStore(s)
    mailer = mailer or SmtpMailer(s)
    runner = runner or commands.VampnRunner(s.vampn_bin, s.command_timeout, s.use_sudo)
    push = push or NullPush()
    auth = AuthService(store, mailer, s, now_fn)
    app = FastAPI(title="vampn API", version="1.0", docs_url=None, redoc_url=None, openapi_url=None)

    @app.exception_handler(ApiError)
    async def api_error(_req, exc: ApiError):
        body = {"error": exc.code, "message": exc.message}
        body.update(exc.extra)
        headers = {"Retry-After": str(exc.extra["retry_after"])} if "retry_after" in exc.extra else None
        return JSONResponse(body, status_code=exc.status, headers=headers)

    def current(authorization: Optional[str] = Header(default=None)) -> Principal:
        token = authorization[7:].strip() if authorization and authorization.lower().startswith("bearer ") else ""
        p = auth.authenticate(token)
        p.token = token
        return p

    def admin(p: Principal = Depends(current)) -> Principal:
        if not p.is_admin:
            raise Forbidden("только для суперадмина")
        return p

    def account_for(p: Principal, name: str) -> dict:
        """Учётка, ключом которой можно управлять: своя (по почте) или любая для админа."""
        if not security.valid_name(name):
            raise BadRequest("плохое имя")
        for a in p.accounts:
            if a["name"] == name:
                return a
        if p.is_admin:
            u = store.get_user(name)
            if u and u["active"]:
                return u
        raise NotFound("нет такого пользователя")

    def public_account(a):
        return {"name": a["name"], "role": a["role"]}

    # ---------- служебное ----------
    @app.get("/health")
    def health():
        return {"ok": True}

    # ---------- вход ----------
    @app.post("/v1/auth/request")
    def auth_request(body: RequestCode, request: Request):
        auth.request_code(body.email, client_ip(request))
        return {"ok": True}  # одинаково для любой почты

    @app.post("/v1/auth/verify")
    def auth_verify(body: VerifyCode, request: Request):
        dev = body.device.model_dump() if body.device else None
        token, expires, accounts = auth.verify_code(body.email, body.code, client_ip(request), dev)
        role = "admin" if any(a["role"] == "admin" for a in accounts) else "user"
        return {"token": token, "expires_at": expires.isoformat() + "Z",
                "user": {"email": security.normalize_email(body.email), "role": role,
                         "accounts": [public_account(a) for a in accounts]}}

    @app.post("/v1/auth/logout")
    def auth_logout(p: Principal = Depends(current)):
        auth.logout(p.token)
        return {"ok": True}

    @app.get("/v1/me")
    def me(p: Principal = Depends(current)):
        return {"email": p.email, "role": p.role, "accounts": [public_account(a) for a in p.accounts]}

    @app.post("/v1/devices")
    def register_device(body: Device, p: Principal = Depends(current)):
        if not body.push_token:
            raise BadRequest("нужен push_token")
        did = store.upsert_device(p.user_id, body.platform, body.name, body.push_token, now_fn())
        return {"id": did}

    # ---------- статус и управление службой (доступно всем вошедшим) ----------
    @app.get("/v1/status")
    def status(_p: Principal = Depends(current)):
        return {"text": runner.run_ok("status")}

    @app.get("/v1/server")
    def server(_p: Principal = Depends(current)):
        return {"text": runner.run_ok("server")}

    @app.post("/v1/control/rotate")
    def rotate(body: RotateBody, p: Principal = Depends(current)):
        if body.force and not p.is_admin:
            raise Forbidden("--force только для суперадмина")
        log.info("rotate force=%s by %s", body.force, p.email)
        return {"text": runner.run_ok("rotate", "--force" if body.force else "")}

    @app.post("/v1/control/reboot")
    def reboot(body: RebootBody, p: Principal = Depends(current)):
        log.info("reboot hard=%s by %s", body.hard, p.email)
        return {"text": runner.run_ok("reboot", "hard" if body.hard else "")}

    @app.post("/v1/control/emergency")
    def emergency(body: EmergencyBody, p: Principal = Depends(current)):
        if body.mode != "status" and not p.is_admin:
            raise Forbidden("только для суперадмина")
        log.info("emergency %s by %s", body.mode, p.email)
        return {"text": runner.run_ok("emergency", body.mode)}

    @app.get("/v1/stats")
    def stats(metric: str = "users_online", hours: int = 24, server: str = "vpn", _p: Principal = Depends(current)):
        if not security.valid_name(metric) or not security.valid_name(server):
            raise BadRequest("плохие параметры")
        since = now_fn() - timedelta(hours=max(1, min(hours, 24 * 31)))
        rows = store.query_metrics(server, metric, since)
        return {"metric": metric, "points": [{"ts": r["ts"].isoformat() + "Z", "value": r["value"]} for r in rows]}

    # ---------- ключи ----------
    @app.get("/v1/keys")
    def keys(p: Principal = Depends(current), all: bool = False):
        ids = None if (all and p.is_admin) else p.ids
        return {"keys": [dict(k, issued_at=k["issued_at"].isoformat() + "Z") for k in store.list_keys(ids)]}

    @app.post("/v1/keys/{name}/link")
    def key_link(name: str, notification_id: Optional[int] = None, p: Principal = Depends(current)):
        acc = account_for(p, name)
        link = commands.extract_link(runner.run_ok("link", acc["name"]))
        if notification_id:
            store.mark_notification(notification_id, p.ids if not p.is_admin else [acc["id"], *p.ids], "delivered_at", now_fn())
        return {"name": acc["name"], "link": link}  # ссылка - секрет, в базе не хранится

    @app.post("/v1/keys/{name}/resend")
    def key_resend(name: str, p: Principal = Depends(current)):
        acc = account_for(p, name)
        runner.run_ok("resend", acc["name"])
        return {"ok": True}

    @app.post("/v1/keys/{name}/reissue")
    def key_reissue(name: str, p: Principal = Depends(current)):
        acc = account_for(p, name)
        runner.run_ok("reissue", acc["name"])  # vampn сам отправляет новый ключ на почту
        now = now_fn()
        # при отправке письма vampn сам заводит ключ и уведомление в базе (хук в его почтовой части): второе не создаём
        recent = store.recent_key_notification(acc["id"], now - timedelta(minutes=2))
        if recent:
            key_id, nid = recent["key_id"], recent["id"]
        else:
            key_id = store.add_key(acc["id"], acc["name"], "reissued", p.accounts[0]["name"], now)
            nid = store.add_notification(acc["id"], key_id, "key", "Новый ключ VPN", now)
            store.mark_notification(nid, [acc["id"]], "email_sent_at", now)
        devices = store.devices_by_email(acc["email"])
        if devices and push.send(devices, "Новый ключ VPN", "Откройте приложение, чтобы получить ключ") > 0:
            store.mark_notification(nid, [acc["id"]], "push_sent_at", now_fn())
        return {"key_id": key_id, "notification_id": nid}

    # ---------- уведомления ----------
    @app.get("/v1/notifications")
    def notifications(p: Principal = Depends(current)):
        rows = store.list_notifications(p.ids)
        iso = lambda v: v.isoformat() + "Z" if v else None
        return {"notifications": [dict(r, email_sent_at=iso(r["email_sent_at"]), push_sent_at=iso(r["push_sent_at"]),
                                       delivered_at=iso(r["delivered_at"]), read_at=iso(r["read_at"]),
                                       created_at=iso(r["created_at"])) for r in rows]}

    @app.get("/v1/notifications/stream")
    async def notifications_stream(p: Principal = Depends(current)):
        """SSE: открытое приложение получает событие `changed` и сразу перечитывает /v1/notifications."""
        ids, token = list(p.ids), p.token

        def still_valid() -> bool:
            try:
                auth.authenticate(token)
                return True
            except ApiError:
                return False

        stream = notification_stream(
            lambda: store.notifications_signature(ids), still_valid,
            poll=s.stream_poll_seconds, heartbeat=s.stream_heartbeat_seconds,
            recheck=s.stream_recheck_seconds, max_seconds=s.stream_max_seconds)
        # X-Accel-Buffering и no-cache: прокси не должны копить кадры; Caddy сбрасывает text/event-stream сам
        return StreamingResponse(stream, media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    @app.post("/v1/notifications/{nid}/delivered")
    def notif_delivered(nid: int, p: Principal = Depends(current)):
        if not store.mark_notification(nid, p.ids, "delivered_at", now_fn()):
            raise NotFound("нет такого уведомления")
        return {"ok": True}

    @app.post("/v1/notifications/{nid}/read")
    def notif_read(nid: int, p: Principal = Depends(current)):
        now = now_fn()
        if not store.mark_notification(nid, p.ids, "read_at", now):
            raise NotFound("нет такого уведомления")
        store.mark_notification(nid, p.ids, "delivered_at", now)
        return {"ok": True}

    # ---------- суперадмин: пользователи ----------
    @app.get("/v1/admin/users")
    def admin_users(_p: Principal = Depends(admin)):
        iso = lambda v: v.isoformat() + "Z" if v else None
        return {"users": [dict(u, active=bool(u["active"]), revoked_at=iso(u["revoked_at"]), created_at=iso(u["created_at"]))
                          for u in store.list_users()]}

    @app.get("/v1/admin/events")
    def admin_events(name: Optional[str] = None, _p: Principal = Depends(admin)):
        uid = None
        if name:
            u = store.get_user(name) if security.valid_name(name) else None
            if not u:
                raise NotFound("нет такого пользователя")
            uid = u["id"]
        return {"events": [dict(e, created_at=e["created_at"].isoformat() + "Z") for e in store.list_events(uid)]}

    @app.post("/v1/admin/users")
    def admin_create(body: NewUser, p: Principal = Depends(admin)):
        email = security.normalize_email(body.email)
        if not security.valid_name(body.name) or not security.valid_email(email):
            raise BadRequest("плохое имя или почта")
        existing = store.get_user(body.name)
        if existing and existing["active"]:
            raise Conflict("пользователь уже есть")
        if existing:
            store.restore_user(body.name, email)
            store.add_event(existing["id"], "restored", existing["email"], email, "app")
            uid = existing["id"]
        else:
            uid = store.create_user(body.name, email, body.role)
            store.add_event(uid, "created", None, email, "app")
        return {"id": uid, "note": "ключ придёт на почту в течение минуты после синхронизации со списком vampn"}

    @app.patch("/v1/admin/users/{name}")
    def admin_patch(name: str, body: UserPatch, p: Principal = Depends(admin)):
        u = store.get_user(name) if security.valid_name(name) else None
        if not u:
            raise NotFound("нет такого пользователя")
        now = now_fn()
        if body.email is not None:
            email = security.normalize_email(body.email)
            if not security.valid_email(email):
                raise BadRequest("плохая почта")
            if email != u["email"]:
                store.set_email(name, email)
                store.add_event(u["id"], "email_changed", u["email"], email, "app")
        if body.role is not None and body.role != u["role"]:
            if u["role"] == "admin" and body.role != "admin" and len([x for x in store.list_users() if x["role"] == "admin" and x["active"]]) <= 1:
                raise Conflict("нельзя снять роль с последнего суперадмина")
            store.set_role(name, body.role)
            store.add_event(u["id"], "role_changed", u["role"], body.role, "app")
        if body.active is not None and bool(u["active"]) != body.active:
            if not body.active:
                if u["role"] == "admin" and len([x for x in store.list_users() if x["role"] == "admin" and x["active"]]) <= 1:
                    raise Conflict("нельзя отозвать последнего суперадмина")
                store.revoke_user(name, "revoked_in_app", now)
                store.revoke_user_sessions([u["id"]], now)
                store.add_event(u["id"], "revoked", u["email"], None, "app")
            else:
                store.restore_user(name, body.email or u["email"])
                store.add_event(u["id"], "restored", None, body.email or u["email"], "app")
        return {"ok": True}

    return app
