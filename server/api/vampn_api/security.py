import hashlib
import hmac
import re
import secrets

EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
NAME_RE = re.compile(r"^[A-Za-z0-9._-]{1,32}$")


def normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def valid_email(email: str) -> bool:
    return bool(EMAIL_RE.match(email or "")) and len(email) <= 255


def valid_name(name: str) -> bool:
    return bool(NAME_RE.match(name or ""))


def new_code() -> str:
    return "%04d" % secrets.randbelow(10000)


def hash_code(secret: str, email: str, code: str) -> str:
    return hmac.new(secret.encode(), ("%s:%s" % (email, code)).encode(), hashlib.sha256).hexdigest()


def check_code(secret: str, email: str, code: str, stored_hash: str) -> bool:
    return hmac.compare_digest(hash_code(secret, email, code), stored_hash)


def new_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()
