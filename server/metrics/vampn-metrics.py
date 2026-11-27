#!/usr/bin/env python3
"""vampn-metrics: раз в минуту кладёт метрики VPN в таблицу metrics (Percona), из неё берёт статистику приложение.

Читает только вывод `vampn list` и `vampn status` (оба ничего не меняют). Запускается от root таймером systemd.
  users_online   сколько пользователей подключались за последние 3 минуты (сам homeserv не считается)
  users_total    сколько всего пользователей в списке
  tunnel_age     секунд с последнего рукопожатия туннеля   (раз в 5 минут, из status)
  offline_min    сколько минут нет связи с VPN-сервером    (раз в 5 минут, из status)
  mirror_age     возраст копии данных VPN-сервера, секунд  (раз в 5 минут, из status)
Режимы: --selftest, --dry-run (показать, что записалось бы), без аргументов - записать.

Статистика по ключам (читает `vampn peers`, тоже только чтение; прошлые значения лежат в /var/lib/vampn-metrics/peers.json):
  key_stats    по ключу: сколько байт всего скачано и отдано, число подключений, когда замечен впервые и в последний раз,
               последний IP клиента, на каком сервере и с каким IP сервера
  key_traffic  байты по ключу по часам (хранится 90 дней)
  key_events   подключения, смена IP клиента, смена IP сервера и переключение основной/запасной/аварийный (хранится 90 дней)
Счётчики awg принадлежат конкретному серверу и сбрасываются при его перезапуске, поэтому прошлые значения держатся отдельно по
серверу, а уменьшение счётчика считается сбросом. История до первого запуска не восстанавливается: учёт идёт с этого момента.
Если таблиц ещё нет (схема не применена) или vampn peers не отвечает, общие метрики всё равно пишутся.

Тревога о массовом выпадении людей: если за последние 5 минут онлайн был не меньше 4, а теперь упал до 30% и ниже
две минуты подряд, при этом vampn list ответил (значит, туннель homeserv - VPS жив), в Telegram уходит сообщение
(через tg, в тему alerts): вероятно, часть провайдеров перестала пускать на адрес сервера. Когда онлайн вернулся
до 60% прежнего, приходит сообщение о восстановлении. Состояние лежит в /var/lib/vampn-metrics/state.json.
"""
import ipaddress
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
PEERS_FILE = STATE_DIR + "/peers.json"
SESSION_GAP = 300      # новое подключение, если прошлое рукопожатие было больше 5 минут назад (в сети оно обновляется каждые ~2 минуты)
NAME_RE = re.compile(r"[A-Za-z0-9_.-]{1,32}")
LABEL_RE = re.compile(r"[\w -]{1,16}")
NUM_RE = re.compile(r"[0-9]{1,20}")
EVENT_KINDS = ("connect", "client_ip", "server_ip", "server_switch")
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


def load_state(path=STATE_FILE):
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def save_state(state, path=STATE_FILE):
    os.makedirs(STATE_DIR, mode=0o700, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(state, fh)
    os.replace(tmp, path)


def send_alert(text):
    try:
        subprocess.run(["tg", "notify", "alerts", "🛡 " + text], capture_output=True, timeout=60)
    except Exception:  # noqa: BLE001 - тревога не должна ронять сборщик
        pass


def run_vampn(arg, timeout=60):
    r = subprocess.run([VAMPN, arg], capture_output=True, text=True, encoding="utf-8", timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError("vampn %s: код %d" % (arg, r.returncode))
    return r.stdout


def sql(query):
    cmd = ["docker", "exec", "-i", CONTAINER, "sh", "-c",
           'MYSQL_PWD="$MYSQL_PASSWORD" mysql -u"$MYSQL_USER" "$MYSQL_DATABASE" --default-character-set=utf8mb4']
    r = subprocess.run(cmd, input=query, capture_output=True, text=True, encoding="utf-8", timeout=60)
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


def norm_ip(text):
    if text == "-":
        return "-"
    try:
        return str(ipaddress.ip_address(text))
    except ValueError:
        return "-"


def parse_peers(text):
    """Вывод `vampn peers` -> ((сервер, IP сервера) или None, [ключи]). Строки не по формату пропускаются, homeserv не считается.
    Поля через табуляцию: сервер, IP сервера, имя, IP клиента, рукопожатие (unix), принято, отправлено (байт)."""
    server, rows = None, []
    for line in text.splitlines():
        f = line.split("\t")
        if len(f) != 7:
            continue
        label, sip, name, cip, hs, rx, tx = f
        if (not LABEL_RE.fullmatch(label) or not NAME_RE.fullmatch(name) or name == "homeserv"
                or not all(NUM_RE.fullmatch(v) for v in (hs, rx, tx))):
            continue
        if server is None:
            server = (label, norm_ip(sip))
        # rx - принято от клиента (его отдача), tx - отправлено клиенту (его загрузка)
        rows.append({"name": name, "ip": norm_ip(cip), "hs": int(hs), "rx": int(rx), "tx": int(tx)})
    return server, rows


def _event(ts, key, kind, old, new, label, server_ip):
    return {"ts": int(ts), "key": key, "kind": kind, "old": old, "new": new, "server": label, "server_ip": server_ip}


def diff_peers(state, server, rows, ts):
    """Сравнивает счётчики с прошлой минутой. state - прошлое состояние (peers.json), server - (сервер, его IP), ts - epoch.
    -> (новое состояние, изменения). Прошлые счётчики держатся отдельно по серверу: их ведёт его awg, и у основного, запасного
    и аварийного они разные. Уменьшение счётчика - сброс (перезапуск awg), тогда прибавка равна текущему значению.
    Самый первый запуск только запоминает счётчики: что было раньше, неизвестно."""
    label, sip = server
    first = "peers" not in state
    base = state.get("peers", {})
    prev_srv = state.get("server") or {}
    ips = state.get("ips", {})
    known = set(state.get("keys", []))
    events = []
    if prev_srv and prev_srv.get("label") != label:
        events.append(_event(ts, None, "server_switch", prev_srv.get("label"), label, label, sip))
    elif prev_srv and sip != "-" and prev_srv.get("ip") not in (None, "-", sip):
        events.append(_event(ts, None, "server_ip", prev_srv.get("ip"), sip, label, sip))
    srv_ip = sip if sip != "-" else prev_srv.get("ip", "-")
    cur = base.get(label, {})
    new_cur, new_ips, keys = {}, {}, []
    for r in rows:
        name = r["name"]
        prev = cur.get(name)
        if first:
            up = down = 0
        elif prev is None:   # новый ключ или сервер, которого раньше не видели: его счётчики начались с нуля
            up, down = r["rx"], r["tx"]
        else:
            up = r["rx"] - prev["rx"] if r["rx"] >= prev["rx"] else r["rx"]
            down = r["tx"] - prev["tx"] if r["tx"] >= prev["tx"] else r["tx"]
        prev_hs = prev["hs"] if prev else 0
        connect = (not first) and r["hs"] > prev_hs and (prev_hs == 0 or r["hs"] - prev_hs > SESSION_GAP)
        old_ip = ips.get(name, "-")
        ip = r["ip"] if r["ip"] != "-" else old_ip
        ip_changed = r["ip"] != "-" and old_ip != "-" and r["ip"] != old_ip
        if ip_changed:
            events.append(_event(ts, name, "client_ip", old_ip, ip, label, srv_ip))
        if connect:
            events.append(_event(r["hs"], name, "connect", None, None if ip == "-" else ip, label, srv_ip))
        new_cur[name] = {"hs": r["hs"], "rx": r["rx"], "tx": r["tx"]}
        new_ips[name] = ip
        if up or down or connect or ip_changed or r["hs"] > prev_hs or name not in known:
            keys.append({"name": name, "up": up, "down": down, "connect": connect, "hs": r["hs"], "ip": ip})
    state2 = {"peers": dict(base, **{label: new_cur}), "server": {"label": label, "ip": srv_ip}, "ips": new_ips,
              "keys": sorted(known | {r["name"] for r in rows})}
    return state2, {"server": (label, srv_ip), "keys": keys, "events": events}


def _q(value):
    if value is None:
        return "NULL"
    return "'" + str(value).replace("\\", "\\\\").replace("'", "\\'") + "'"


def _at(epoch):  # без FROM_UNIXTIME: она зависит от часового пояса сессии
    return "DATE_ADD('1970-01-01 00:00:00', INTERVAL %d SECOND)" % int(epoch)


def build_peers_sql(changes, cleanup):
    label, sip = changes["server"]
    if not LABEL_RE.fullmatch(label) or norm_ip(sip) != sip:
        raise ValueError("плохой сервер")
    s = ["SET time_zone='+00:00';", "START TRANSACTION;"]
    for k in changes["keys"]:
        if not NAME_RE.fullmatch(k["name"]) or norm_ip(k["ip"]) != k["ip"]:
            raise ValueError("плохой ключ")
        seen = _at(k["hs"]) if k["hs"] > 0 else "NULL"
        ip = "NULL" if k["ip"] == "-" else _q(k["ip"])
        srv_ip = "NULL" if sip == "-" else _q(sip)
        s.append(
            "INSERT INTO key_stats (key_name,up_total,down_total,connections,first_seen_at,last_seen_at,last_client_ip,last_server,last_server_ip) "
            "VALUES (%s,%d,%d,%d,%s,%s,%s,%s,%s) ON DUPLICATE KEY UPDATE "
            "up_total=up_total+VALUES(up_total),down_total=down_total+VALUES(down_total),connections=connections+VALUES(connections),"
            "first_seen_at=COALESCE(first_seen_at,VALUES(first_seen_at)),"
            "last_seen_at=GREATEST(COALESCE(last_seen_at,VALUES(last_seen_at)),COALESCE(VALUES(last_seen_at),last_seen_at)),"
            "last_client_ip=COALESCE(VALUES(last_client_ip),last_client_ip),last_server=VALUES(last_server),"
            "last_server_ip=COALESCE(VALUES(last_server_ip),last_server_ip);"
            % (_q(k["name"]), k["up"], k["down"], 1 if k["connect"] else 0, seen, seen, ip, _q(label), srv_ip))
        if k["up"] or k["down"]:
            s.append("INSERT INTO key_traffic (key_name,hour,up_bytes,down_bytes) "
                     "VALUES (%s,DATE_FORMAT(UTC_TIMESTAMP(),'%%Y-%%m-%%d %%H:00:00'),%d,%d) ON DUPLICATE KEY UPDATE "
                     "up_bytes=up_bytes+VALUES(up_bytes),down_bytes=down_bytes+VALUES(down_bytes);"
                     % (_q(k["name"]), k["up"], k["down"]))
    for e in changes["events"]:
        if e["kind"] not in EVENT_KINDS or (e["key"] is not None and not NAME_RE.fullmatch(e["key"])):
            raise ValueError("плохое событие")
        s.append("INSERT INTO key_events (ts,key_name,kind,old_value,new_value,server,server_ip) VALUES (%s,%s,%s,%s,%s,%s,%s);"
                 % (_at(e["ts"]), _q(e["key"]), _q(e["kind"]), _q(e["old"]), _q(e["new"]), _q(e["server"]),
                    "NULL" if e["server_ip"] == "-" else _q(e["server_ip"])))
    if cleanup:
        s.append("DELETE FROM key_traffic WHERE hour < UTC_TIMESTAMP() - INTERVAL %d DAY;" % RETENTION_DAYS)
        s.append("DELETE FROM key_events WHERE ts < UTC_TIMESTAMP() - INTERVAL %d DAY;" % RETENTION_DAYS)
    s.append("COMMIT;")
    return "\n".join(s) + "\n"


def mb(n):
    return "%.1f МБ" % (n / 1048576.0)


def collect_peers(now, cleanup, dry):
    """Статистика по ключам. Любой сбой только печатается: общие метрики от него не страдают."""
    try:
        server, rows = parse_peers(run_vampn("peers"))
    except Exception as exc:  # noqa: BLE001 - старый vampn без peers, нет связи с VPN-сервером и т.п.
        print("ключи: не удалось прочитать vampn peers: %s" % exc)
        return
    if server is None:
        print("ключи: vampn peers ничего не вернул")
        return
    new_state, changes = diff_peers(load_state(PEERS_FILE), server, rows, int(now.timestamp()))
    if dry:
        print("ключи (сервер %s, %s), записалось бы:" % server)
        for k in changes["keys"]:
            print("  %-16s +%s вниз, +%s вверх, подключение: %s, рукопожатие: %s, IP клиента: %s"
                  % (k["name"], mb(k["down"]), mb(k["up"]), "да" if k["connect"] else "нет", k["hs"] or "-", k["ip"]))
        for e in changes["events"]:
            print("  событие %-13s %s: %s -> %s" % (e["kind"], e["key"] or "сервер", e["old"], e["new"]))
        return
    try:
        if changes["keys"] or changes["events"] or cleanup:
            sql(build_peers_sql(changes, cleanup))
        save_state(new_state, PEERS_FILE)   # только после записи: если база не ответила, разница посчитается в следующую минуту
    except Exception as exc:  # noqa: BLE001
        print("ключи: не удалось записать: %s" % exc)
        return
    print("ключи: %d с изменениями, событий %d" % (len(changes["keys"]), len(changes["events"])))


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
    # статистика по ключам
    SRV = ("основной", "198.51.100.7")
    t0 = 1700000000

    def peers_text(rows, label=SRV[0], sip=SRV[1]):
        return "".join("\t".join(str(x) for x in (label, sip) + tuple(r)) + "\n" for r in rows)

    def step(state, rows, ts, srv=SRV):
        return diff_peers(state, srv, parse_peers(peers_text(rows, *srv))[1], ts)

    def key(ch, name):
        return [k for k in ch["keys"] if k["name"] == name][0]

    srv, rows = parse_peers(peers_text([
        ("anna", "203.0.113.5", 1000, 100, 200), ("homeserv", "-", 1000, 5, 5), ("bob", "-", 0, 0, 0),
        ("bad name", "-", 0, 0, 0), ("x'; DROP TABLE users;--", "-", 1, 1, 1), ("carol", "не ip", 1, 2, 3),
        ("dave", "2001:db8::1", 1, 2, 3), ("erin", "-", -5, 1, 1)]) + "мусор без табуляций\nа\tб\n")
    check("peers: сервер и его IP", srv == SRV)
    check("peers: плохие имена, homeserv, минус и мусор отброшены", [r["name"] for r in rows] == ["anna", "bob", "carol", "dave"])
    check("peers: плохой IP клиента -> '-', IPv6 принимается", rows[2]["ip"] == "-" and rows[3]["ip"] == "2001:db8::1")
    check("peers: пустой вывод", parse_peers("") == (None, []))
    st0, ch = step({}, [("anna", "203.0.113.5", t0 - 30, 1000, 2000), ("bob", "-", 0, 0, 0)], t0)
    check("первый запуск только запоминает счётчики", all(k["up"] == 0 and k["down"] == 0 for k in ch["keys"]) and not ch["events"])
    st1, ch = step(st0, [("anna", "203.0.113.5", t0 + 30, 1500, 5000), ("bob", "-", 0, 0, 0)], t0 + 60)
    check("прибавка байт между замерами", (key(ch, "anna")["up"], key(ch, "anna")["down"]) == (500, 3000))
    check("рукопожатие через минуту - не новое подключение", not key(ch, "anna")["connect"] and not ch["events"])
    check("ключ без изменений в запись не попадает", all(k["name"] != "bob" for k in ch["keys"]))
    st2, chC = step(st1, [("anna", "198.51.100.50", t0 + 700, 1600, 5100), ("bob", "-", 0, 0, 0)], t0 + 720)
    ev = {e["kind"]: e for e in chC["events"]}
    check("рукопожатие через 10 минут - новое подключение", key(chC, "anna")["connect"] and ev["connect"]["ts"] == t0 + 700
          and ev["connect"]["new"] == "198.51.100.50")
    check("смена IP клиента записывается", (ev["client_ip"]["old"], ev["client_ip"]["new"]) == ("203.0.113.5", "198.51.100.50"))
    st3, ch = step(st2, [("anna", "-", 0, 10, 20), ("bob", "-", 0, 0, 0)], t0 + 780)
    check("сброс счётчика (перезапуск): прибавка равна текущему значению", (key(ch, "anna")["up"], key(ch, "anna")["down"]) == (10, 20))
    check("IP '-' не затирает последний известный", st3["ips"]["anna"] == "198.51.100.50")
    st4, ch = step(st3, [("anna", "198.51.100.50", t0 + 800, 20, 30), ("bob", "-", 0, 0, 0)], t0 + 840)
    check("первое рукопожатие после перезапуска - подключение", key(ch, "anna")["connect"] and not any(e["kind"] == "client_ip" for e in ch["events"]))
    st5, ch = step(st4, [("anna", "198.51.100.50", t0 + 860, 20, 30), ("carol", "192.0.2.7", t0 + 850, 300, 400)], t0 + 900)
    check("новый ключ: счётчики с нуля, первое подключение", (key(ch, "carol")["up"], key(ch, "carol")["down"], key(ch, "carol")["connect"]) == (300, 400, True))
    check("исчезнувший ключ уходит из состояния", "bob" not in st5["peers"]["основной"] and "bob" not in st5["ips"])
    st6, ch = step(st5, [("anna", "198.51.100.50", t0 + 980, 25, 35)], t0 + 1000, ("основной", "203.0.113.77"))
    e = [x for x in ch["events"] if x["kind"] == "server_ip"]
    check("смена IP сервера - событие для всех ключей", len(e) == 1 and e[0]["key"] is None and (e[0]["old"], e[0]["new"]) == ("198.51.100.7", "203.0.113.77"))
    st7, ch = step(st6, [("anna", "198.51.100.50", t0 + 1100, 40, 60)], t0 + 1120, ("аварийный", "192.0.2.9"))
    check("переключение на аварийный - событие, его счётчики с нуля", [x["kind"] for x in ch["events"]].count("server_switch") == 1
          and key(ch, "anna")["up"] == 40)
    st8, ch = step(st7, [("anna", "198.51.100.50", t0 + 2000, 30, 45)], t0 + 2020, ("основной", "203.0.113.77"))
    check("возврат на основной: разница от его прошлых счётчиков", (key(ch, "anna")["up"], key(ch, "anna")["down"]) == (5, 10))
    check("состояние переживает запись в JSON", json.loads(json.dumps(st8)) == st8)
    sq = build_peers_sql(chC, True)
    check("SQL ключей: пояс UTC, транзакция, upsert, очистка", sq.startswith("SET time_zone='+00:00';\nSTART TRANSACTION;")
          and "ON DUPLICATE KEY UPDATE" in sq and "DELETE FROM key_events" in sq and sq.rstrip().endswith("COMMIT;"))
    check("SQL ключей: два события, байты по часам", sq.count("INSERT INTO key_events") == 2 and "INSERT INTO key_traffic" in sq)
    check("SQL ключей: время рукопожатия без FROM_UNIXTIME", "FROM_UNIXTIME" not in sq and "INTERVAL %d SECOND" % (t0 + 700) in sq)
    sq = build_peers_sql({"server": SRV, "keys": [{"name": "bob", "up": 0, "down": 0, "connect": False, "hs": 0, "ip": "-"}], "events": []}, False)
    check("SQL ключей: без трафика нет записи по часам", "key_traffic" not in sq and "'bob',0,0,0,NULL,NULL,NULL,'основной','198.51.100.7'" in sq)
    check("экранирование кавычек и слэшей", _q("a'b\\c") == "'a\\'b\\\\c'" and _q(None) == "NULL")
    for bad in ({"server": SRV, "keys": [{"name": "a'b", "up": 0, "down": 0, "connect": False, "hs": 0, "ip": "-"}], "events": []},
                {"server": ("ос'нов", "1.2.3.4"), "keys": [], "events": []},
                {"server": SRV, "keys": [], "events": [{"ts": 1, "key": None, "kind": "x", "old": None, "new": None, "server": "a", "server_ip": "-"}]}):
        try:
            build_peers_sql(bad, False)
            rejected = False
        except ValueError:
            rejected = True
        check("SQL ключей: плохие данные отвергаются", rejected)
    check("мегабайты для вывода", mb(1048576) == "1.0 МБ")
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
        collect_peers(now, now.hour == 4 and now.minute == 0, dry)   # в аварийном режиме vampn list молчит, а peers спросит аварийный сервер
        return 1
    values = collect(now, with_status, list_text, status_text)
    cleanup = now.hour == 4 and now.minute == 0
    new_state, alert = evaluate_drop(load_state(), int(now.timestamp()), int(values["users_online"]))
    if dry:
        print("записалось бы (server=%s):" % SERVER)
        for k, v in values.items():
            print("  %-14s %s" % (k, v))
        print("тревога: %s" % (alert or "нет"))
        collect_peers(now, cleanup, True)
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
    collect_peers(now, cleanup, False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
