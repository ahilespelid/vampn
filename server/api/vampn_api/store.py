"""Доступ к базе vampn (Percona/MySQL). Все времена - UTC (naive datetime), сессия подключения в UTC."""
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

import pymysql
from pymysql.constants import CLIENT
from pymysql.cursors import DictCursor

NOTIF_FIELDS = ("email_sent_at", "push_sent_at", "delivered_at", "read_at")


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)


def _in(n: int) -> str:
    return ",".join(["%s"] * n)


class MySQLStore:
    def __init__(self, settings):
        self.s = settings

    @contextmanager
    def _cur(self):
        conn = pymysql.connect(
            host=self.s.db_host, port=self.s.db_port, user=self.s.db_user, password=self.s.db_password,
            database=self.s.db_name, charset="utf8mb4", autocommit=True, cursorclass=DictCursor,
            init_command="SET time_zone='+00:00'", client_flag=CLIENT.FOUND_ROWS, connect_timeout=5, read_timeout=20, write_timeout=20)
        try:
            with conn.cursor() as cur:
                yield cur
        finally:
            conn.close()

    def _one(self, sql, args=()):
        with self._cur() as c:
            c.execute(sql, args)
            return c.fetchone()

    def _all(self, sql, args=()):
        with self._cur() as c:
            c.execute(sql, args)
            return list(c.fetchall())

    def _exec(self, sql, args=()):
        with self._cur() as c:
            c.execute(sql, args)
            return c.lastrowid

    # ---------- пользователи ----------
    def accounts_by_email(self, email):
        return self._all("SELECT id,name,email,role,active FROM users WHERE email=%s AND active=1 ORDER BY id", (email,))

    def get_user(self, name):
        return self._one("SELECT id,name,email,role,active,revoked_at,revoked_reason FROM users WHERE name=%s", (name,))

    def get_user_by_id(self, uid):
        return self._one("SELECT id,name,email,role,active FROM users WHERE id=%s", (uid,))

    def list_users(self):
        return self._all("SELECT id,name,email,role,active,revoked_at,revoked_reason,created_at FROM users ORDER BY id")

    def create_user(self, name, email, role):
        return self._exec("INSERT INTO users (name,email,role,active,in_file) VALUES (%s,%s,%s,1,0)", (name, email, role))

    def restore_user(self, name, email):
        self._exec("UPDATE users SET active=1,revoked_at=NULL,revoked_reason=NULL,email=%s WHERE name=%s", (email, name))

    def set_email(self, name, email):
        self._exec("UPDATE users SET email=%s WHERE name=%s", (email, name))

    def set_role(self, name, role):
        self._exec("UPDATE users SET role=%s WHERE name=%s", (role, name))

    def revoke_user(self, name, reason, now):
        self._exec("UPDATE users SET active=0,revoked_at=%s,revoked_reason=%s WHERE name=%s", (now, reason, name))

    def add_event(self, user_id, event, old, new, source):
        self._exec("INSERT INTO user_events (user_id,event,old_value,new_value,source) VALUES (%s,%s,%s,%s,%s)",
                   (user_id, event, old, new, source))

    def list_events(self, user_id=None, limit=100):
        if user_id is None:
            return self._all("SELECT e.id,u.name,e.event,e.old_value,e.new_value,e.source,e.created_at "
                             "FROM user_events e JOIN users u ON u.id=e.user_id ORDER BY e.id DESC LIMIT %s", (limit,))
        return self._all("SELECT e.id,u.name,e.event,e.old_value,e.new_value,e.source,e.created_at "
                         "FROM user_events e JOIN users u ON u.id=e.user_id WHERE e.user_id=%s ORDER BY e.id DESC LIMIT %s",
                         (user_id, limit))

    # ---------- коды входа ----------
    def count_codes_since(self, email, since):
        return self._one("SELECT COUNT(*) AS n FROM login_codes WHERE email=%s AND created_at>=%s", (email, since))["n"]

    def insert_code(self, email, code_hash, expires_at, ip, now):
        return self._exec("INSERT INTO login_codes (email,code_hash,expires_at,ip,created_at) VALUES (%s,%s,%s,%s,%s)",
                          (email, code_hash, expires_at, ip, now))

    def latest_active_code(self, email, now):
        return self._one("SELECT id,code_hash,attempts,expires_at FROM login_codes "
                         "WHERE email=%s AND used_at IS NULL AND expires_at>%s ORDER BY id DESC LIMIT 1", (email, now))

    def bump_attempt(self, code_id):
        self._exec("UPDATE login_codes SET attempts=attempts+1 WHERE id=%s", (code_id,))
        return self._one("SELECT attempts FROM login_codes WHERE id=%s", (code_id,))["attempts"]

    def mark_code_used(self, code_id, now):
        self._exec("UPDATE login_codes SET used_at=%s WHERE id=%s", (now, code_id))

    # ---------- блокировки ----------
    def get_lock(self, scope, now):
        r = self._one("SELECT locked_until FROM login_attempts WHERE scope_key=%s", (scope,))
        if r and r["locked_until"] and r["locked_until"] > now:
            return r["locked_until"]
        return None

    def lock(self, scope, until, now):
        self._exec("INSERT INTO login_attempts (scope_key,fails,locked_until,updated_at) VALUES (%s,0,%s,%s) "
                   "ON DUPLICATE KEY UPDATE fails=0,locked_until=VALUES(locked_until),updated_at=VALUES(updated_at)",
                   (scope, until, now))

    def add_fail(self, scope, now, limit, lock_seconds, window_seconds=3600):
        r = self._one("SELECT fails,updated_at FROM login_attempts WHERE scope_key=%s", (scope,))
        fails = 0
        if r and r["updated_at"] and r["updated_at"] > now - timedelta(seconds=window_seconds):
            fails = r["fails"]
        fails += 1
        until = None
        if fails >= limit:
            until, fails = now + timedelta(seconds=lock_seconds), 0
        self._exec("INSERT INTO login_attempts (scope_key,fails,locked_until,updated_at) VALUES (%s,%s,%s,%s) "
                   "ON DUPLICATE KEY UPDATE fails=VALUES(fails),locked_until=VALUES(locked_until),updated_at=VALUES(updated_at)",
                   (scope, fails, until, now))
        return until

    def clear_fails(self, scope):
        self._exec("DELETE FROM login_attempts WHERE scope_key=%s", (scope,))

    # ---------- сессии и устройства ----------
    def create_session(self, user_id, device_id, token_hash, expires_at, now):
        return self._exec("INSERT INTO sessions (user_id,device_id,token_hash,created_at,last_used_at,expires_at) "
                          "VALUES (%s,%s,%s,%s,%s,%s)", (user_id, device_id, token_hash, now, now, expires_at))

    def get_session(self, token_hash, now):
        r = self._one("SELECT s.id AS session_id,s.user_id,s.device_id,s.expires_at FROM sessions s "
                      "WHERE s.token_hash=%s AND s.revoked_at IS NULL AND s.expires_at>%s", (token_hash, now))
        if r:
            self._exec("UPDATE sessions SET last_used_at=%s WHERE id=%s", (now, r["session_id"]))
        return r

    def revoke_session(self, token_hash, now):
        self._exec("UPDATE sessions SET revoked_at=%s WHERE token_hash=%s AND revoked_at IS NULL", (now, token_hash))

    def revoke_user_sessions(self, user_ids, now):
        if user_ids:
            self._exec("UPDATE sessions SET revoked_at=%s WHERE revoked_at IS NULL AND user_id IN (" + _in(len(user_ids)) + ")",
                       (now, *user_ids))

    def upsert_device(self, user_id, platform, name, push_token, now):
        self._exec("INSERT INTO devices (user_id,platform,device_name,push_token,last_seen_at) VALUES (%s,%s,%s,%s,%s) "
                   "ON DUPLICATE KEY UPDATE user_id=VALUES(user_id),platform=VALUES(platform),"
                   "device_name=VALUES(device_name),last_seen_at=VALUES(last_seen_at)",
                   (user_id, platform, name, push_token, now))
        r = self._one("SELECT id FROM devices WHERE push_token_hash=SHA2(%s,256)", (push_token,))
        return r["id"]

    def devices_by_email(self, email):
        return self._all("SELECT d.id,d.platform,d.push_token FROM devices d JOIN users u ON u.id=d.user_id WHERE u.email=%s",
                         (email,))

    # ---------- ключи и уведомления ----------
    def add_key(self, user_id, key_name, reason, issued_by, now):
        return self._exec("INSERT INTO `keys` (user_id,key_name,reason,issued_by,issued_at) VALUES (%s,%s,%s,%s,%s)",
                          (user_id, key_name, reason, issued_by, now))

    def list_keys(self, user_ids, limit=100):
        if user_ids is None:
            return self._all("SELECT k.id,u.name AS user_name,k.key_name,k.reason,k.issued_by,k.issued_at "
                             "FROM `keys` k JOIN users u ON u.id=k.user_id ORDER BY k.id DESC LIMIT %s", (limit,))
        if not user_ids:
            return []
        return self._all("SELECT k.id,u.name AS user_name,k.key_name,k.reason,k.issued_by,k.issued_at "
                         "FROM `keys` k JOIN users u ON u.id=k.user_id WHERE k.user_id IN (" + _in(len(user_ids)) +
                         ") ORDER BY k.id DESC LIMIT %s", (*user_ids, limit))

    def add_notification(self, user_id, key_id, kind, title, now):
        return self._exec("INSERT INTO notifications (user_id,key_id,kind,title,created_at) VALUES (%s,%s,%s,%s,%s)",
                          (user_id, key_id, kind, title, now))

    def list_notifications(self, user_ids, limit=100):
        if not user_ids:
            return []
        return self._all("SELECT n.id,u.name AS user_name,n.key_id,n.kind,n.title,n.email_sent_at,n.push_sent_at,"
                         "n.delivered_at,n.read_at,n.created_at FROM notifications n JOIN users u ON u.id=n.user_id "
                         "WHERE n.user_id IN (" + _in(len(user_ids)) + ") ORDER BY n.id DESC LIMIT %s", (*user_ids, limit))

    def recent_key_notification(self, user_id, since):
        """Уведомление о ключе этого пользователя не моложе `since`: его мог завести vampn при отправке письма."""
        return self._one("SELECT id, key_id FROM notifications WHERE user_id=%s AND kind='key' AND created_at >= %s "
                         "ORDER BY id DESC LIMIT 1", (user_id, since))

    def notifications_signature(self, user_ids):
        """Дешёвый отпечаток уведомлений пользователя для потока SSE: меняется, когда уведомление появилось
        или у какого-то из них заполнилась отметка (почта, push, доставлено, прочитано). Поля только заполняются."""
        if not user_ids:
            return (0, 0, 0, 0, 0, 0)
        r = self._one("SELECT COUNT(*) AS n, COALESCE(MAX(id),0) AS last_id, COUNT(email_sent_at) AS e, "
                      "COUNT(push_sent_at) AS p, COUNT(delivered_at) AS d, COUNT(read_at) AS r "
                      "FROM notifications WHERE user_id IN (" + _in(len(user_ids)) + ")", tuple(user_ids))
        return (r["n"], r["last_id"], r["e"], r["p"], r["d"], r["r"])

    def mark_notification(self, notif_id, user_ids, field, now):
        if field not in NOTIF_FIELDS or not user_ids:
            return False
        with self._cur() as c:
            c.execute("UPDATE notifications SET " + field + "=COALESCE(" + field + ",%s) WHERE id=%s AND user_id IN (" +
                      _in(len(user_ids)) + ")", (now, notif_id, *user_ids))
            return c.rowcount > 0

    # ---------- метрики ----------
    def add_metric(self, server, metric, value, labels_json, now):
        self._exec("INSERT INTO metrics (ts,server,metric,value,labels) VALUES (%s,%s,%s,%s,%s)",
                   (now, server, metric, value, labels_json))

    def query_metrics(self, server, metric, since, limit=2000):
        return self._all("SELECT ts,value,labels FROM metrics WHERE server=%s AND metric=%s AND ts>=%s ORDER BY ts LIMIT %s",
                         (server, metric, since, limit))

    # ---------- статистика по ключам (пишет vampn-metrics, здесь только чтение) ----------
    def key_stats_list(self, names=None):
        """Итоги по ключам: все (names=None) или только перечисленные."""
        cols = ("key_name,up_total,down_total,connections,tracked_since,first_seen_at,last_seen_at,"
                "last_client_ip,last_server,last_server_ip")
        if names is None:
            return self._all("SELECT " + cols + " FROM key_stats ORDER BY key_name")
        if not names:
            return []
        return self._all("SELECT " + cols + " FROM key_stats WHERE key_name IN (" + _in(len(names)) + ") ORDER BY key_name",
                         tuple(names))

    def key_traffic_sums(self, names, since):
        """{ключ: (отдал, скачал)} в байтах за часы не раньше `since`; names=None - по всем ключам."""
        if names is not None and not names:
            return {}
        where, args = ("", (since,)) if names is None else (" AND key_name IN (" + _in(len(names)) + ")", (since, *names))
        rows = self._all("SELECT key_name, SUM(up_bytes) AS up, SUM(down_bytes) AS down FROM key_traffic "
                         "WHERE hour>=%s" + where + " GROUP BY key_name", args)
        return {r["key_name"]: (int(r["up"]), int(r["down"])) for r in rows}

    def key_traffic_daily(self, name, since):
        return self._all("SELECT DATE(hour) AS day, SUM(up_bytes) AS up, SUM(down_bytes) AS down FROM key_traffic "
                         "WHERE key_name=%s AND hour>=%s GROUP BY DATE(hour) ORDER BY day", (name, since))

    def key_client_ips(self, name, limit=20):
        """С каких IP подключался ключ: сколько подключений и когда последний раз (подключение или переезд на этот IP)."""
        return self._all("SELECT new_value AS ip, SUM(kind='connect') AS connects, MAX(ts) AS last_at FROM key_events "
                         "WHERE key_name=%s AND kind IN ('connect','client_ip') AND new_value IS NOT NULL "
                         "GROUP BY new_value ORDER BY last_at DESC LIMIT %s", (name, limit))

    def key_events_list(self, name, limit=50):
        """События ключа и общие события сервера (key_name IS NULL: смена IP или сервера), новые первыми."""
        return self._all("SELECT id,ts,key_name,kind,old_value,new_value,server,server_ip FROM key_events "
                         "WHERE key_name=%s OR key_name IS NULL ORDER BY ts DESC, id DESC LIMIT %s", (name, limit))
