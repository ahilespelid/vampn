#!/usr/bin/env python3
"""vampn-metrics: раз в минуту кладёт метрики VPN в таблицу metrics (Percona), из неё берёт статистику приложение.

Читает только вывод `vampn list` и `vampn status` (оба ничего не меняют). Запускается от root таймером systemd.
  users_online   сколько пользователей подключались за последние 3 минуты (сам homeserv не считается)
  users_total    сколько всего пользователей в списке
  tunnel_age     секунд с последнего рукопожатия туннеля   (раз в 5 минут, из status)
  offline_min    сколько минут нет связи с VPN-сервером    (раз в 5 минут, из status)
  mirror_age     возраст копии данных VPN-сервера, секунд  (раз в 5 минут, из status)
Режимы: --selftest, --dry-run (показать, что записалось бы), без аргументов - записать.
"""
import re
import subprocess
import sys
from datetime import datetime

CONTAINER = "vampn_percona"
VAMPN = "/usr/local/sbin/vampn"
SERVER = "vpn"
ONLINE_SECONDS = 180
RETENTION_DAYS = 90
TIME_RE = r"(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)"
LIST_RE = re.compile(r"^(\S+)\s+(\d+\.\d+\.\d+\.\d+)\s+(\S+)\s+(?:" + TIME_RE + r"|никогда)\s*$")
HANDSHAKE_RE = re.compile(r"рукопожатие\s+(\d+)\s*с\s+назад")
OFFLINE_RE = re.compile(r"без связи\s*:\s*(\d+)\s*мин")
MIRROR_RE = re.compile(r"копия данных\s*:\s*" + TIME_RE)


def parse_ts(text):
    return datetime.strptime(text, "%Y-%m-%d %H:%M:%S")


def parse_list(text, now):
    """-> (online, total). Строка homeserv (служебный узел туннеля) в счёт не идёт."""
    online = total = 0
    for line in text.splitlines():
        m = LIST_RE.match(line.strip())
        if not m or m.group(1) == "homeserv":
            continue
        total += 1
        if m.group(4) and 0 <= (now - parse_ts(m.group(4))).total_seconds() <= ONLINE_SECONDS:
            online += 1
    return online, total


def parse_status(text, now):
    out = {}
    m = HANDSHAKE_RE.search(text)
    if m:
        out["tunnel_age"] = float(m.group(1))
    m = OFFLINE_RE.search(text)
    if m:
        out["offline_min"] = float(m.group(1))
    m = MIRROR_RE.search(text)
    if m:
        out["mirror_age"] = max(0.0, (now - parse_ts(m.group(1))).total_seconds())
    return out


def run_vampn(arg, timeout=60):
    r = subprocess.run([VAMPN, arg], capture_output=True, text=True, timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError("vampn %s: код %d" % (arg, r.returncode))
    return r.stdout


def sql(query):
    cmd = ["docker", "exec", "-i", CONTAINER, "sh", "-c",
           'MYSQL_PWD="$MYSQL_PASSWORD" mysql -u"$MYSQL_USER" "$MYSQL_DATABASE" --default-character-set=utf8mb4']
    r = subprocess.run(cmd, input=query, capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise RuntimeError("mysql: " + r.stderr.strip()[:300])


def build_sql(values, cleanup):
    s = ["START TRANSACTION;"]
    for name, value in values.items():
        if not re.fullmatch(r"[a-z_]{1,32}", name):
            raise ValueError("плохое имя метрики")
        s.append("INSERT INTO metrics (ts,server,metric,value) VALUES (UTC_TIMESTAMP(),'%s','%s',%r);" % (SERVER, name, float(value)))
    if cleanup:
        s.append("DELETE FROM metrics WHERE ts < UTC_TIMESTAMP() - INTERVAL %d DAY;" % RETENTION_DAYS)
    s.append("COMMIT;")
    return "\n".join(s) + "\n"


def collect(now, with_status, list_text, status_text=""):
    online, total = parse_list(list_text, now)
    values = {"users_online": online, "users_total": total}
    if with_status:
        values.update(parse_status(status_text, now))
    return values


def selftest():
    fails = []

    def check(title, cond):
        print("  %-60s %s" % (title, "OK" if cond else "ОШИБКА"))
        if not cond:
            fails.append(title)

    now = datetime(2026, 11, 24, 3, 52, 0)
    lst = ("ИМЯ                  IP              ПОЧТА                          ПОСЛЕДНЕЕ ПОДКЛЮЧЕНИЕ\n"
           "admin                10.77.0.2       a@gmail.com          2026-11-24 03:51:38\n"
           "ahilespelid          10.77.0.6       b@yandex.ru          2026-11-24 03:50:53\n"
           "andrey               10.77.0.16      c@gmail.com          2026-11-24 03:24:10\n"
           "griga                10.77.0.8       d@yandex.ru             никогда\n"
           "homeserv             10.77.0.3       -                              2026-11-24 03:51:23\n"
           "korolev              10.77.0.7       e@yandex.ru         2026-11-24 03:51:50\n")
    online, total = parse_list(lst, now)
    check("онлайн: за 3 минуты (admin, ahilespelid, korolev)", online == 3)
    check("всего без homeserv", total == 5)
    check("пустой вывод -> 0 и 0", parse_list("", now) == (0, 0))
    future = "x 10.0.0.1 a@b.ru 2026-11-24 03:59:00\n"
    check("время из будущего не считается онлайн", parse_list(future, now) == (0, 1))
    st = ("туннель      : рукопожатие 62 с назад (мёртв, если > 300)\n"
          "без связи    : 0 мин (перезагрузка с 10, смена IP с 20)\n"
          "копия данных : 2026-11-24 03:49:24, пользователей 19\n")
    p = parse_status(st, now)
    check("status: рукопожатие 62 с", p.get("tunnel_age") == 62.0)
    check("status: без связи 0 мин", p.get("offline_min") == 0.0)
    check("status: копия данных 156 с назад", p.get("mirror_age") == 156.0)
    check("status: незнакомый текст -> пусто", parse_status("что-то другое", now) == {})
    vals = collect(now, False, lst)
    check("без status только две метрики", sorted(vals) == ["users_online", "users_total"])
    q = build_sql(vals, cleanup=True)
    check("SQL: две вставки, очистка, транзакция", q.count("INSERT INTO metrics") == 2 and "DELETE FROM metrics" in q and q.startswith("START"))
    try:
        build_sql({"bad name;": 1}, False)
        check("плохое имя метрики отвергается", False)
    except ValueError:
        check("плохое имя метрики отвергается", True)
    print("selftest: %s" % ("все проверки пройдены" if not fails else "ОШИБКИ: %d" % len(fails)))
    return 0 if not fails else 1


def main():
    args = sys.argv[1:]
    if args == ["--selftest"]:
        return selftest()
    dry = args == ["--dry-run"]
    if args and not dry:
        print("использование: vampn-metrics [--selftest | --dry-run]")
        return 2
    now = datetime.now()
    with_status = now.minute % 5 == 0 or dry
    try:
        list_text = run_vampn("list")
        status_text = run_vampn("status") if with_status else ""
    except Exception as exc:  # noqa: BLE001 - любой сбой чтения: просто пропускаем минуту
        print("не удалось прочитать vampn: %s" % exc)
        return 1
    values = collect(now, with_status, list_text, status_text)
    cleanup = now.hour == 4 and now.minute == 0
    if dry:
        print("записалось бы (server=%s):" % SERVER)
        for k, v in values.items():
            print("  %-14s %s" % (k, v))
        return 0
    try:
        sql(build_sql(values, cleanup))
    except Exception as exc:  # noqa: BLE001
        print("не удалось записать в базу: %s" % exc)
        return 1
    print("записано: " + ", ".join("%s=%s" % kv for kv in values.items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
