#!/usr/bin/env python3
"""vampn-metrics: раз в минуту кладёт метрики VPN в таблицу metrics (Percona), из неё берёт статистику приложение.

Читает только вывод `vampn list` и `vampn status` (оба ничего не меняют). Запускается от root таймером systemd.
  users_online   сколько пользователей подключались за последние 3 минуты (сам homeserv не считается)
  users_total    сколько всего пользователей в списке
  tunnel_age     секунд с последнего рукопожатия туннеля   (раз в 5 минут, из status)
  offline_min    сколько минут нет связи с VPN-сервером    (раз в 5 минут, из status)
  mirror_age     возраст копии данных VPN-сервера, секунд  (раз в 5 минут, из status)
Режимы: --selftest, --dry-run (показать, что записалось бы), без аргументов - записать.

Тревога о массовом выпадении людей: если за последние 5 минут онлайн был не меньше 4, а теперь упал до 30% и ниже
две минуты подряд, при этом vampn list ответил (значит, туннель homeserv - VPS жив), в Telegram уходит сообщение
(через tg, в тему alerts): вероятно, часть провайдеров перестала пускать на адрес сервера. Когда онлайн вернулся
до 60% прежнего, приходит сообщение о восстановлении. Состояние лежит в /var/lib/vampn-metrics/state.json.
"""
import json
import os
import re
import subprocess
import sys
from datetime import datetime

CONTAINER = "vampn_percona"
VAMPN = "/usr/local/sbin/vampn"
SERVER = "vpn"
ONLINE_SECONDS = 180
RETENTION_DAYS = 90
STATE_DIR = "/var/lib/vampn-metrics"
STATE_FILE = STATE_DIR + "/state.json"
DROP_WINDOW = 300      # смотрим максимум онлайна за последние 5 минут (резкий обрыв, а не вечерний спад)
DROP_MIN_PEAK = 4      # меньше людей - тревогу не поднимаем
DROP_RATIO = 0.3       # упал до 30% и ниже
DROP_CONFIRM = 2       # столько минут подряд
RECOVER_RATIO = 0.6    # вернулся до 60% прежнего - отбой
REALERT_AFTER = 6 * 3600
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


def evaluate_drop(state, ts, online):
    """-> (новое состояние, сообщение или None). ts - секунды (epoch), online - число людей онлайн сейчас."""
    hist = [h for h in state.get("history", []) if ts - h[0] <= DROP_WINDOW]
    peak = max([h[1] for h in hist], default=0)
    st = {"history": hist + [[ts, online]], "low": state.get("low", 0),
          "alert_peak": state.get("alert_peak", 0), "alerted_at": state.get("alerted_at")}
    msg = None
    if st["alerted_at"] is None:
        if peak >= DROP_MIN_PEAK and online <= peak * DROP_RATIO:
            st["low"] += 1
        else:
            st["low"] = 0
        if st["low"] >= DROP_CONFIRM:
            st["alerted_at"], st["alert_peak"], st["low"] = ts, peak, 0
            msg = ("онлайн упал с %d до %d человек за несколько минут, а туннель homeserv - VPS жив. "
                   "Похоже, часть провайдеров перестала пускать на адрес сервера. Проверьте подключение с телефона на мобильном "
                   "интернете; если адрес режется - ssh homeserv vampn rotate --force" % (peak, online))
    else:
        if online >= st["alert_peak"] * RECOVER_RATIO:
            msg = "онлайн вернулся: %d человек (перед падением было %d)" % (online, st["alert_peak"])
            st["alerted_at"], st["alert_peak"], st["low"] = None, 0, 0
        elif ts - st["alerted_at"] >= REALERT_AFTER:
            st["alerted_at"] = ts
            msg = "онлайн всё ещё низкий: %d человек (до падения было %d)" % (online, st["alert_peak"])
    return st, msg


def load_state():
    try:
        with open(STATE_FILE, encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def save_state(state):
    os.makedirs(STATE_DIR, mode=0o700, exist_ok=True)
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(state, fh)
    os.replace(tmp, STATE_FILE)


def send_alert(text):
    try:
        subprocess.run(["tg", "notify", "alerts", "🛡 " + text], capture_output=True, timeout=60)
    except Exception:  # noqa: BLE001 - тревога не должна ронять сборщик
        pass


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
    # тревога о выпадении людей
    t0 = 1000000
    st, ms = {}, []
    for i, n in enumerate([6, 6, 7, 6, 1, 1]):          # минута 4: 6 -> 1 и ещё одна минута подряд
        st, m = evaluate_drop(st, t0 + 60 * i, n)
        ms.append(m)
    check("тревога: первое низкое значение ещё не тревога", ms[4] is None)
    check("тревога: второе подряд - сообщение с цифрами 7 и 1", ms[5] is not None and "с 7 до 1" in ms[5])
    st, m = evaluate_drop(st, t0 + 60 * 6, 1)
    check("тревога: повторно не шлётся", m is None)
    st, m = evaluate_drop(st, t0 + 60 * 7, 5)
    check("отбой: онлайн вернулся до 60%", m is not None and "вернулся" in m)
    st, m = evaluate_drop(st, t0 + 60 * 8, 5)
    check("после отбоя тихо", m is None)
    st, ms = {}, []
    for i, n in enumerate([6, 5, 4, 3, 2, 1, 0]):       # плавный вечерний спад - не тревога
        st, m = evaluate_drop(st, t0 + 120 * i, n)
        ms.append(m)
    check("плавный спад (по минуте-две на человека) не даёт тревоги", all(m is None for m in ms))
    st, m = evaluate_drop({}, t0, 0)
    check("пустой онлайн без истории - тихо", m is None)
    st, ms = {}, []
    for i, n in enumerate([2, 3, 2, 0, 0, 0]):          # малая нагрузка (пик 3 < 4) - тихо
        st, m = evaluate_drop(st, t0 + 60 * i, n)
        ms.append(m)
    check("мало людей (пик < 4) - тихо", all(m is None for m in ms))
    st, m = evaluate_drop({"alerted_at": t0, "alert_peak": 8, "history": []}, t0 + REALERT_AFTER + 1, 1)
    check("через 6 часов напоминание, если всё ещё пусто", m is not None and "всё ещё" in m)
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
    new_state, alert = evaluate_drop(load_state(), int(now.timestamp()), int(values["users_online"]))
    if dry:
        print("записалось бы (server=%s):" % SERVER)
        for k, v in values.items():
            print("  %-14s %s" % (k, v))
        print("тревога: %s" % (alert or "нет"))
        return 0
    try:
        sql(build_sql(values, cleanup))
    except Exception as exc:  # noqa: BLE001
        print("не удалось записать в базу: %s" % exc)
        return 1
    try:
        save_state(new_state)
    except OSError as exc:
        print("не удалось сохранить состояние: %s" % exc)
    if alert:
        send_alert(alert)
    print("записано: " + ", ".join("%s=%s" % kv for kv in values.items()) + ("; тревога отправлена" if alert else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
