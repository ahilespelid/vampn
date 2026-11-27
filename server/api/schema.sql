-- vampn: схема базы vampn (Percona 8.4 / MySQL 8, utf8mb4). Секреты и конфиги ключей в базе не хранятся.
-- Применено на homeserv: vampn-db-schema.sql + vampn-db-sync-schema.sh (поля revoked_*, in_file, file_email и user_events).
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name           VARCHAR(64)  NOT NULL,
  email          VARCHAR(255) NOT NULL,
  role           ENUM('admin','user') NOT NULL DEFAULT 'user',
  active         TINYINT(1)   NOT NULL DEFAULT 1,
  revoked_at     TIMESTAMP    NULL,
  revoked_reason VARCHAR(64)  NULL,
  in_file        TINYINT(1)   NOT NULL DEFAULT 0,
  file_email     VARCHAR(255) NULL,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_name (name),
  KEY ix_users_email (email)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS devices (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id         INT UNSIGNED NOT NULL,
  platform        ENUM('android','ios') NOT NULL,
  device_name     VARCHAR(128) NULL,
  push_token      VARCHAR(512) NOT NULL,
  push_token_hash CHAR(64) AS (SHA2(push_token, 256)) STORED,
  last_seen_at    TIMESTAMP NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_devices_token (push_token_hash),
  KEY ix_devices_user (user_id),
  CONSTRAINT fk_devices_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS login_codes (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email       VARCHAR(255) NOT NULL,
  code_hash   CHAR(64)     NOT NULL,
  attempts    TINYINT UNSIGNED NOT NULL DEFAULT 0,
  expires_at  TIMESTAMP    NOT NULL,
  used_at     TIMESTAMP    NULL,
  ip          VARCHAR(45)  NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_codes_email_created (email, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS login_attempts (
  scope_key    VARCHAR(255) NOT NULL,
  fails        INT UNSIGNED NOT NULL DEFAULT 0,
  locked_until TIMESTAMP    NULL,
  updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (scope_key)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sessions (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      INT UNSIGNED NOT NULL,
  device_id    INT UNSIGNED NULL,
  token_hash   CHAR(64)     NOT NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TIMESTAMP    NULL,
  expires_at   TIMESTAMP    NOT NULL,
  revoked_at   TIMESTAMP    NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sessions_token (token_hash),
  KEY ix_sessions_user (user_id),
  CONSTRAINT fk_sessions_user   FOREIGN KEY (user_id)   REFERENCES users(id)   ON DELETE CASCADE,
  CONSTRAINT fk_sessions_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `keys` (
  id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id   INT UNSIGNED NOT NULL,
  key_name  VARCHAR(128) NOT NULL,
  reason    ENUM('created','reissued','resent') NOT NULL DEFAULT 'created',
  issued_by VARCHAR(64)  NOT NULL DEFAULT 'system',
  issued_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_keys_user_issued (user_id, issued_at),
  CONSTRAINT fk_keys_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notifications (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id       INT UNSIGNED NOT NULL,
  key_id        BIGINT UNSIGNED NULL,
  kind          ENUM('key','alert','info') NOT NULL DEFAULT 'key',
  title         VARCHAR(255) NOT NULL,
  email_sent_at TIMESTAMP NULL,
  push_sent_at  TIMESTAMP NULL,
  delivered_at  TIMESTAMP NULL,
  read_at       TIMESTAMP NULL,
  error         VARCHAR(512) NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_notif_user_created (user_id, created_at),
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_notif_key  FOREIGN KEY (key_id)  REFERENCES `keys`(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS metrics (
  id     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ts     TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  server VARCHAR(32) NOT NULL,
  metric VARCHAR(64) NOT NULL,
  value  DOUBLE      NOT NULL,
  labels JSON        NULL,
  PRIMARY KEY (id),
  KEY ix_metrics_lookup (server, metric, ts)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_events (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    INT UNSIGNED NOT NULL,
  event      ENUM('created','email_changed','revoked','restored','role_changed','conflict') NOT NULL,
  old_value  VARCHAR(255) NULL,
  new_value  VARCHAR(255) NULL,
  source     ENUM('file','db','app','system') NOT NULL DEFAULT 'system',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_events_user (user_id, created_at),
  CONSTRAINT fk_events_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- Статистика по ключам. Ключ = имя пользователя VPN (как в vampn list). Пишет vampn-metrics раз в минуту из `vampn peers`
-- (server/metrics), приложение только читает. Секретов нет: ни публичных ключей, ни конфигов. Применять можно повторно.
-- Учёт идёт с первого запуска сборщика: что было раньше, неизвестно. Время везде UTC.
CREATE TABLE IF NOT EXISTS key_stats (
  key_name       VARCHAR(64)  NOT NULL,
  up_total       BIGINT UNSIGNED NOT NULL DEFAULT 0,   -- принято от клиента, байт (его отдача) с начала учёта
  down_total     BIGINT UNSIGNED NOT NULL DEFAULT 0,   -- отправлено клиенту, байт (его загрузка) с начала учёта
  connections    INT UNSIGNED NOT NULL DEFAULT 0,      -- сколько раз подключался (новое рукопожатие после паузы больше 5 минут)
  tracked_since  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  first_seen_at  TIMESTAMP    NULL,                    -- первое замеченное рукопожатие
  last_seen_at   TIMESTAMP    NULL,                    -- последнее рукопожатие
  last_client_ip VARCHAR(45)  NULL,
  last_server    VARCHAR(16)  NULL,                    -- основной, запасной или аварийный
  last_server_ip VARCHAR(45)  NULL,
  updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (key_name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS key_traffic (    -- байты по ключу по часам, хранится 90 дней
  key_name   VARCHAR(64) NOT NULL,
  hour       TIMESTAMP   NOT NULL,
  up_bytes   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  down_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (key_name, hour),
  KEY ix_traffic_hour (hour)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS key_events (     -- подключения и переезды, хранится 90 дней
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ts         TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  key_name   VARCHAR(64) NULL,                -- NULL: событие всего сервера, касается всех ключей
  kind       ENUM('connect','client_ip','server_ip','server_switch') NOT NULL,
  old_value  VARCHAR(64) NULL,                -- client_ip: прежний IP клиента; server_ip: прежний IP сервера; server_switch: прежний сервер
  new_value  VARCHAR(64) NULL,                -- connect: IP клиента при подключении
  server     VARCHAR(16) NULL,
  server_ip  VARCHAR(45) NULL,
  PRIMARY KEY (id),
  KEY ix_kev_key (key_name, ts),
  KEY ix_kev_ts (ts)
) ENGINE=InnoDB;
