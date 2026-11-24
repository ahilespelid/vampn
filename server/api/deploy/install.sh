#!/bin/bash
# Шаг 2: установка vampn API на homeserv. Ничего существующего не перезаписывает:
# новые каталоги, пакет python3-venv, окружение, sudoers, служба и один новый сайт в Caddy.
# Секреты берутся из файлов на сервере и в вывод не попадают.
set -euo pipefail

SRC=/root/vampn-api-src.tar
APP=/var/www/vampn/api
ENVF=/etc/vampn-api/api.env
UNIT=/etc/systemd/system/vampn-api.service
SUDOERS=/etc/sudoers.d/vampn-api
SITE=/etc/caddy/sites.d/vampn-api.caddy
PORT=8741
GW=$(docker network inspect litewms_net --format '{{range .IPAM.Config}}{{.Gateway}}{{end}}')
echo "адрес API (шлюз litewms_net): $GW:$PORT"
[ -n "$GW" ] || { echo "нет шлюза litewms_net, стоп"; exit 1; }
[ -f "$SRC" ] || { echo "нет $SRC, стоп"; exit 1; }
id vampn >/dev/null

echo "== 1. python3-venv"
if ! python3 -c 'import ensurepip' 2>/dev/null; then
  apt-get install -y python3-venv >/tmp/vampn-apt.log 2>&1 || { apt-get update >>/tmp/vampn-apt.log 2>&1 && apt-get install -y python3-venv >>/tmp/vampn-apt.log 2>&1; }
  tail -n 3 /tmp/vampn-apt.log
fi
python3 -c 'import ensurepip;print("ensurepip: есть")'

echo "== 2. код в $APP"
install -d -o root -g vampn -m 750 "$APP"
tar -xf "$SRC" -C "$APP"
chown -R root:vampn "$APP"
find "$APP" -type d -exec chmod 750 {} +
find "$APP" -type f -exec chmod 640 {} +
ls "$APP"

echo "== 3. venv и зависимости"
if [ ! -x "$APP/.venv/bin/python" ]; then python3 -m venv "$APP/.venv"; fi
"$APP/.venv/bin/pip" install -q --disable-pip-version-check -r "$APP/requirements.txt"
"$APP/.venv/bin/pip" list --format=freeze 2>/dev/null | grep -iE '^(fastapi|uvicorn|pymysql)=='
chown -R root:vampn "$APP/.venv"; chmod -R g+rX,o-rwx "$APP/.venv"

echo "== 4. окружение $ENVF"
if [ -f "$ENVF" ]; then
  echo "уже есть, не трогаю"
else
  install -d -o root -g vampn -m 750 /etc/vampn-api
  get() { grep -m1 "^$1=" "$2" | cut -d= -f2- || true; }
  TLS=$(get SMTP_TLS /etc/vampn/secrets.env | tr -d "\"'" | tr 'A-Z' 'a-z')
  PORTV=$(get SMTP_PORT /etc/vampn/secrets.env | tr -d "\"'")
  case "$TLS" in ssl|starttls|none) ;; *) if [ "$PORTV" = "465" ]; then TLS=ssl; elif [ "$PORTV" = "587" ]; then TLS=starttls; else TLS=ssl; fi ;; esac
  {
    echo "DB_HOST=127.0.0.1"
    echo "DB_PORT=3307"
    echo "DB_USER=$(get MYSQL_USER /var/www/vampn/.env)"
    echo "DB_PASSWORD=$(get MYSQL_PASSWORD /var/www/vampn/.env)"
    echo "DB_NAME=$(get MYSQL_DATABASE /var/www/vampn/.env)"
    echo "API_SECRET=$(openssl rand -hex 32)"
    echo "SMTP_HOST=$(get SMTP_HOST /etc/vampn/secrets.env)"
    echo "SMTP_PORT=${PORTV:-465}"
    echo "SMTP_TLS=$TLS"
    echo "SMTP_USER=$(get SMTP_USER /etc/vampn/secrets.env)"
    echo "SMTP_PASS=$(get SMTP_PASS /etc/vampn/secrets.env)"
    echo "MAIL_FROM=$(get MAIL_FROM /etc/vampn/secrets.env)"
    echo "VAMPN_BIN=/usr/local/sbin/vampn"
    echo "COMMAND_TIMEOUT=420"
  } > "$ENVF.new"
  chown root:vampn "$ENVF.new"; chmod 640 "$ENVF.new"; mv "$ENVF.new" "$ENVF"
fi
echo "ключи в окружении и заполнены ли они (значения скрыты):"
sed -E 's/^([A-Z_]+)=(.*)$/\1 \2/' "$ENVF" | awk '{ printf "  %-14s %s\n", $1, ($2=="" ? "ПУСТО" : "заполнено") }'
echo "SMTP_TLS=$(grep -m1 '^SMTP_TLS=' "$ENVF" | cut -d= -f2-) SMTP_PORT=$(grep -m1 '^SMTP_PORT=' "$ENVF" | cut -d= -f2-)"

echo "== 5. sudoers"
cat > /tmp/vampn-api.sudoers <<'EOF'
# /etc/sudoers.d/vampn-api: пользователь vampn запускает ТОЛЬКО эти подкоманды vampn (проверка visudo -cf).
# Имена пользователей дополнительно проверяет API (латиница, цифры, _ . -, до 32 символов).
Cmnd_Alias VAMPN_API = /usr/local/sbin/vampn status, \
                       /usr/local/sbin/vampn server, \
                       /usr/local/sbin/vampn list, \
                       /usr/local/sbin/vampn rotate, \
                       /usr/local/sbin/vampn rotate --force, \
                       /usr/local/sbin/vampn reboot, \
                       /usr/local/sbin/vampn reboot hard, \
                       /usr/local/sbin/vampn emergency on, \
                       /usr/local/sbin/vampn emergency off, \
                       /usr/local/sbin/vampn emergency status, \
                       /usr/local/sbin/vampn link [a-zA-Z0-9_.-]*, \
                       /usr/local/sbin/vampn resend [a-zA-Z0-9_.-]*, \
                       /usr/local/sbin/vampn reissue [a-zA-Z0-9_.-]*
vampn ALL=(root) NOPASSWD: VAMPN_API
EOF
visudo -cf /tmp/vampn-api.sudoers
install -o root -g root -m 440 /tmp/vampn-api.sudoers "$SUDOERS"
rm -f /tmp/vampn-api.sudoers
visudo -c 2>&1 | tail -2
echo "проверка прав vampn: разрешённое должно сработать, запрещённое быть отклонено"
sudo -u vampn sudo -n /usr/local/sbin/vampn emergency status >/dev/null 2>&1 && echo "  emergency status: разрешено (ок)" || echo "  emergency status: ОТКАЗ (плохо)"
sudo -u vampn sudo -n /usr/local/sbin/vampn mirror >/dev/null 2>&1 && echo "  mirror: РАЗРЕШЕНО (плохо)" || echo "  mirror: отклонено (ок)"
sudo -u vampn sudo -n /bin/true >/dev/null 2>&1 && echo "  /bin/true: РАЗРЕШЕНО (плохо)" || echo "  /bin/true: отклонено (ок)"

echo "== 6. служба"
cat > "$UNIT" <<EOF
[Unit]
Description=vampn API (FastAPI)
After=network-online.target docker.service
Wants=docker.service
StartLimitIntervalSec=0

[Service]
User=vampn
Group=vampn
WorkingDirectory=$APP
EnvironmentFile=$ENVF
ExecStart=$APP/.venv/bin/uvicorn vampn_api.asgi:app --host $GW --port $PORT --no-proxy-headers
Restart=always
RestartSec=5
NoNewPrivileges=false
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now vampn-api.service
sleep 4
systemctl is-active vampn-api.service
journalctl -u vampn-api.service -n 6 --no-pager | cut -c1-180
echo "проверка с хоста:"
curl -sS -m 8 "http://$GW:$PORT/health"; echo
echo "проверка из контейнера caddy:"
docker exec caddy wget -qO- -T 8 "http://$GW:$PORT/health"; echo
echo "запрос кода для несуществующей почты (проверка базы; письмо не уходит):"
curl -sS -m 15 -X POST "http://$GW:$PORT/v1/auth/request" -H 'Content-Type: application/json' -d '{"email":"install-check@invalid.example"}'; echo
echo "без токена статус закрыт:"
curl -sS -m 8 -o /dev/null -w '  GET /v1/status без токена -> %{http_code}\n' "http://$GW:$PORT/v1/status"
echo "слушает:"; ss -ltn | grep ":$PORT" || true

echo "== 7. Caddy: новый сайт vamp.new.litewms.ru"
if [ -e "$SITE" ]; then
  echo "файл сайта уже есть, не трогаю"
else
  cat > "$SITE" <<EOF
# vamp.new.litewms.ru: API мобильного приложения vampn (служба vampn-api на хосте, шлюз litewms_net).
vamp.new.litewms.ru {
	encode gzip
	reverse_proxy $GW:$PORT
}
EOF
  if docker exec caddy caddy validate --config /etc/caddy/Caddyfile >/tmp/vampn-caddy-validate.log 2>&1; then
    docker exec caddy caddy reload --config /etc/caddy/Caddyfile
    echo "Caddy перезагружен (мягко)"
  else
    echo "Caddy НЕ принял конфиг, файл сайта убираю:"; tail -n 5 /tmp/vampn-caddy-validate.log
    rm -f "$SITE"; exit 1
  fi
fi
echo "ожидание сертификата и проверка по HTTPS (до 90 секунд):"
ok=0
for i in $(seq 1 18); do
  code=$(curl -sS -m 10 -o /dev/null -w '%{http_code}' https://vamp.new.litewms.ru/health 2>/dev/null || true)
  if [ "$code" = "200" ]; then ok=1; break; fi
  sleep 5
done
if [ "$ok" = 1 ]; then echo "  https://vamp.new.litewms.ru/health -> 200"; curl -sS -m 10 https://vamp.new.litewms.ru/health; echo; else echo "  HTTPS пока не отвечает (код $code), смотри: docker logs caddy --tail 30"; fi
echo "== готово"
