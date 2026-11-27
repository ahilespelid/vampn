"""Разбор вывода vampn для ячеек, кабинетов Timeweb и аренды серверов (для экранов суперадмина)."""
import re

ACCT_NAME = re.compile(r"^[a-z0-9][a-z0-9_-]{0,23}$")
TOKEN_RE = re.compile(r"^[A-Za-z0-9._-]{20,4096}$")
RESERVED = ("main", "spare")  # прежние кабинеты (timeweb.env и timeweb2.env), добавлять под этими именами нельзя


def parse_cells(out: str) -> list:
    """vampn cells: первая строка - заголовок, дальше поля через табуляцию."""
    rows = []
    for line in out.splitlines()[1:]:
        f = line.split("\t")
        if len(f) < 7 or not f[0].isdigit():
            continue
        rows.append({
            "cell": int(f[0]), "name": f[1], "ip": None if f[2] == "-" else f[2],
            "users": int(f[3]) if f[3].isdigit() else 0, "limit": int(f[4]) if f[4].isdigit() else 0,
            "handshake": None if f[5] == "-" else f[5], "state": f[6],
        })
    return rows


def parse_accounts(out: str) -> list:
    """vampn account list --tsv: имя, состояние (ok|denied|none), баланс, валюта, по умолчанию, сообщение. Токенов в выводе нет."""
    rows = []
    for line in out.splitlines():
        f = line.split("\t")
        if len(f) < 5 or not ACCT_NAME.match(f[0]):
            continue
        try:
            balance = float(f[2]) if f[2] else None
        except ValueError:
            balance = None
        rows.append({"name": f[0], "status": f[1], "balance": balance, "currency": f[3] or None,
                     "default": f[4] == "1", "message": (f[5] if len(f) > 5 else "") or None})
    return rows


def parse_spawn(out: str) -> dict:
    """vampn spawnstatus: первая строка «состояние: ТИП: подробности», дальше журнал."""
    lines = out.splitlines()
    head = lines[0].split(":", 1)[1].strip() if lines and lines[0].startswith("состояние:") else ""
    kind, _, detail = head.partition(":")
    kind = kind.strip()
    state = kind if kind in ("queued", "running", "done", "failed") else "none"
    return {"state": state, "detail": detail.strip(), "log": [l for l in lines[1:] if l.strip()]}
