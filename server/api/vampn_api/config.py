import os
from dataclasses import dataclass, field


def _int(env, name, default):
    return int(env.get(name, default))


@dataclass(frozen=True)
class Settings:
    db_host: str = "127.0.0.1"
    db_port: int = 3307
    db_user: str = "vampn"
    db_password: str = ""
    db_name: str = "vampn"
    secret: str = ""  # перец для хешей кодов; обязателен в бою
    smtp_host: str = ""
    smtp_port: int = 465
    smtp_tls: str = "ssl"  # ssl | starttls | none
    smtp_user: str = ""
    smtp_pass: str = ""
    mail_from: str = ""
    vampn_bin: str = "/usr/local/sbin/vampn"
    use_sudo: bool = True
    command_timeout: int = 180
    code_ttl_seconds: int = 600
    code_max_attempts: int = 6
    lock_seconds: int = 3600
    codes_per_hour: int = 3
    ip_fail_limit: int = 20
    session_days: int = 30
    # публичная ссылка на приложение/магазин не нужна; поле для будущего
    extra: dict = field(default_factory=dict)


def load_settings(env=None) -> Settings:
    env = os.environ if env is None else env
    return Settings(
        db_host=env.get("DB_HOST", "127.0.0.1"),
        db_port=_int(env, "DB_PORT", 3307),
        db_user=env.get("DB_USER", "vampn"),
        db_password=env.get("DB_PASSWORD", ""),
        db_name=env.get("DB_NAME", "vampn"),
        secret=env.get("API_SECRET", ""),
        smtp_host=env.get("SMTP_HOST", ""),
        smtp_port=_int(env, "SMTP_PORT", 465),
        smtp_tls=env.get("SMTP_TLS", "ssl"),
        smtp_user=env.get("SMTP_USER", ""),
        smtp_pass=env.get("SMTP_PASS", ""),
        mail_from=env.get("MAIL_FROM", env.get("SMTP_USER", "")),
        vampn_bin=env.get("VAMPN_BIN", "/usr/local/sbin/vampn"),
        use_sudo=env.get("VAMPN_USE_SUDO", "1") != "0",
        command_timeout=_int(env, "COMMAND_TIMEOUT", 180),
        code_ttl_seconds=_int(env, "CODE_TTL_SECONDS", 600),
        code_max_attempts=_int(env, "CODE_MAX_ATTEMPTS", 6),
        lock_seconds=_int(env, "LOCK_SECONDS", 3600),
        codes_per_hour=_int(env, "CODES_PER_HOUR", 3),
        ip_fail_limit=_int(env, "IP_FAIL_LIMIT", 20),
        session_days=_int(env, "SESSION_DAYS", 30),
    )
