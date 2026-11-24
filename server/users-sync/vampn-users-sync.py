#!/usr/bin/env python3
"""vampn-users-sync: двусторонняя синхронизация /etc/vampn/users.conf <-> база vampn (таблица users).

Режимы:
  --selftest   проверка логики на сценариях в памяти (без файла и базы)
  --baseline   один раз: запомнить текущее состояние файла как "последнее синхронизированное"
  --dry-run    показать, что было бы сделано; ничего не пишет и не шлёт
  --apply      выполнить синхронизацию (для таймера)
Пользователи в базе не удаляются: отозванные помечаются active=0, revoked_at, revoked_reason;
история пишется в user_events.
"""
import argparse, fcntl, hashlib, os, re, subprocess, sys, tempfile, time

CONF = "/etc/vampn/users.conf"
CONTAINER = "vampn_percona"
LOCK = "/var/lock/vampn-users-sync.lock"
STATE_DIR = "/var/lib/vampn-sync"
MAX_REMOVALS = 2
QUIET_SECONDS = 5
NAME_RE = re.compile(r"^[A-Za-z0-9._-]{1,32}$")
EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")


# Событие, которое приложение уже записало в историю (source='app') за последние 10 минут:
# синк не пишет второе такое же при подстройке файла под базу.
APP_EVENT_WINDOW = 600
DB_EVENT_KINDS = {"db_created": {"created", "restored"}, "db_restored": {"created", "restored"},
                  "db_revoked": {"revoked"}, "db_email": {"email_changed"}}


def mask(e):
    return "***@" + e.split("@", 1)[1] if e and "@" in e else "***"


# ---------- файл ----------
def parse_file(text):
    """-> (header_lines, users{name:email} в порядке файла, errors[])"""
    header, users, errors, seen_user = [], {}, [], False
    for i, raw in enumerate(text.replace("\r", "").split("\n"), 1):
        s = raw.strip()
        if not seen_user and (s == "" or s.startswith("#")):
            header.append(raw)
            continue
        if s == "" or s.startswith("#"):
            continue
        seen_user = True
        parts = s.split()
        if len(parts) < 2 or not NAME_RE.match(parts[0]) or not EMAIL_RE.match(parts[1]):
            errors.append("строка %d не разобрана" % i)
            continue
        if parts[0] in users:
            errors.append("строка %d: повтор имени %s" % (i, parts[0]))
            continue
        users[parts[0]] = parts[1]
    while header and header[-1].strip() == "":
        header.pop()
    return header, users, errors


# ---------- логика слияния (чистая функция) ----------
def plan(F, D, max_removals=MAX_REMOVALS):
    """F: {name: email} из файла. D: {name: {id,email,active,in_file,file_email,n_events}} из базы."""
    P = {"actions": [], "final": [], "aborts": [], "conflicts": [], "bases": []}
    desired = {}
    order = sorted(D, key=lambda n: D[n]["id"])
    new_names = [n for n in F if n not in D]
    revoked_from_file = set()

    for name in order + new_names:
        d = D.get(name)
        fp = name in F
        fe = F.get(name)
        if d is None:
            P["actions"].append(dict(kind="insert", name=name, new=fe, source="file"))
            desired[name] = (True, fe)
            continue
        bp, be = bool(d["in_file"]), d["file_email"]
        recent = d.get("recent_app") or set()
        fch = (fp != bp) or (fp and fe != be)
        dch = (bool(d["active"]) != bp) or (bool(d["active"]) and d["email"] != be)
        take_db = True
        if fch and dch:
            if (fp == bool(d["active"])) and (not fp or fe == d["email"]):
                desired[name] = (bool(d["active"]), d["email"])
                continue
            P["conflicts"].append(name)
            P["actions"].append(dict(
                kind="conflict", name=name, source="system",
                old="файл: " + (mask(fe) if fp else "строки нет"),
                new="база: " + (("активен " + mask(d["email"])) if d["active"] else "отозван")))
        elif fch:
            take_db = False
        if not take_db:
            if fp:
                if not d["active"]:
                    P["actions"].append(dict(kind="restore", name=name, old=d["email"], new=fe, source="file"))
                elif fe != d["email"]:
                    P["actions"].append(dict(kind="email", name=name, old=d["email"], new=fe, source="file"))
                desired[name] = (True, fe)
            else:
                P["actions"].append(dict(kind="revoke", name=name, old=d["email"], source="file"))
                revoked_from_file.add(name)
                desired[name] = (False, d["email"])
        else:
            if dch:
                if bool(d["active"]) != bp:
                    if d["active"]:
                        kind = "db_restored" if d["n_events"] > 0 else "db_created"
                    else:
                        kind = "db_revoked"
                    P["actions"].append(dict(kind=kind, name=name, new=d["email"], source="db",
                                             skip_event=bool(recent & DB_EVENT_KINDS[kind])))
                elif d["email"] != be:
                    P["actions"].append(dict(kind="db_email", name=name, old=be, new=d["email"], source="db",
                                             skip_event=bool(recent & DB_EVENT_KINDS["db_email"])))
            desired[name] = (bool(d["active"]), d["email"])

    act = {n for n, (a, _e) in desired.items() if a}
    P["final"] = [(n, desired[n][1]) for n in F if n in act] + \
                 [(n, desired[n][1]) for n in order if n in act and n not in F]

    for n, (a, e) in desired.items():
        d = D.get(n)
        want_email = e if a else None
        if d is None or bool(d["in_file"]) != a or d["file_email"] != want_email:
            P["bases"].append((n, a, want_email))

    removed_by_db = [n for n in F if n not in act and n not in revoked_from_file]
    if not F and any(d["active"] for d in D.values()):
        P["aborts"].append("в users.conf нет ни одного пользователя, а в базе они есть")
    if len(revoked_from_file) > max_removals:
        P["aborts"].append("из файла за раз пропало строк: %d (лимит %d)" % (len(revoked_from_file), max_removals))
    if len(removed_by_db) > max_removals:
        P["aborts"].append("из базы за раз отозвано пользователей: %d (лимит %d)" % (len(removed_by_db), max_removals))
    if not P["final"]:
        P["aborts"].append("после слияния не осталось ни одного пользователя")
    return P


def file_needs_write(F, final):
    return dict(final) != dict(F) or len(final) != len(F)


def build_file(header, F, final):
    names = [n for n, _ in final]
    fm = dict(final)
    lines = [n for n in F if n in fm] + [n for n in names if n not in F]
    out = list(header) + [""] + ["%s %s" % (n, fm[n]) for n in lines]
    return "\n".join(out) + "\n"


# ---------- база ----------
def sql(query, fetch=False):
    cmd = ["docker", "exec", "-i", CONTAINER, "sh", "-c",
           'MYSQL_PWD="$MYSQL_PASSWORD" mysql -u"$MYSQL_USER" "$MYSQL_DATABASE" '
           '--default-character-set=utf8mb4 -B -N']
    r = subprocess.run(cmd, input=query, capture_output=True, text=True, timeout=90)
    if r.returncode != 0:
        raise RuntimeError("mysql: " + r.stderr.strip()[:300])
    return [ln.split("\t") for ln in r.stdout.splitlines()] if fetch else None


def q(v):
    if v is None:
        return "NULL"
    v = str(v)
    if not (NAME_RE.match(v) or EMAIL_RE.match(v)):
        raise ValueError("недопустимое значение для SQL")
    return "'" + v + "'"


def load_db():
    rows = sql("SELECT u.id,u.name,u.email,u.active,u.in_file,IFNULL(u.file_email,''),"
               "(SELECT COUNT(*) FROM user_events e WHERE e.user_id=u.id),"
               "IFNULL((SELECT GROUP_CONCAT(DISTINCT e.event) FROM user_events e WHERE e.user_id=u.id AND e.source='app' "
               "AND e.created_at >= UTC_TIMESTAMP() - INTERVAL %d SECOND),'') "
               "FROM users u ORDER BY u.id" % APP_EVENT_WINDOW, fetch=True)
    D = {}
    for r in rows:
        D[r[1]] = dict(id=int(r[0]), email=r[2], active=r[3] == "1", in_file=r[4] == "1",
                       file_email=r[5] or None, n_events=int(r[6]),
                       recent_app=set(x for x in (r[7] if len(r) > 7 else "").split(",") if x))
    return D


def event_sql(name, event, old, new, source):
    return ("INSERT INTO user_events (user_id,event,old_value,new_value,source) "
            "SELECT id,%s,%s,%s,%s FROM users WHERE name=%s;" % (q(event), q(old), q(new), q(source), q(name)))


def phase1_sql(actions):
    s = ["START TRANSACTION;"]
    for a in actions:
        n, k = a["name"], a["kind"]
        if k == "insert":
            s.append("INSERT INTO users (name,email,role,active,in_file) VALUES (%s,%s,'user',1,0);" % (q(n), q(a["new"])))
            s.append(event_sql(n, "created", None, a["new"], a["source"]))
        elif k == "revoke":
            s.append("UPDATE users SET active=0,revoked_at=NOW(),revoked_reason='removed_from_file' WHERE name=%s;" % q(n))
            s.append(event_sql(n, "revoked", a["old"], None, a["source"]))
        elif k == "restore":
            s.append("UPDATE users SET active=1,revoked_at=NULL,revoked_reason=NULL,email=%s WHERE name=%s;" % (q(a["new"]), q(n)))
            s.append(event_sql(n, "restored", a.get("old"), a["new"], a["source"]))
        elif k == "email":
            s.append("UPDATE users SET email=%s WHERE name=%s;" % (q(a["new"]), q(n)))
            s.append(event_sql(n, "email_changed", a["old"], a["new"], a["source"]))
        elif k == "db_created":
            if not a.get("skip_event"):
                s.append(event_sql(n, "created", None, a["new"], "db"))
        elif k == "db_restored":
            s.append("UPDATE users SET revoked_at=NULL,revoked_reason=NULL WHERE name=%s;" % q(n))
            if not a.get("skip_event"):
                s.append(event_sql(n, "restored", None, a["new"], "db"))
        elif k == "db_revoked":
            s.append("UPDATE users SET revoked_at=IFNULL(revoked_at,NOW()),revoked_reason=IFNULL(revoked_reason,'revoked_in_db') WHERE name=%s;" % q(n))
            if not a.get("skip_event"):
                s.append(event_sql(n, "revoked", None, None, "db"))
        elif k == "db_email":
            if not a.get("skip_event"):
                s.append(event_sql(n, "email_changed", a.get("old"), a["new"], "db"))
        elif k == "conflict":
            s.append("INSERT INTO user_events (user_id,event,old_value,new_value,source) SELECT id,'conflict',%s,%s,'system' FROM users WHERE name=%s;"
                     % ("'" + a["old"].replace("'", "") .replace("\\", "") + "'", "'" + a["new"].replace("'", "").replace("\\", "") + "'", q(n)))
    s.append("COMMIT;")
    return "\n".join(s) + "\n"


def phase3_sql(bases):
    s = ["START TRANSACTION;"]
    for n, a, e in bases:
        s.append("UPDATE users SET in_file=%d,file_email=%s WHERE name=%s;" % (1 if a else 0, q(e), q(n)))
    s.append("COMMIT;")
    return "\n".join(s) + "\n"


# ---------- вывод / уведомления ----------
def describe(a):
    k, n = a["kind"], a["name"]
    t = {"insert": "ДОБАВИТЬ в базу", "revoke": "ОТОЗВАТЬ в базе (строка пропала из файла)",
         "restore": "ВОССТАНОВИТЬ в базе", "email": "СМЕНИТЬ почту в базе",
         "db_created": "в базе новый пользователь -> добавить строку в файл",
         "db_restored": "в базе восстановлен -> добавить строку в файл",
         "db_revoked": "в базе отозван -> убрать строку из файла",
         "db_email": "в базе сменили почту -> обновить файл",
         "conflict": "КОНФЛИКТ (побеждает база)"}[k]
    extra = ""
    if a.get("new") and "@" in str(a.get("new")):
        extra = " -> " + mask(a["new"])
    if k == "conflict":
        extra = " [%s; %s]" % (a["old"], a["new"])
    return "  %-12s %s%s" % (n, t, extra)


def alert(text, dry):
    if dry:
        print("[ALERT, не отправлено в dry-run] " + text)
        return
    os.makedirs(STATE_DIR, exist_ok=True)
    h = hashlib.sha256(text.encode()).hexdigest()
    p = os.path.join(STATE_DIR, "last_alert")
    try:
        if open(p).read().strip() == h:
            return
    except OSError:
        pass
    subprocess.run(["/usr/local/bin/tgsend", "alerts", "vampn-users-sync: " + text], timeout=60)
    open(p, "w").write(h)


def clear_alert():
    try:
        os.remove(os.path.join(STATE_DIR, "last_alert"))
    except OSError:
        pass


def log(line):
    os.makedirs(STATE_DIR, exist_ok=True)
    with open(os.path.join(STATE_DIR, "sync.log"), "a") as f:
        f.write(time.strftime("%F %T ") + line + "\n")


# ---------- режимы ----------
def run(conf_path, dry):
    if not dry:
        age = time.time() - os.stat(conf_path).st_mtime
        if age < QUIET_SECONDS:
            print("файл менялся %.0f с назад, пропуск тика" % age)
            return 0
    text = open(conf_path, encoding="utf-8").read()
    header, F, errors = parse_file(text)
    if errors:
        alert("users.conf не разобран, синхронизация остановлена: " + "; ".join(errors[:5]), dry)
        print("ОСТАНОВЛЕНО:", "; ".join(errors))
        return 2
    D = load_db()
    P = plan(F, D)
    print("файл: %d польз.; база: %d записей (активных %d)" % (len(F), len(D), sum(1 for d in D.values() if d["active"])))
    for a in P["actions"]:
        print(describe(a))
    if P["aborts"]:
        msg = "синхронизация остановлена: " + "; ".join(P["aborts"])
        alert(msg, dry)
        print("ОСТАНОВЛЕНО:", "; ".join(P["aborts"]))
        return 2
    write_needed = file_needs_write(F, P["final"])
    print("запись в базу: %s; перезапись файла: %s; обновить базовое состояние: %d"
          % ("да" if any(True for _ in P["actions"]) else "нет", "да" if write_needed else "нет", len(P["bases"])))
    if not P["actions"] and not write_needed and not P["bases"]:
        print("изменений нет")
        clear_alert()
        return 0
    if dry:
        return 0
    if P["actions"]:
        sql(phase1_sql(P["actions"]))
    if write_needed:
        new_text = build_file(header, F, P["final"])
        st = os.stat(conf_path)
        fd, tmp = tempfile.mkstemp(prefix=".users.conf.", dir=os.path.dirname(conf_path))
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(new_text)
        os.chmod(tmp, st.st_mode & 0o777)
        os.chown(tmp, st.st_uid, st.st_gid)
        os.replace(tmp, conf_path)
    if P["bases"]:
        sql(phase3_sql(P["bases"]))
    log("ok: действий %d, файл %s, баз %d" % (len(P["actions"]), "переписан" if write_needed else "не менялся", len(P["bases"])))
    if P["conflicts"]:
        alert("конфликт файл/база, победила база: " + ", ".join(P["conflicts"]), False)
    else:
        clear_alert()
    return 0


def baseline(conf_path):
    text = open(conf_path, encoding="utf-8").read()
    _h, F, errors = parse_file(text)
    if errors:
        print("файл не разобран:", errors)
        return 2
    D = load_db()
    s = ["START TRANSACTION;"]
    n_base = n_ev = 0
    for name, d in D.items():
        if name in F and F[name] == d["email"] and d["active"]:
            if not d["in_file"] or d["file_email"] != d["email"]:
                s.append("UPDATE users SET in_file=1,file_email=%s WHERE name=%s;" % (q(d["email"]), q(name)))
                n_base += 1
        if d["n_events"] == 0:
            s.append(event_sql(name, "created", None, d["email"], "system"))
            n_ev += 1
    mism = [n for n in D if D[n]["active"] and (n not in F or F[n] != D[n]["email"])] + [n for n in F if n not in D]
    if mism:
        print("ВНИМАНИЕ: файл и база различаются для:", ", ".join(mism), "- baseline для них не ставится")
    s.append("COMMIT;")
    sql("\n".join(s) + "\n")
    print("baseline: пользователей %d, начальных событий %d" % (n_base, n_ev))
    return 0


def selftest():
    def row(i, name, email, active=True, in_file=True, ev=1, app=()):
        return name, dict(id=i, email=email, active=active, in_file=in_file,
                          file_email=email if in_file else None, n_events=ev, recent_app=set(app))

    def base():
        return dict([row(1, "a", "a@x.ru"), row(2, "b", "b@x.ru"), row(3, "c", "c@x.ru")])
    Fb = lambda: {"a": "a@x.ru", "b": "b@x.ru", "c": "c@x.ru"}
    fails = []

    def check(title, cond):
        print("  %-62s %s" % (title, "OK" if cond else "ОШИБКА"))
        if not cond:
            fails.append(title)

    kinds = lambda P: sorted((a["kind"], a["name"]) for a in P["actions"])
    P = plan(Fb(), base())
    check("без изменений: ничего не делать", not P["actions"] and not P["aborts"] and not P["bases"])
    F = Fb(); F["d"] = "d@x.ru"
    P = plan(F, base())
    check("в файл добавили d -> insert d, d в итоговом файле", kinds(P) == [("insert", "d")] and ("d", "d@x.ru") in P["final"])
    F = Fb(); del F["b"]
    P = plan(F, base())
    check("из файла убрали b -> revoke b, не удаляется", kinds(P) == [("revoke", "b")] and "b" not in dict(P["final"]))
    F = Fb(); F["a"] = "new@x.ru"
    P = plan(F, base())
    check("в файле сменили почту a -> email a", kinds(P) == [("email", "a")])
    D = base(); D["c"]["active"] = False
    P = plan(Fb(), D)
    check("в базе отозвали c -> строка c уйдёт из файла", kinds(P) == [("db_revoked", "c")] and "c" not in dict(P["final"]) and file_needs_write(Fb(), P["final"]))
    D = base(); D.update([row(4, "e", "e@x.ru", True, False, 0)])
    P = plan(Fb(), D)
    check("в базе новый e -> строка e добавится в файл", kinds(P) == [("db_created", "e")] and ("e", "e@x.ru") in P["final"])
    D = base(); D["a"]["email"] = "dbnew@x.ru"
    P = plan(Fb(), D)
    check("в базе сменили почту a -> файл обновится", kinds(P) == [("db_email", "a")] and dict(P["final"])["a"] == "dbnew@x.ru")
    F = Fb(); del F["a"]
    D = base(); D["a"]["email"] = "dbnew@x.ru"
    P = plan(F, D)
    check("конфликт (файл убрал a, база сменила почту): побеждает база", P["conflicts"] == ["a"] and dict(P["final"]).get("a") == "dbnew@x.ru")
    D = base(); D.update([row(5, "z", "z@x.ru", False, False, 2)])
    F = Fb(); F["z"] = "z@x.ru"
    P = plan(F, D)
    check("вернули строку отозванного z -> restore, не новый", ("restore", "z") in kinds(P) and ("insert", "z") not in kinds(P))
    F = Fb(); del F["b"]
    D = base(); D["b"]["active"] = False
    P = plan(F, D)
    check("и файл и база убрали b одновременно -> без конфликта", not P["conflicts"] and not [a for a in P["actions"] if a["kind"] == "conflict"])
    P = plan({}, base())
    check("пустой файл -> остановка", bool(P["aborts"]))
    F = {"a": "a@x.ru"}
    P = plan(F, base())
    check("из файла пропало 2 строки -> проходит", not P["aborts"])
    D = dict([row(i, "u%d" % i, "u%d@x.ru" % i) for i in range(1, 6)])
    F = {"u1": "u1@x.ru", "u2": "u2@x.ru"}
    P = plan(F, D)
    check("из файла пропало 3 строки -> остановка", bool(P["aborts"]))
    D = dict([row(i, "u%d" % i, "u%d@x.ru" % i) for i in range(1, 6)])
    F = {"u%d" % i: "u%d@x.ru" % i for i in range(1, 6)}
    for i in (1, 2, 3):
        D["u%d" % i]["active"] = False
    P = plan(F, D)
    check("в базе отозвали 3 за раз -> остановка", bool(P["aborts"]))
    h, F, er = parse_file("# c\n\na a@x.ru\nb b@x.ru\nbad\n")
    check("битая строка в файле замечается", bool(er))
    F = Fb(); F["d"] = "d@x.ru"; del F["b"]
    P = plan(F, base())
    txt = build_file(["# c"], F, P["final"])
    check("собранный файл: заголовок, пользователи, \\n в конце",
          txt.startswith("# c\n\n") and txt.endswith("\n") and "b@x.ru" not in txt and "d d@x.ru" in txt)
    skip = lambda P: sorted((a["kind"], a["name"], a.get("skip_event")) for a in P["actions"])
    D = base(); D.update([row(4, "e", "e@x.ru", True, False, 1, ("created",))])
    P = plan(Fb(), D)
    check("пользователя добавило приложение -> файл обновится, второе событие не пишется",
          skip(P) == [("db_restored", "e", True)] and ("e", "e@x.ru") in P["final"]
          and "INSERT INTO user_events" not in phase1_sql(P["actions"]))
    D = base(); D.update([row(4, "e", "e@x.ru", True, False, 0)])
    P = plan(Fb(), D)
    check("пользователя добавили прямо в базе -> событие пишется",
          skip(P) == [("db_created", "e", False)] and "INSERT INTO user_events" in phase1_sql(P["actions"]))
    D = base(); D["c"]["active"] = False; D["c"]["recent_app"] = {"revoked"}
    P = plan(Fb(), D)
    check("отзыв из приложения -> строка уйдёт из файла, второе событие не пишется",
          skip(P) == [("db_revoked", "c", True)] and "c" not in dict(P["final"])
          and "INSERT INTO user_events" not in phase1_sql(P["actions"])
          and "UPDATE users SET revoked_at" in phase1_sql(P["actions"]))
    D = base(); D["c"]["active"] = False; D["c"]["recent_app"] = {"email_changed"}
    P = plan(Fb(), D)
    check("отзыв в базе при свежей смене почты из приложения -> событие отзыва пишется", skip(P) == [("db_revoked", "c", False)])
    D = base(); D["a"]["email"] = "dbnew@x.ru"; D["a"]["recent_app"] = {"email_changed"}
    P = plan(Fb(), D)
    check("почту сменили в приложении -> файл обновится, второе событие не пишется",
          skip(P) == [("db_email", "a", True)] and dict(P["final"])["a"] == "dbnew@x.ru")
    print("selftest: %s" % ("все проверки пройдены" if not fails else "ОШИБКИ: %d" % len(fails)))
    return 0 if not fails else 1


def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--selftest", action="store_true")
    g.add_argument("--baseline", action="store_true")
    g.add_argument("--dry-run", action="store_true")
    g.add_argument("--apply", action="store_true")
    ap.add_argument("--file", default=CONF, help="только с --dry-run: читать другой файл")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    if a.file != CONF and not a.dry_run:
        print("--file разрешён только с --dry-run")
        return 2
    lk = open(LOCK, "w")
    try:
        fcntl.flock(lk, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        print("уже выполняется")
        return 0
    if a.baseline:
        return baseline(a.file)
    return run(a.file, dry=a.dry_run)


if __name__ == "__main__":
    sys.exit(main())
