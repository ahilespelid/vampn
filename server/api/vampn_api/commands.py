"""Запуск команд vampn на homeserv. Разрешён только фиксированный список, имена проверяются."""
import re
import subprocess
from dataclasses import dataclass

from .errors import BadRequest, CommandFailed
from .security import valid_name

ANSI_RE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
MAX_OUTPUT = 20000
ROTATE_ARGS = ("", "--force", "1", "2", "--force 1", "--force 2")
ACCT_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,23}$")   # имя кабинета Timeweb (как в vampn account)
CELL_MIN, CELL_MAX = 2, 30                    # ячейку 1 удалить нельзя; верхняя граница совпадает со строками sudoers


@dataclass
class Result:
    code: int
    out: str
    err: str


def build_argv(sub: str, arg: str = "") -> list:
    """Список аргументов vampn для разрешённой подкоманды; иначе BadRequest."""
    if sub in ("status", "server", "list", "resendall", "mailstatus"):
        if arg:
            raise BadRequest("команда без аргументов")
        return [sub]
    if sub in ("link", "keyconf", "resend", "reissue"):
        if not valid_name(arg):
            raise BadRequest("плохое имя пользователя")
        return [sub, arg]
    if sub == "rotate":
        # смена IP: на активном кабинете Timeweb (без номера) или на выбранном: 1 основной, 2 запасной
        if arg not in ROTATE_ARGS:
            raise BadRequest("недопустимый параметр")
        return [sub] + arg.split()
    if sub == "use":
        # перевести туннель на кабинет 1 (основной) или 2 (запасной), IP не меняется
        if arg not in ("1", "2"):
            raise BadRequest("недопустимый параметр")
        return [sub, arg]
    if sub == "reboot":
        if arg not in ("", "hard"):
            raise BadRequest("недопустимый параметр")
        return [sub] + ([arg] if arg else [])
    if sub == "emergency":
        if arg not in ("on", "off", "status"):
            raise BadRequest("недопустимый параметр")
        return [sub, arg]
    # ---- ячейки и аренда серверов (только суперадмин; доступ проверяет main.py) ----
    if sub == "cells":
        if arg:
            raise BadRequest("команда без аргументов")
        return [sub]
    if sub == "spawnstatus":
        if arg:
            raise BadRequest("команда без аргументов")
        return [sub, "40"]
    if sub == "spawn":
        # арендует платный сервер; пустой аргумент - кабинет по умолчанию
        if arg and not ACCT_RE.match(arg):
            raise BadRequest("плохое имя кабинета")
        return [sub] + ([arg] if arg else [])
    if sub == "account-list":
        if arg:
            raise BadRequest("команда без аргументов")
        return ["account", "list", "--tsv"]
    if sub in ("account-add", "account-default", "account-del"):
        if not ACCT_RE.match(arg):
            raise BadRequest("плохое имя кабинета")
        return ["account", sub.split("-", 1)[1], arg]
    if sub == "celldel":
        # без --force: ячейку с пользователями vampn не удалит
        if not arg.isdigit() or not (CELL_MIN <= int(arg) <= CELL_MAX) or str(int(arg)) != arg:
            raise BadRequest("плохой номер ячейки")
        return [sub, arg, "--yes"]
    raise BadRequest("команда не разрешена")


class VampnRunner:
    def __init__(self, binary: str, timeout: int = 180, use_sudo: bool = True):
        self.binary, self.timeout, self.use_sudo = binary, timeout, use_sudo

    def run(self, sub: str, arg: str = "", timeout: int = 0, stdin: str = "") -> Result:
        """stdin - секрет (токен Timeweb): передаётся только через стандартный ввод, в argv и журнал не попадает."""
        argv = build_argv(sub, arg)
        cmd = (["sudo", "-n"] if self.use_sudo else []) + [self.binary] + argv
        try:
            kw = {"input": stdin} if stdin else {"stdin": subprocess.DEVNULL}
            p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout or self.timeout, **kw)
        except subprocess.TimeoutExpired:
            raise CommandFailed("команда не завершилась за %d с" % (timeout or self.timeout))
        except OSError as exc:
            raise CommandFailed("не удалось запустить vampn: %s" % exc.__class__.__name__)
        clean = lambda s: ANSI_RE.sub("", s)[:MAX_OUTPUT]
        return Result(p.returncode, clean(p.stdout), clean(p.stderr))

    def run_ok(self, sub: str, arg: str = "", stdin: str = "") -> str:
        r = self.run(sub, arg, stdin=stdin)
        if r.code != 0:
            raise CommandFailed((r.err or r.out or "vampn вернул ошибку").strip()[:500])
        return r.out


def extract_link(output: str) -> str:
    for line in output.splitlines():
        line = line.strip()
        if line.startswith("vpn://"):
            return line
    raise CommandFailed("в ответе vampn нет ссылки vpn://")
