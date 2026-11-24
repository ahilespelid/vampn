#!/bin/bash
# Чинит DNS в контейнере Caddy: добавляет dns 1.1.1.1 и 8.8.8.8 в /etc/caddy/docker-compose.yml и пересоздаёт контейнер.
# Копия compose в /srv/backups/current; при неудаче compose возвращается из копии.
set -uo pipefail
F=/etc/caddy/docker-compose.yml
BK=/srv/backups/current/caddy-docker-compose.yml.before-dns-20261124

sites() { grep -hE '^[A-Za-z0-9*][A-Za-z0-9.*-]*(,? [A-Za-z0-9.*-]+)* \{$' /etc/caddy/sites.d/*.caddy | tr -d '{,' | tr ' ' '\n' | grep -vE '^\*|^$' | sort -u; }
snapshot() { for h in $(sites); do printf '%s %s\n' "$h" "$(curl -sk -m 8 -o /dev/null -w '%{http_code}' --resolve $h:443:127.0.0.1 https://$h/ 2>/dev/null)"; done; }

grep -q '^    dns:' "$F" && { echo "dns уже есть в compose, стоп"; exit 1; }
echo "== состояние сайтов ДО"; snapshot > /tmp/caddy-before.txt; cat /tmp/caddy-before.txt

cp -a "$F" "$BK"; echo "копия: $BK"
python3 - "$F" <<'EOF'
import sys
p = sys.argv[1]
lines = open(p, encoding="utf-8").read().split("\n")
out, done = [], False
for ln in lines:
    out.append(ln)
    if not done and ln == "    restart: unless-stopped":
        out += ["    dns:", "      - 1.1.1.1", "      - 8.8.8.8"]
        done = True
if not done:
    sys.exit("не нашла строку restart в compose")
open(p, "w", encoding="utf-8").write("\n".join(out))
EOF
echo "изменение compose:"; diff "$BK" "$F"
docker compose -f "$F" config -q && echo "compose валиден" || { echo "compose невалиден, возвращаю"; cp -a "$BK" "$F"; exit 1; }

echo "== пересоздание Caddy"
docker compose -f "$F" up -d caddy 2>&1 | tail -5
sleep 8
docker ps --filter name=caddy --format '{{.Names}} {{.Status}}'
if ! docker ps --filter name=caddy --filter status=running -q | grep -q .; then
  echo "Caddy не запустился, возвращаю прежний compose"; cp -a "$BK" "$F"; docker compose -f "$F" up -d caddy 2>&1 | tail -3; exit 1
fi
echo "== DNS из контейнера теперь"
docker exec caddy nslookup acme-v02.api.letsencrypt.org 2>&1 | grep -E 'SERVFAIL|^Address: ' | tail -2

echo "== состояние сайтов ПОСЛЕ"; snapshot > /tmp/caddy-after.txt; cat /tmp/caddy-after.txt
echo "== что изменилось"; diff /tmp/caddy-before.txt /tmp/caddy-after.txt && echo "коды ответов те же"

echo "== сертификат для vamp.new.litewms.ru (до 120 секунд)"
ok=0
for i in $(seq 1 24); do
  code=$(curl -sS -m 10 -o /dev/null -w '%{http_code}' https://vamp.new.litewms.ru/health 2>/dev/null || true)
  [ "$code" = "200" ] && { ok=1; break; }
  sleep 5
done
if [ "$ok" = 1 ]; then echo "  https://vamp.new.litewms.ru/health -> 200"; curl -sS -m 10 https://vamp.new.litewms.ru/health; echo
else echo "  пока нет (код $code). Логи:"; docker logs caddy --since 3m 2>&1 | grep -i 'vamp' | cut -c1-260 | tail -6; fi
echo "ошибок DNS в логах за последние 3 минуты: $(docker logs caddy --since 3m 2>&1 | grep -c 'server misbehaving')"
echo "== готово"
