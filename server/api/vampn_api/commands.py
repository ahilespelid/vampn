"""Запуск команд vampn на homeserv. Разрешён только фиксированный список, имена проверяются."""
import re
import subprocess
from dataclasses import dataclass

from .errors import BadRequest, CommandFailed
from .security import valid_name

ANSI_RE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
MAX_OUTPUT = 20000


@dataclass
class Result:
    code: int
    out: str
    err: str


def build_argv(sub: str, arg: str = "") -> list:
    """Список аргументов vampn для разрешённой подкоманды; иначе BadRequest."""
    if sub in ("status", "server", "list"):
        if arg:
            raise BadRequest("команда без аргументов")
        return [sub]
    if sub in ("link", "resend", "reissue"):
        if not valid_name(arg):
            raise BadRequest("плохое имя пользователя")
        return [sub, arg]
    if sub == "rotate":
        if arg not in ("", "--force"):
            raise BadRequest("недопустимый параметр")
        return [sub] + ([arg] if arg else [])
    if sub == "reboot":
        if arg not in ("", "hard"):
            raise BadRequest("недопустимый параметр")
        return [sub] + ([arg] if arg else [])
    if sub == "emergency":
        if arg not in ("on", "off", "status"):
            raise BadRequest("недопустимый параметр")
        return [sub, arg]
    raise BadRequest("команда не разрешена")


class VampnRunner:
    def __init__(self, binary: str, timeout: int = 180, use_sudo: bool = True):
        self.binary, self.timeout, self.use_sudo = binary, timeout, use_sudo

    def run(self, sub: str, arg: str = "") -> Result:
        argv = build_argv(sub, arg)
        cmd = (["sudo", "-n"] if self.use_sudo else []) + [self.binary] + argv
        try:
            p = subprocess.run(cmd, capture_output=True, text=True, timeout=self.timeout, stdin=subprocess.DEVNULL)
        except subprocess.TimeoutExpired:
            raise CommandFailed("команда не завершилась за %d с" % self.timeout)
        except OSError as exc:
            raise CommandFailed("не удалось запустить vampn: %s" % exc.__class__.__name__)
        clean = lambda s: ANSI_RE.sub("", s)[:MAX_OUTPUT]
        return Result(p.returncode, clean(p.stdout), clean(p.stderr))

    def run_ok(self, sub: str, arg: str = "") -> str:
        r = self.run(sub, arg)
        if r.code != 0:
            raise CommandFailed((r.err or r.out or "vampn вернул ошибку").strip()[:500])
        return r.out


def extract_link(output: str) -> str:
    for line in output.splitlines():
        line = line.strip()
        if line.startswith("vpn://"):
            return line
    raise CommandFailed("в ответе vampn нет ссылки vpn://")
