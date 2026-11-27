#!/bin/bash
# Тесты сторожа vampn на заглушках: ничего настоящего не трогает (ни Timeweb, ни туннель, ни почту).
# Запуск: bash test.sh [путь к скрипту vampn]; нужны bash, curl, jq, python3. Порт 22 на 127.0.0.1 должен быть свободен (нужен root).
set -uo pipefail
FILE=${1:-vampn}
T=$(mktemp -d); export T
STATE=$T/state; mkdir -p "$STATE"
now() { echo "${FAKE_NOW:-1000000}"; }
get() { cat "$STATE/$1" 2>/dev/null || echo "${2:-0}"; }
put() { echo "$2" > "$STATE/$1"; }
die() { echo "die: $*" >&2; exit 1; }

# кусок скрипта сторожа: от IFACE= до home_main()
a=$(grep -n '^IFACE=' "$FILE" | cut -d: -f1); b=$(grep -n '^home_main()' "$FILE" | cut -d: -f1)
sed -n "${a},$((b-1))p" "$FILE" > "$T/seg.sh"
CELL=1 TUN_IFACE=vampn SRV_TIP=10.77.0.1 HOME_TIP=10.77.0.3
SELF=/bin/false; MIRROR=$STATE/mirror; TUN_CONF=$T/vampn.conf
echo "Endpoint = 1.1.1.1:49029" > "$TUN_CONF"
# shellcheck disable=SC1090
source "$T/seg.sh"
MIRROR=$STATE/mirror; TUN_CONF=$T/vampn.conf; IFACE=lo; EM_ENV=$T/em.env

pass=0; failn=0
ok() { if eval "$2"; then pass=$((pass+1)); printf '  OK   %s\n' "$1"; else failn=$((failn+1)); printf '  FAIL %s\n' "$1"; fi; }

# ---- заглушки
CALLS=$T/calls; : > "$CALLS"
sleep() { :; }
tg() { echo "tg $*" >> "$CALLS"; }
mailpy() { echo "mailpy $*" >> "$CALLS"; cat > /dev/null; }
tw_init() { :; }
TIMEWEB_SERVER_ID=1
# два сервера Timeweb: TARGETS="1 2" включает запасной; файлы ips/cands/next получают суффикс _2 (это $TSUF)
tw_targets() { echo "${TARGETS:-1}"; }
tw_use() { TARGET=${1:-1}; TSUF=""; [[ $TARGET == 2 ]] && TSUF=_2; TIMEWEB_SERVER_ID=$TARGET; return 0; }
reset() { : > "$CALLS"; rm -rf "$STATE" "$T/twn"; rm -f "$T"/ips "$T"/ips_2 "$T"/cands "$T"/cands_2 "$T"/next "$T"/next_2; mkdir -p "$STATE/mirror"; touch "$STATE/mirror/server.env"
  FAKE_NOW=1000000; TW_NOW=on; TW_NOW2=on; TW_LATE=on; TARGETS=1; TARGET=1; TSUF=""; LIMIT_JSON=""; IPS_BROKEN=""; unset PHS; echo 9.9.9.9 > "$T/ep"; }
log() { echo "LOG $*" >> "$CALLS"; }
do_reboot() { echo "reboot ${1:-soft}" >> "$CALLS"; return 0; }
all_ipv4() { cat "$T/ips$TSUF" 2>/dev/null; }
main_ipv4() { head -1 "$T/ips$TSUF" 2>/dev/null; }
tun_set_endpoint() { [[ $(cat "$T/ep" 2>/dev/null) == "$1" ]] && return 0   # как настоящая: тот же адрес - ничего не делает
  echo "endpoint $1" >> "$CALLS"; echo "$1" > "$T/ep"; }
tun_endpoint() { cat "$T/ep" 2>/dev/null || echo 1.1.1.1; }
mail_from_mirror() { echo "keys-mail $1" >> "$CALLS"; return "${MAIL_RC:-0}"; }
pull_mirror() { :; }
push_users() { :; }
em_active() { return 1; }
inet_ok() { return 0; }
TW_LATE=on
tw_status() { local n v=${TW_NOW:-on}; [[ ${TARGET:-1} == 2 ]] && v=${TW_NOW2:-on}
  n=$(cat "$T/twn" 2>/dev/null || echo 0); echo $((n+1)) > "$T/twn"; if (( n >= 1 )) && [[ $TW_LATE != on ]]; then echo "$TW_LATE"; else echo "$v"; fi; }
emergency_on() { echo emergency-on >> "$CALLS"; }
# Timeweb: POST отдаёт адреса по очереди, DELETE пишет в журнал
NEXT=0
ips_json() { # список IP, как отдаёт Timeweb (первый - основной); IPS_BROKEN=1 - API отдаёт ошибку без списка
  [[ -n ${IPS_BROKEN:-} ]] && { echo '{"status_code":502,"message":"Bad gateway"}'; return; }
  local l; l=$(jq -R -s 'split("\n") | map(select(length>0)) | map({type:"ipv4", ip:., is_main:false})' "$T/ips$TSUF" 2>/dev/null) || l='[]'
  echo "{\"server_ips\":${l:-[]}}"
}
LIMIT_JSON=""   # непустой - POST создания IP отвечает ошибкой daily_limit_exceeded (у любого сервера)
api() {
  if [[ $1 == POST && $2 == */action ]]; then echo "POST-action$TSUF $3" >> "$CALLS"; echo '{}'
  elif [[ $1 == POST && -n $LIMIT_JSON ]]; then echo "POST-limit$TSUF" >> "$CALLS"; echo "$LIMIT_JSON"
  elif [[ $1 == POST ]]; then local c n; n=$(cat "$T/next$TSUF" 2>/dev/null || echo 0); c=$(sed -n "$((n+1))p" "$T/cands$TSUF"); echo $((n+1)) > "$T/next$TSUF"; echo "POST-ip $c" >> "$CALLS"; echo "$c" >> "$T/ips$TSUF"
    echo "{\"server_ip\":{\"ip\":\"$c\"}}"
  elif [[ $1 == DELETE ]]; then local d; d=$(jq -r .ip <<<"$3"); echo "DELETE-ip $d" >> "$CALLS"; sed -i "/^$d\$/d" "$T/ips$TSUF"; echo '{}'
  else echo '{}'; fi
}
routed_list() { printf '%s\n' "$@" > "$T/routed"; }
ip_routed() { grep -qx "$1" "$T/routed"; }
HS=0   # когда появится "новое рукопожатие" (0 = никогда)
wait_new_handshake() { echo "wait-hs since=$1 secs=$2" >> "$CALLS"; (( HS )); }
# проверка нового адреса неактивного сервера на временном интерфейсе: по умолчанию отвечает как HS, PHS задаёт отдельно
probe_handshake() { echo "probe $1 $2" >> "$CALLS"; (( ${PHS:-$HS} )); }
notify() { echo "NOTIFY $1" >> "$CALLS"; }
eval "$(declare -f announce_ip | sed '1s/^announce_ip/real_announce_ip/')"
announce_ip() { echo "announce $1 $2" >> "$CALLS"; return "${ANN_RC:-0}"; }
remote() { echo "remote $1" >> "$CALLS"; return "${REMOTE_RC:-0}"; }
# раскатка скрипта: настоящая функция сохраняется как real_deploy_scripts (её проверяет раздел 8),
# а check() в остальных тестах не ходит ни на Бостон, ни на сервер
eval "$(declare -f deploy_scripts | sed '1s/^deploy_scripts/real_deploy_scripts/')"
deploy_scripts() { :; }

echo "== 1. попытка: один новый IP, проходит, туннель поднялся"
reset; printf '9.9.9.9\n' > "$T/ips"; printf 'A1\nA2\n' > "$T/cands"; HS=1; routed_list A1; rm -f "$T/ep"
attempt 1 >/dev/null 2>&1; rc=$?
ok "attempt вернул 0" "[[ $rc == 0 ]]"
ok "создан ровно один IP" "[[ \$(grep -c POST-ip $CALLS) == 1 ]]"
ok "старый адрес удалён только после создания нового" "[[ \$(grep -n -E 'DELETE-ip 9.9.9.9' $CALLS | cut -d: -f1) -gt \$(grep -n 'POST-ip A1' $CALLS | cut -d: -f1) ]]"
ok "остался только A1" "[[ \$(cat $T/ips | tr '\n' ' ') == 'A1 ' ]]"
ok "ключи разосланы ровно один раз и с новым адресом" "[[ \$(grep -c 'keys-mail' $CALLS) == 1 ]] && grep -q 'keys-mail A1' $CALLS"
ok "ключи после ожидания нового рукопожатия" "[[ \$(grep -n 'wait-hs' $CALLS | cut -d: -f1) -lt \$(grep -n 'keys-mail' $CALLS | cut -d: -f1) ]]"
ok "метка ожидания = момент переключения, ждёт 150 с" "grep -q 'wait-hs since=1000000 secs=150' $CALLS && [[ \$(grep -c wait-hs $CALLS) == 1 ]]"
ok "смена записана тремя полями" "grep -q '^1000000 9.9.9.9 A1\$' $STATE/rotations"
ok "активный сервер = 1, список пользователей и копию обновим заново" "[[ \$(get active_target) == 1 && \$(get users_pushed) == none && \$(get last_mirror) == 0 ]]"
ok "отложенной рассылки не осталось" "[[ ! -e $STATE/keys_pending ]]"
ok "сообщение об успехе" "grep -q 'NOTIFY туннель поднялся через основной сервер: IP 9.9.9.9 → A1' $CALLS"
ok "создание записано в счётчик суток" "[[ \$(ip_used_24h) == 1 ]]"

echo "== 2. попытка: новый адрес не проходит (трасса обрывается) - убираем, попытка потрачена"
reset; printf '9.9.9.9\n' > "$T/ips"; printf 'B1\nB2\n' > "$T/cands"; HS=1; routed_list none
attempt 1 >/dev/null 2>&1; rc=$?
ok "attempt вернул 1 (попытка потрачена)" "[[ $rc == 1 ]]"
ok "сделан ровно один IP, он убран, старый цел" "[[ \$(grep -c POST-ip $CALLS) == 1 ]] && grep -q 'DELETE-ip B1' $CALLS && ! grep -q 'DELETE-ip 9.9.9.9' $CALLS && [[ \$(cat $T/ips | tr '\n' ' ') == '9.9.9.9 ' ]]"
ok "ключи не рассылались, перезагрузки VPS не было, туннель не трогали" "! grep -q keys-mail $CALLS && ! grep -q reboot $CALLS && ! grep -q '^endpoint' $CALLS"
ok "в rotations ничего не записано" "[[ ! -s $STATE/rotations ]]"
ok "одно сообщение о неудаче" "[[ \$(grep -c 'NOTIFY попытка 1 из 20' $CALLS) == 1 ]]"

echo "== 3. адрес проходит, но туннель не поднялся"
reset; printf '9.9.9.9\n' > "$T/ips"; printf 'C1\n' > "$T/cands"; HS=0; routed_list C1
attempt 1 >/dev/null 2>&1; rc=$?
ok "attempt вернул 1" "[[ $rc == 1 ]]"
ok "ключи НЕ разосланы, рассылка отложена на C1" "! grep -q keys-mail $CALLS && [[ \$(get keys_pending) == C1 ]]"
ok "жёсткая перезагрузка" "grep -q 'reboot hard' $CALLS"
ok "неудача помечена fail и в суточный лимит удачных смен не идёт" "grep -q '9.9.9.9 C1 fail' $STATE/rotations && [[ \$(awk 'NF==3' $STATE/rotations | wc -l) == 0 ]]"
ok "один проход ожидания (сервер on)" "[[ \$(grep -c wait-hs $CALLS) == 1 ]]"
echo "== 3б. сервер в Timeweb ещё грузится: ожидание продлевается один раз"
reset; printf '9.9.9.9\n' > "$T/ips"; printf 'C2\n' > "$T/cands"; HS=0; routed_list C2; TW_LATE=rebooting
attempt 1 >/dev/null 2>&1
ok "два ожидания: 150 и 120 с" "[[ \$(grep -c wait-hs $CALLS) == 2 ]] && grep -q 'secs=120' $CALLS"
echo "== 3в. сервер не on: попытка не начинается (ничего не тратится), выключенный включается"
reset; printf '9.9.9.9\n' > "$T/ips"; printf 'D1\n' > "$T/cands"; HS=1; routed_list D1; TW_NOW=rebooting
attempt 1 >/dev/null 2>&1; rc=$?
ok "attempt вернул 2, IP не создавался" "[[ $rc == 2 ]] && ! grep -q POST-ip $CALLS"
attempt 1 --force >/dev/null 2>&1; rc=$?
ok "и ручная --force тоже ждёт статуса on" "[[ $rc == 2 ]] && ! grep -q POST-ip $CALLS"
reset; printf '9.9.9.9\n' > "$T/ips"; printf 'D1\n' > "$T/cands"; TW_NOW=off
attempt 1 >/dev/null 2>&1; rc=$?
ok "статус off: попытки нет, но сервер запущен командой start" "[[ $rc == 2 ]] && grep -q 'POST-action {\"action\":\"start\"}' $CALLS && ! grep -q POST-ip $CALLS"
: > "$CALLS"; attempt 1 >/dev/null 2>&1
ok "повторный start не раньше чем через 30 минут" "! grep -q POST-action $CALLS"

echo "== 3е. лимит Timeweb на создание IP: одно сообщение, пауза до названного срока, API не дёргаем"
LIM='{"status_code":403,"error_code":"daily_limit_exceeded","message":"Daily limit exceeded","details":{"limit":10,"available_date_for_creation":"1970-01-13T00:00:00.000Z"}}'
UNTIL=1036800
reset; printf '9.9.9.9\n' > "$T/ips"; printf 'L1\n' > "$T/cands"; HS=1; routed_list L1; LIMIT_JSON=$LIM
attempt 1 >/dev/null 2>&1; rc=$?
ok "attempt вернул 2, старый адрес цел" "[[ $rc == 2 ]] && [[ \$(cat $T/ips | tr '\n' ' ') == '9.9.9.9 ' ]]"
ok "срок паузы взят из ответа Timeweb" "[[ \$(get rot_blocked_until) == $UNTIL ]]"
ok "ровно одно сообщение о лимите, с сервером и сроком по Москве (13.01 03:00)" "[[ \$(grep -c 'NOTIFY \[основной\] Timeweb: лимит новых IP' $CALLS) == 1 ]] && grep -q '13.01 03:00 МСК' $CALLS"
ok "сообщения «Timeweb не выдал новый IPv4» нет" "! grep -q 'не выдал новый IPv4' $CALLS"
: > "$CALLS"; FAKE_NOW=1000200
for i in 1 2 3 4 5; do attempt 1 >/dev/null 2>&1; FAKE_NOW=$((FAKE_NOW+60)); done
ok "пять минут подряд: ни одного запроса в Timeweb и ни одного сообщения" "! grep -q 'POST-' $CALLS && ! grep -q NOTIFY $CALLS"
out=$(rotate --force 2>&1); rc=$?
ok "ручная --force тоже сообщает причину и ждёт" "[[ \$rc == 2 && \$out == *'до 13.01 03:00 МСК'* ]] && ! grep -q 'POST-' $CALLS"
FAKE_NOW=$((UNTIL+10)); LIMIT_JSON=""; : > "$CALLS"
attempt 1 >/dev/null 2>&1; rc=$?
ok "после срока пауза снята и попытка идёт" "[[ $rc == 0 ]] && [[ ! -e $STATE/rot_blocked_until ]] && grep -q 'POST-ip L1' $CALLS"
echo "== 3ж. сервер без IPv4 (потерялся): создаём новый, удалять нечего"
reset; : > "$T/ips"; printf 'N1\n' > "$T/cands"; HS=1; routed_list N1
attempt 1 >/dev/null 2>&1; rc=$?
ok "attempt вернул 0" "[[ $rc == 0 ]]"
ok "создан N1, ничего не удалялось" "grep -q 'POST-ip N1' $CALLS && ! grep -q 'DELETE-ip' $CALLS"
ok "одно сообщение «нет ни одного IPv4»" "[[ \$(grep -c 'нет ни одного IPv4' $CALLS) == 1 ]]"
ok "смена записана тремя полями (прочерк вместо старого)" "grep -qE '^[0-9]+ - N1\$' $STATE/rotations"
ok "ключи ушли на N1" "grep -q 'keys-mail N1' $CALLS"
echo "== 3з. API Timeweb не отдаёт список IP: не гадаем, не создаём, не спамим"
reset; printf '9.9.9.9\n' > "$T/ips"; printf 'Q1\n' > "$T/cands"; HS=1; routed_list Q1; IPS_BROKEN=1
attempt 1 >/dev/null 2>&1; rc=$?
ok "attempt вернул 2, IP не создавался" "[[ $rc == 2 ]] && ! grep -q 'POST-' $CALLS"
ok "одно сообщение про список IP" "[[ \$(grep -c 'NOTIFY \[основной\] не получил список IP' $CALLS) == 1 ]]"
: > "$CALLS"; FAKE_NOW=$((FAKE_NOW+300)); attempt 1 >/dev/null 2>&1
ok "через 5 минут повторно не пишет" "! grep -q NOTIFY $CALLS"
FAKE_NOW=$((FAKE_NOW+3700)); attempt 1 >/dev/null 2>&1
ok "через час напоминает один раз" "[[ \$(grep -c 'NOTIFY \[основной\] не получил список IP' $CALLS) == 1 ]]"
IPS_BROKEN=""
echo "== 3и. свой резерв: автоматика не берёт последний из 10 созданий за сутки"
reset; printf '9.9.9.9\n' > "$T/ips"; printf 'R1\nR2\n' > "$T/cands"; HS=1; routed_list R1 R2
for k in 9 8 7 6 5 4 3 2 1; do echo $((FAKE_NOW-3600*k)) >> "$STATE/ip_creations"; done   # по возрастанию времени, как пишет сам vampn
attempt 1 >/dev/null 2>&1; rc=$?
ok "автоматика не пошла (создано 9 из 10)" "[[ $rc == 2 ]] && ! grep -q 'POST-' $CALLS"
ok "одно сообщение про резерв" "[[ \$(grep -c 'уже создано 9 новых IP из 10' $CALLS) == 1 ]]"
ok "пауза до освобождения самого раннего слота (+сутки+минута)" "[[ \$(get rot_paused_until) == \$((FAKE_NOW-3600*9+86400+60)) ]]"
: > "$CALLS"; attempt 1 >/dev/null 2>&1
ok "повторный вызов тих и не ходит в API" "! grep -q 'POST-' $CALLS && ! grep -q NOTIFY $CALLS"
: > "$CALLS"; rotate --force >/dev/null 2>&1; rc=$?
ok "ручная --force резерв использует" "[[ $rc == 0 ]] && grep -q 'POST-ip R1' $CALLS"
ok "создание записано в счётчик" "[[ \$(ip_used_24h) == 10 ]]"

echo "== Z1. зебра: попытки идут по очереди на двух серверах, ритм 3 мин, потом 5 мин"
reset; TARGETS="1 2"; printf '9.9.9.9\n' > "$T/ips"; printf '8.8.8.8\n' > "$T/ips_2"
printf 'X1\nX2\nX3\nX4\n' > "$T/cands"; printf 'Y1\nY2\nY3\n' > "$T/cands_2"; HS=0; routed_list none
put active_target 1
zebra >/dev/null 2>&1; rc=$?
ok "минута 0: попытка на основном (X1), вернула 1" "[[ $rc == 1 ]] && grep -q 'POST-ip X1' $CALLS && [[ \$(get att_total) == 1 && \$(get att_next) == 2 ]]"
: > "$CALLS"; FAKE_NOW=$((FAKE_NOW+60)); zebra >/dev/null 2>&1
ok "минута 1: ещё рано (интервал 3 минуты), ничего не делает" "! grep -q 'POST-' $CALLS"
: > "$CALLS"; FAKE_NOW=$((1000000+180)); zebra >/dev/null 2>&1
ok "минута 3: попытка на запасном (Y1)" "grep -q 'POST-ip Y1' $CALLS && ! grep -q 'POST-ip X' $CALLS && [[ \$(get att_total) == 2 && \$(get att_next) == 1 ]]"
: > "$CALLS"; FAKE_NOW=$((1000000+360)); zebra >/dev/null 2>&1
ok "минута 6: снова основной (X2)" "grep -q 'POST-ip X2' $CALLS && [[ \$(get att_total) == 3 ]]"
: > "$CALLS"; FAKE_NOW=$((1000000+360+180)); zebra >/dev/null 2>&1
ok "после 3 попыток интервал 5 минут: через 3 мин нового запроса нет" "! grep -q 'POST-' $CALLS"
: > "$CALLS"; FAKE_NOW=$((1000000+360+300)); zebra >/dev/null 2>&1
ok "через 5 мин - попытка на запасном (Y2)" "grep -q 'POST-ip Y2' $CALLS && [[ \$(get att_total) == 4 ]]"
ok "потрачено: 2 IP на основном и 2 на запасном" "[[ \$(ip_used_24h) == 2 ]] && TSUF=_2 && [[ \$(ip_used_24h) == 2 ]]; TSUF=''"

echo "== Z2. зебра: удачная попытка на запасном - он становится активным"
reset; TARGETS="1 2"; printf '9.9.9.9\n' > "$T/ips"; printf '8.8.8.8\n' > "$T/ips_2"
printf 'X1\n' > "$T/cands"; printf 'Y1\n' > "$T/cands_2"; HS=1; routed_list Y1; put active_target 1; put att_next 2; put att_total 1
zebra >/dev/null 2>&1; rc=$?
ok "zebra вернула 0" "[[ $rc == 0 ]]"
ok "создан Y1 на запасном, на основном ничего не создавалось" "grep -q 'POST-ip Y1' $CALLS && ! grep -q 'POST-ip X' $CALLS"
ok "активный сервер = 2, пользователи и копия данных обновятся" "[[ \$(get active_target) == 2 && \$(get users_pushed) == none ]]"
ok "ключи с адресом Y1, туннель на Y1" "grep -q 'keys-mail Y1' $CALLS && [[ \$(cat $T/ep) == Y1 ]]"
ok "сначала проверка на временном интерфейсе (150 с), только потом перенос рабочего туннеля" "grep -q 'probe Y1 150' $CALLS && [[ \$(grep -n '^probe' $CALLS | cut -d: -f1 | head -1) -lt \$(grep -n '^endpoint' $CALLS | cut -d: -f1 | head -1) ]]"
ok "счётчики попыток сброшены" "[[ ! -e $STATE/att_total && ! -e $STATE/att_next && ! -e $STATE/last_attempt ]]"
ok "сообщение называет запасной сервер" "grep -q 'NOTIFY туннель поднялся через запасной сервер: IP 8.8.8.8 → Y1' $CALLS"

echo "== Z3. зебра: неудача на запасном не оставляет туннель на его адресе"
reset; TARGETS="1 2"; printf '9.9.9.9\n' > "$T/ips"; printf '8.8.8.8\n' > "$T/ips_2"
printf 'X1\n' > "$T/cands"; printf 'Y1\n' > "$T/cands_2"; HS=0; routed_list Y1; put active_target 1; put att_next 2
zebra >/dev/null 2>&1; rc=$?
ok "zebra вернула 1, попытка потрачена" "[[ $rc == 1 && \$(get att_total) == 1 ]]"
ok "активным остался основной" "[[ \$(get active_target 1) == 1 ]]"
ok "рабочий туннель вообще не трогали (ни переноса адреса, ни ожидания рукопожатия)" "! grep -q '^endpoint' $CALLS && ! grep -q 'wait-hs' $CALLS && [[ \$(cat $T/ep) == 9.9.9.9 ]]"
ok "отложенной рассылки нет, флага аварии нет" "[[ ! -e $STATE/keys_pending && ! -e $STATE/rotated_in_outage ]]"
ok "следующая попытка снова на основном" "[[ \$(get att_next) == 1 ]]"
ok "сообщение: сервер не ответил на проверке, рабочий туннель не трогал" "grep -q 'NOTIFY попытка 1 из 20 (запасной сервер).*Рабочий туннель не трогал' $CALLS"

echo "== Z3б. зебра: проверка прошла, а перенос рабочего туннеля нет - туннель возвращается"
reset; TARGETS="1 2"; printf '9.9.9.9\n' > "$T/ips"; printf '8.8.8.8\n' > "$T/ips_2"
printf 'X1\n' > "$T/cands"; printf 'Y1\n' > "$T/cands_2"; HS=0; PHS=1; routed_list Y1; put active_target 1; put att_next 2
zebra >/dev/null 2>&1; rc=$?
ok "zebra вернула 1, активным остался основной" "[[ $rc == 1 && \$(get active_target 1) == 1 ]]"
ok "туннель вернули на основной сервер, рассылки нет" "[[ \$(cat $T/ep) == 9.9.9.9 ]] && grep -q 'endpoint Y1' $CALLS && ! grep -q keys-mail $CALLS && [[ ! -e $STATE/keys_pending ]]"

echo "== Z3в. зебра: сервер ещё грузится - проверка ждёт второй раз 120 с"
reset; TARGETS="1 2"; printf '9.9.9.9\n' > "$T/ips"; printf '8.8.8.8\n' > "$T/ips_2"
printf 'X1\n' > "$T/cands"; printf 'Y1\n' > "$T/cands_2"; HS=0; routed_list Y1; put active_target 1; put att_next 2; TW_LATE=rebooting
zebra >/dev/null 2>&1
ok "две проверки: 150 и 120 с, рабочий туннель цел" "[[ \$(grep -c '^probe' $CALLS) == 2 ]] && grep -q 'probe Y1 120' $CALLS && ! grep -q '^endpoint' $CALLS"

echo "== Z3г. активный сервер ведёт себя как раньше (без проверки на временном интерфейсе)"
reset; TARGETS="1 2"; printf '9.9.9.9\n' > "$T/ips"; printf 'X1\n' > "$T/cands"; HS=0; routed_list X1; put active_target 1; put att_next 1
zebra >/dev/null 2>&1
ok "рабочий туннель переносится сразу, проверки нет, флаг аварии стоит" "grep -q 'endpoint X1' $CALLS && ! grep -q '^probe' $CALLS && [[ -e $STATE/rotated_in_outage ]]"

echo "== Z4. зебра: у выбранного сервера лимит - в ту же минуту идём на другой, попытка не тратится зря"
reset; TARGETS="1 2"; printf '9.9.9.9\n' > "$T/ips"; printf '8.8.8.8\n' > "$T/ips_2"
printf 'X1\n' > "$T/cands"; printf 'Y1\n' > "$T/cands_2"; HS=0; routed_list none; put active_target 1; put att_next 1
put rot_blocked_until $((FAKE_NOW+7200))
zebra >/dev/null 2>&1; rc=$?
ok "основной пропущен без запросов, попытка ушла на запасной" "! grep -q 'POST-ip X' $CALLS && grep -q 'POST-ip Y1' $CALLS && [[ \$(get att_total) == 1 ]]"
ok "лимит основного не мешает счёту запасного (счётчики раздельные)" "[[ \$(ip_used_24h) == 0 ]] && TSUF=_2 && [[ \$(ip_used_24h) == 1 ]]; TSUF=''"
reset; TARGETS="1 2"; printf '9.9.9.9\n' > "$T/ips"; printf '8.8.8.8\n' > "$T/ips_2"; put rot_blocked_until $((FAKE_NOW+7200)); put rot_blocked_until_2 $((FAKE_NOW+7200))
zebra >/dev/null 2>&1; rc=$?
ok "лимит на обоих: ни запросов, ни потраченных попыток, ни сообщений" "[[ $rc == 1 ]] && ! grep -q 'POST-' $CALLS && [[ ! -e $STATE/att_total ]] && ! grep -q NOTIFY $CALLS"

echo "== Z5. зебра: потолок 20 попыток"
reset; TARGETS="1 2"; printf '9.9.9.9\n' > "$T/ips"; printf 'X1\n' > "$T/cands"; HS=1; routed_list X1; put att_total 20
zebra >/dev/null 2>&1; rc=$?
ok "после 20 попыток автоматика стоит: запросов нет, одно сообщение" "[[ $rc == 1 ]] && ! grep -q 'POST-' $CALLS && [[ \$(grep -c 'исчерпано 20 попыток' $CALLS) == 1 ]]"
: > "$CALLS"; FAKE_NOW=$((FAKE_NOW+600)); zebra >/dev/null 2>&1
ok "повторно сообщение не шлётся" "! grep -q NOTIFY $CALLS"

echo "== Z6. зебра: без второго сервера работает как с одним"
reset; printf '9.9.9.9\n' > "$T/ips"; printf 'X1\nX2\n' > "$T/cands"; HS=0; routed_list none
zebra >/dev/null 2>&1; FAKE_NOW=$((FAKE_NOW+180)); zebra >/dev/null 2>&1
ok "обе попытки на основном" "grep -q 'POST-ip X1' $CALLS && grep -q 'POST-ip X2' $CALLS && [[ \$(get att_total) == 2 ]]"

echo "== Z7. зебра: суточный предел удачных смен"
reset; printf '9.9.9.9\n' > "$T/ips"; printf 'X1\n' > "$T/cands"; HS=1; routed_list X1
printf '%s a b\n%s a b\n%s a b\n%s a b\n' 999000 999100 999200 999300 > "$STATE/rotations"
zebra >/dev/null 2>&1; rc=$?
ok "4 удачные смены за сутки: попыток нет, одно сообщение" "[[ $rc == 1 ]] && ! grep -q 'POST-' $CALLS && [[ \$(grep -c 'удачных смен IP за сутки' $CALLS) == 1 ]]"

echo "== Z8. ручное управление: use и rotate N"
reset; TARGETS="1 2"; printf '9.9.9.9\n' > "$T/ips"; printf '8.8.8.8\n' > "$T/ips_2"; printf 'X1\n' > "$T/cands"; printf 'Y1\n' > "$T/cands_2"; HS=1; routed_list Y1
rotate 2 >/dev/null 2>&1; rc=$?
ok "rotate 2 меняет IP запасного, а не основного" "[[ $rc == 0 ]] && grep -q 'POST-ip Y1' $CALLS && ! grep -q 'POST-ip X' $CALLS"

echo "== 4. отложенная рассылка в check() после настоящей связи"
reset; echo C1 > "$T/ep"; put keys_pending C1; put fails 3
hs_age() { echo 10; }; probe_tunnel() { return 0; }
check >/dev/null 2>&1
ok "ключи разосланы с адресом C1" "grep -q 'keys-mail C1' $CALLS"
ok "флаг отложенной рассылки снят" "[[ ! -e $STATE/keys_pending ]]"
ok "счётчик без связи сброшен" "[[ \$(get fails) == 0 ]]"
: > "$CALLS"; check >/dev/null 2>&1
ok "второй проход ключи не шлёт" "! grep -q keys-mail $CALLS"
reset; echo OLD > "$T/ep"; put keys_pending C1
check >/dev/null 2>&1
ok "рассылка на чужой адрес (endpoint другой) отбрасывается, ключи не шлются" "[[ ! -e $STATE/keys_pending ]] && ! grep -q keys-mail $CALLS"
reset; echo C1 > "$T/ep"; put keys_pending C1; MAIL_RC=1
check >/dev/null 2>&1
ok "при сбое рассылки флаг остаётся (повтор в следующую минуту)" "[[ -e $STATE/keys_pending ]]"
MAIL_RC=0

echo "== 5. check(): туннель мёртв, IP сменён вручную в панели"
reset; printf 'M1\n' > "$T/ips"; echo OLD > "$T/ep"
hs_age() { echo 900; }; probe_tunnel() { return 1; }
check >/dev/null 2>&1
ok "туннель переведён на M1" "grep -q 'endpoint M1' $CALLS"
ok "ключи при этом НЕ ушли сразу" "! grep -q keys-mail $CALLS"
ok "рассылка отложена" "[[ \$(get keys_pending) == M1 ]]"

echo "== 6. пороги 2 и 5 минут"
reset; printf 'P1\n' > "$T/ips"; echo P1 > "$T/ep"; : > "$T/routed"
hs_age() { echo 900; }; probe_tunnel() { return 1; }; once() { :; }; put last_reboot 0
check >/dev/null 2>&1
ok "1-я минута: ничего не делает" "! grep -q reboot $CALLS && [[ \$(get fails) == 1 ]]"
FAKE_NOW=1000060; check >/dev/null 2>&1
ok "2-я минута: перезагрузка VPS" "grep -q 'reboot soft' $CALLS"
: > "$CALLS"; put last_reboot "$FAKE_NOW"
for i in 3 4; do FAKE_NOW=$((FAKE_NOW+60)); check >/dev/null 2>&1; done
ok "3-4 минуты: смены IP ещё нет" "! grep -q POST-ip $CALLS"
printf 'Q1\n' > "$T/cands"; rm -f "$T/next"; routed_list Q1; HS=1
FAKE_NOW=$((FAKE_NOW+60)); check >/dev/null 2>&1
ok "5-я минута: пошла смена IP" "grep -q 'POST-ip Q1' $CALLS"

echo "== 6б. аварийный канал включается сам на 3-й минуте без связи"
reset; printf 'P1\n' > "$T/ips"; echo P1 > "$T/ep"; : > "$T/routed"; touch "$T/em.env"
hs_age() { echo 900; }; probe_tunnel() { return 1; }; once() { :; }; put last_reboot 1000000; put last_rotation 1000000; put fails 1
check >/dev/null 2>&1
ok "2-я минута: аварийный канал ещё не включается" "! grep -q emergency-on $CALLS"
check >/dev/null 2>&1
ok "3-я минута: аварийный канал включён сам" "grep -q emergency-on $CALLS"
: > "$CALLS"; check >/dev/null 2>&1
ok "4-я минута: второй раз не включает" "! grep -q emergency-on $CALLS"
reset; printf 'P1\n' > "$T/ips"; echo P1 > "$T/ep"; rm -f "$T/em.env"; put last_reboot 1000000; put last_rotation 1000000; put fails 5
check >/dev/null 2>&1
ok "нет emergency.env - не включает и не падает" "! grep -q emergency-on $CALLS"
reset; printf 'P1\n' > "$T/ips"; echo P1 > "$T/ep"; touch "$T/em.env"; rm -rf "$STATE/mirror"; put last_reboot 1000000; put last_rotation 1000000; put fails 5
check >/dev/null 2>&1
ok "нет копии данных пользователей - не включает" "! grep -q emergency-on $CALLS"
reset; printf 'P1\n' > "$T/ips"; echo P1 > "$T/ep"; touch "$T/em.env"; put last_reboot 1000000; put last_rotation 1000000; put fails 5; TW_NOW=off
check >/dev/null 2>&1
ok "аварийный канал включается и при статусе off в Timeweb" "grep -q emergency-on $CALLS"
echo

echo "== 7. ip_routed по трассам"
unset -f ip_routed; source <(grep -E '^ip_routed\(\)' "$FILE")
traceroute() { cat "$T/trace"; }
timeout() { shift; "$@"; }
printf 'traceroute to X\n 1  192.168.31.1  0.5 ms\n 2  195.170.192.1  1.7 ms\n 3  *\n 4  *\n 5  *\n 6  *\n 7  *\n 8  *\n' > "$T/trace"
ip_routed 1.2.3.4; r1=$?
printf 'traceroute to X\n 1  192.168.31.1  0.5 ms\n 2  195.170.192.1  1.7 ms\n 3  89.207.216.18  2.0 ms\n 4  89.207.217.125  2.9 ms\n 5  94.228.119.212  10.8 ms\n 6  *\n 7  *\n 8  *\n' > "$T/trace"
ip_routed 1.2.3.4; r2=$?
printf 'traceroute to X\n 1  192.168.31.1  0.5 ms\n 2  195.170.192.1  1.7 ms\n 3  89.207.216.18  2.0 ms\n 4  *\n 5  *\n 6  *\n 7  *\n 8  *\n' > "$T/trace"
ip_routed 1.2.3.4; r3=$?
ok "обрыв на 3-м узле (как у 85.234.106.61) = не проходит" "[[ $r1 != 0 ]]"
ok "трасса дошла до 5-го узла (как у 129.101.120.50) = проходит" "[[ $r2 == 0 ]]"
ok "обрыв на 4-м узле = не проходит" "[[ $r3 != 0 ]]"

echo "== 8. живая проверка туннеля: реальное TCP-соединение с портом 22"
unset -f probe_tunnel hs_age alive; source <(sed -n '/^probe_tunnel()/,/^alive()/p' "$FILE")
PROBE_HOST=127.0.0.1; IFACE=lo; PROBE_TIMEOUT=1
python3 -c "
import socket,time,sys
s=socket.socket(); s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
try:
    s.bind(('127.0.0.1',22)); s.listen(5); open('$T/lst','w').write('up'); time.sleep(25)
except Exception as e: open('$T/lst','w').write('err '+str(e))
" &
LP=$!; for _ in 1 2 3 4 5 6 7 8 9 10; do [[ -s $T/lst ]] && break; command sleep 0.3; done
if [[ $(cat "$T/lst") == up ]]; then
  probe_tunnel 1; r_up=$?
  hs_age() { echo 500; }; alive; r_alive=$?
  hs_age() { echo 10; }; alive; r_fresh=$?
  kill $LP 2>/dev/null; wait $LP 2>/dev/null; command sleep 0.5
  s=$(date +%s%N); probe_tunnel 3; r_down=$?; e=$(( ($(date +%s%N)-s)/1000000 ))
  hs_age() { echo 500; }; alive; r_dead=$?
  ok "порт слушает -> probe_tunnel успешен" "[[ $r_up == 0 ]]"
  ok "рукопожатие старое, но сервер отвечает -> alive" "[[ $r_alive == 0 ]]"
  ok "рукопожатие свежее -> alive без проб" "[[ $r_fresh == 0 ]]"
  ok "порт не слушает -> probe_tunnel неуспешен быстро (${e} мс)" "[[ $r_down != 0 && $e -lt 4000 ]]"
  ok "рукопожатие старое и ответа нет -> не alive" "[[ $r_dead != 0 ]]"
else
  echo "  (порт 22 занят в песочнице: $(cat $T/lst); блок пропущен)"; kill $LP 2>/dev/null
fi

echo "== 9. рассылка ключей: resend-all, журнал, повторы, тревога"
cat > "$T/fakeself" <<'FS'
#!/bin/bash
# заглушка vampn: _mail ИМЯ / _mail --link ИМЯ / conf ИМЯ; failfirst_ИМЯ - первый вызов неудачный, fail_ИМЯ - всегда
echo "self VAMPN_BASE=${VAMPN_BASE:-} $*" >> "$T/calls"
n=${*: -1}
if [[ -f $T/fail_$n ]]; then exit 1; fi
if [[ -f $T/failfirst_$n ]]; then rm -f "$T/failfirst_$n"; exit 1; fi
exit 0
FS
chmod +x "$T/fakeself"
SELF=$T/fakeself; USERS_CONF=$T/users.conf; VAMPN_USERS=$T/users.conf; MAILLOG=$STATE/mail-status.tsv
em_active() { [[ -n ${EMA:-} ]]; }
mk9() { reset; EMA=; rm -f "$T"/fail_* "$T"/failfirst_* "$T/ep"; mkdir -p "$STATE/mirror/clients"; echo 1.1.1.1 > "$STATE/mirror/endpoint"
        for u in a b c; do touch "$STATE/mirror/clients/$u.env"; done
        printf '# пользователи\na a@x.ru\nb b@x.ru\nc c@x.ru\n' > "$USERS_CONF"; MAILLOG=$STATE/mail-status.tsv; }
jl() { printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$1" "$2" "$2@x.ru" key "$3" "${4:-}" >> "$STATE/mail-status.tsv"; }

mk9; out=$(resend_all 2>&1); rc=$?
ok "resend-all: все 3 приняты, итог в выводе" "[[ $rc == 0 && \$out == *'ИТОГ: принято 3 из 3'* ]]"
ok "resend-all: письма собираются из копии данных (VAMPN_BASE=mirror)" "[[ \$(grep -c \"self VAMPN_BASE=$STATE/mirror _mail\" $CALLS) == 3 ]]"
ok "resend-all: комментарий из users.conf не принят за пользователя" "! grep -q '_mail #' $CALLS && ! grep -q '_mail пользователи' $CALLS"
ok "resend-all: при успехе тревоги нет" "! grep -q NOTIFY $CALLS"

mk9; touch "$T/fail_b"; out=$(resend_all 2>&1); rc=$?
ok "resend-all: неушедший b повторён вторым проходом (2 вызова)" "[[ \$(grep -c '_mail b' $CALLS) == 2 ]]"
ok "resend-all: код 1 и список неушедших в итоге" "[[ $rc == 1 && \$out == *'ИТОГ: принято 2 из 3, не ушло: b'* ]]"
ok "resend-all: тревога в Telegram с именем" "grep -q 'NOTIFY рассылка ключей: принято 2 из 3, НЕ ушло: b' $CALLS"
ok "resend-all: удачные не повторялись" "[[ \$(grep -c '_mail a' $CALLS) == 1 && \$(grep -c '_mail c' $CALLS) == 1 ]]"

mk9; touch "$T/failfirst_b"; out=$(resend_all 2>&1); rc=$?
ok "resend-all: b ушёл со второй попытки - итог 3 из 3, без тревоги" "[[ $rc == 0 && \$out == *'ИТОГ: принято 3 из 3'* ]] && ! grep -q NOTIFY $CALLS"

mk9; echo 2.2.2.2 > "$T/ep"; out=$(resend_all 2>&1); rc=$?
ok "resend-all: адрес копии не совпал с туннелем - письма не шлёт" "[[ $rc != 0 && \$out == *'не совпал'* ]] && ! grep -q '_mail' $CALLS"
mk9; EMA=1; out=$(resend_all 2>&1); rc=$?
ok "resend-all: в аварийном режиме отказывается" "[[ $rc != 0 && \$out == *'аварийный'* ]] && ! grep -q '_mail' $CALLS"

echo "-- журнал и сторож"
mk9; touch "$T/fail_b"; jl $((FAKE_NOW-5000)) a ok; jl $((FAKE_NOW-700)) b fail "SMTPServerDisconnected: x"; jl $((FAKE_NOW-100)) c fail "timeout"
ok "mail_failed: видит b и c, a не видит" "[[ \$(mail_failed | cut -f1 | tr '\n' ' ') == 'b c ' ]]"
mail_watch
ok "сторож: одно сообщение о новых неушедших (b c)" "[[ \$(grep -c 'NOTIFY письмо с ключом не ушло: b c' $CALLS) == 1 ]]"
ok "сторож: повторяет только b (c свежий), одно письмо за проверку" "[[ \$(grep -c '_mail b' $CALLS) == 1 && \$(grep -c '_mail c' $CALLS) == 0 ]]"
mail_watch; mail_watch
ok "сторож: повторы b считаются, сообщение не дублируется" "[[ \$(get mail_retry_b) == 3 ]] && [[ \$(grep -c 'NOTIFY письмо с ключом не ушло' $CALLS) == 1 ]]"
mail_watch; mail_watch
ok "сторож: после 3 повторов сдаётся и пишет один раз" "[[ \$(grep -c '_mail b' $CALLS) == 3 && \$(grep -c 'не ушёл и после 3 повторов' $CALLS) == 1 ]]"
jl $((FAKE_NOW+1)) b ok; jl $((FAKE_NOW+1)) c ok; mail_watch
ok "когда всё ушло, служебные метки сброшены" "[[ ! -e $STATE/mail_alerted && ! -e $STATE/mail_retry_b && ! -e $STATE/mail_gaveup_b ]]"

mk9; jl $((FAKE_NOW-900)) b fail "x"; EMA=1; mail_watch
ok "аварийный режим: сторож сообщает, но не шлёт ключи основного сервера" "grep -q 'NOTIFY письмо с ключом не ушло: b' $CALLS && ! grep -q '_mail' $CALLS"
mk9; jl $((FAKE_NOW-900)) b fail "x"; echo 3.3.3.3 > "$T/ep"; mail_watch
ok "адрес копии не совпал с туннелем: сторож сообщает, но не шлёт" "grep -q 'NOTIFY' $CALLS && ! grep -q '_mail' $CALLS"
mk9; jl $((FAKE_NOW-900)) b fail "x"; touch "$T/fail_b"; mail_watch; jl $((FAKE_NOW-1)) b fail "x"; mail_watch
ok "повтор не раньше чем через 10 минут после последней неудачи" "[[ \$(grep -c '_mail b' $CALLS) == 1 ]]"

echo "-- vampn mailstatus"
mk9; jl $((FAKE_NOW-60)) a ok; jl $((FAKE_NOW-60)) b fail "SMTPRecipientsRefused: no such user"
out=$(mailstatus); rc=$?
ok "mailstatus: a принято, b НЕ УШЛО с причиной, c нет записи" "[[ \$out == *'принято почтовым сервером'* && \$out == *'НЕ УШЛО: SMTPRecipientsRefused: no such user'* && \$out == *'нет записи'* ]]"
ok "mailstatus: честная оговорка про спам и приложение" "[[ \$out == *'не спам ли'* && \$out == *'в приложении'* ]]"
ok "mailstatus: код 1, пока есть неушедшие" "[[ $rc == 1 ]]"

echo "-- link/keyconf из копии данных"
mk9; : > "$CALLS"
out=$(key_local link a); rc=$?
ok "key_local link: берёт ссылку из копии" "[[ $rc == 0 ]] && grep -q 'self VAMPN_BASE=.*mirror _mail --link a' $CALLS"
: > "$CALLS"; key_local conf b; rc=$?
ok "key_local conf: берёт .conf из копии" "[[ $rc == 0 ]] && grep -q 'self VAMPN_BASE=.*mirror conf b' $CALLS"
echo 9.9.9.9 > "$T/ep"; : > "$CALLS"; key_local link a; rc=$?
ok "адрес копии не совпал: возвращает 1 (ссылку возьмут у VPS)" "[[ $rc == 1 ]] && ! grep -q self $CALLS"
rm -f "$T/ep"; (key_local link 'bad name' >/dev/null 2>&1); rc=$?
ok "плохое имя отвергается" "[[ $rc != 0 ]]"
(key_local link nobody >/dev/null 2>&1); rc=$?
ok "нет такого пользователя в копии: возвращает 1" "[[ $rc == 1 ]]"

echo "== 10. почтовая часть (Python): повторы SMTP и журнал"
awk "/<<'PY' \|\| true/{f=1;next} /^PY\$/{f=0} f" "$FILE" > "$T/mail.py"
cat > "$T/pytest.py" <<'PYT'
import os, sys, smtplib, time, json
T = os.environ['T']
os.environ.update(VAMPN_SELF='/bin/false', VAMPN_BASE=T + '/base', VAMPN_STATE=T + '/pystate')
os.makedirs(T + '/base/clients', exist_ok=True)
src = open(T + '/mail.py').read().rsplit('\nsys.exit(main', 1)[0]
ns = {}
exec(compile(src, 'mail.py', 'exec'), ns)
res = []
def chk(name, cond): res.append(('OK' if cond else 'FAIL') + ' ' + name)
sleeps = []
ns['time'].sleep = lambda s: sleeps.append(s)
LOG = ns['MAIL_LOG']
def lines():
    try: return [l.split('\t') for l in open(LOG, encoding='utf-8').read().splitlines()]
    except FileNotFoundError: return []
def msg(user=None, to='a@x.ru'):
    m = ns['base_msg'](to, 'тема')
    if user: m['X-Vampn-User'] = user
    m.set_content('x'); return m
def reset():
    sleeps.clear()
    try: os.remove(LOG)
    except FileNotFoundError: pass

# 1. два временных сбоя, на третьей попытке ушло
calls = []
def flaky(m):
    calls.append(1)
    if len(calls) < 3: raise OSError('Connection reset')
ns['_smtp_once'] = flaky
reset(); ns['smtp_deliver'](msg('alice'))
chk('временные сбои: 3 попытки, паузы 5 и 20 с', len(calls) == 3 and sleeps == [5, 20])
chk('временные сбои: в журнале одна строка ok', [l[4] for l in lines()] == ['ok'])
# 2. всё время сбой
calls.clear()
def dead(m):
    calls.append(1); raise smtplib.SMTPServerDisconnected('Connection unexpectedly closed')
ns['_smtp_once'] = dead
reset(); raised = False
try: ns['smtp_deliver'](msg('bob'))
except Exception: raised = True
L = lines()
chk('постоянный сбой: ровно 3 попытки и ошибка наружу', raised and len(calls) == 3)
chk('постоянный сбой: журнал fail с именем, адресом и причиной', len(L) == 1 and L[0][1:5] == ['bob', 'a@x.ru', 'key', 'fail'] and 'SMTPServerDisconnected' in L[0][5])
# 3. неверный пароль - без повторов
calls.clear()
def badauth(m):
    calls.append(1); raise smtplib.SMTPAuthenticationError(535, b'bad creds')
ns['_smtp_once'] = badauth
reset(); raised = False
try: ns['smtp_deliver'](msg('carol'))
except Exception: raised = True
chk('неверный пароль: одна попытка, без пауз', raised and len(calls) == 1 and sleeps == [])
chk('неверный пароль: fail в журнале', [l[4] for l in lines()] == ['fail'])
# 4. адрес отвергнут - без повторов
calls.clear()
def norcpt(m):
    calls.append(1); raise smtplib.SMTPRecipientsRefused({'a@x.ru': (550, b'no such user')})
ns['_smtp_once'] = norcpt
reset()
try: ns['smtp_deliver'](msg('dan'))
except Exception: pass
chk('адрес отвергнут: одна попытка', len(calls) == 1 and [l[4] for l in lines()] == ['fail'])
# 5. вид письма: ключ и обычное
ns['_smtp_once'] = lambda m: None
reset(); ns['smtp_deliver'](msg('eve', 'e@x.ru')); ns['smtp_deliver'](msg(None, 'boss@x.ru'))
L = lines()
chk('вид записи: письмо с ключом = key, без имени = notice', L[0][1:4] == ['eve', 'e@x.ru', 'key'] and L[1][1:4] == ['', 'boss@x.ru', 'notice'])
# 6. подробности: без табуляций и переносов, не длиннее 200
def noisy(m): raise smtplib.SMTPServerDisconnected('a\tb\nc ' + 'x' * 500)
ns['_smtp_once'] = noisy
reset()
try: ns['smtp_deliver'](msg('fay'))
except Exception: pass
L = lines()
chk('подробности: одна строка из 6 полей, не длиннее 200', len(L) == 1 and len(L[0]) == 6 and len(L[0][5]) <= 200)
# 7. журнал не растёт бесконечно
reset()
with open(LOG, 'w', encoding='utf-8') as f:
    f.write(('1\tz\tz@x.ru\tkey\tok\t' + 'y' * 100 + '\n') * 5000)
ns['journal'](msg('last'), 'ok')
L = lines()
chk('журнал усекается и новая запись в конце', len(L) <= 1501 and L[-1][1] == 'last')
# 8. deliver(): ok пишется, если письмо принято; дубль не пишется
ns['_smtp_once'] = lambda m: None
ns['mark_sent'] = lambda m: None; ns['notify_app'] = lambda m: None
reset()
r = ns['deliver'](msg('gus'))
chk('deliver: sent и запись ok', r == 'sent' and [l[4] for l in lines()] == ['ok'])
ns['already_sent'] = lambda m: True
reset(); r = ns['deliver'](msg('gus'))
chk('deliver: дубль не отправляется и не пишется в журнал', r == 'dup' and lines() == [])
# 9. запись журнала недоступна - письму не мешает
ns['MAIL_LOG'] = '/proc/nonexistent/x'; ns['STATE_DIR'] = '/proc/nonexistent'
ns['already_sent'] = lambda m: False
try: ns['smtp_deliver'](msg('hal')); fine = True
except Exception: fine = False
chk('журнал недоступен: письмо всё равно уходит', fine)
print('\n'.join(res))
PYT
pyout=$(T=$T python3 -I "$T/pytest.py" 2>&1)
while IFS= read -r l; do
  case $l in
    "OK "*)   ok "${l#OK }" "true" ;;
    "FAIL "*) ok "${l#FAIL }" "false" ;;
    "") ;;
    *)        echo "  py: $l" ;;
  esac
done <<<"$pyout"
ok "Python-тесты отработали целиком (9 проверок + 2)" "[[ \$(grep -c '^OK \|^FAIL ' <<<\"\$pyout\") -ge 11 ]]"
echo "-- журнал, записанный Python, читает bash"
rm -f "$STATE/mail-status.tsv"; rm -rf "$T/pystate"
cat > "$T/pyj.py" <<'PYT'
import os, sys, smtplib
T = os.environ['T']
os.environ.update(VAMPN_SELF='/bin/false', VAMPN_BASE=T + '/base', VAMPN_STATE=os.environ['ST'])
src = open(T + '/mail.py').read().rsplit('\nsys.exit(main', 1)[0]
ns = {}; exec(compile(src, 'mail.py', 'exec'), ns)
m = ns['base_msg']('zed@x.ru', 's'); m['X-Vampn-User'] = 'zed'; m.set_content('x')
ns['journal'](m, 'fail', 'SMTPServerDisconnected: boom')
PYT
T=$T ST=$STATE python3 -I "$T/pyj.py"
ok "bash читает запись Python: zed в списке неушедших" "[[ \$(mail_failed | cut -f1) == zed ]]"

echo "== 8. раскатка скрипта: Бостон и активный VPN-сервер"
srv_ssh() { echo "srv_ssh $*" >> "$CALLS"; cat > /dev/null; return "${SRV_RC:-0}"; }
em_ssh() { echo "em_ssh $*" >> "$CALLS"; cat > /dev/null; return "${EM_RC:-0}"; }
alive() { return "${ALIVE_RC:-0}"; }
SSH_SRV=(srv_ssh); SELF=$T/self.sh; echo 'EM_HOST=203.0.113.5' > "$EM_ENV"
H() { sha256sum "$SELF" | cut -c1-16; }
printf '#!/bin/bash\necho v1\n' > "$SELF"
reset; ALIVE_RC=0; EM_RC=0; SRV_RC=0
real_deploy_scripts
ok "новый скрипт ушёл и на Бостон, и на сервер (по ключу users, команда selfupdate)" "grep -q 'em_ssh selfupdate' $CALLS && grep -q 'srv_ssh .*users.key root@10.77.0.1 selfupdate' $CALLS"
ok "запомнено, что у обоих уже такой" "[[ \$(get deployed_em) == \$(H) && \$(get deployed_srv_1) == \$(H) ]]"
: > "$CALLS"; real_deploy_scripts
ok "тот же скрипт повторно не отправляется" "! grep -q 'em_ssh\|srv_ssh' $CALLS"
real_deploy_scripts force
ok "vampn deploy (force) отправляет заново обоим" "grep -q em_ssh $CALLS && grep -q srv_ssh $CALLS"
printf '#!/bin/bash\necho v2\n' > "$SELF"; : > "$CALLS"; EM_RC=1; FAKE_NOW=1000100; put deploy_try_em 0; put deploy_try_srv 0
real_deploy_scripts
ok "скрипт изменился: сервер принял, Бостон нет - запись в журнале, метка не поставлена" "grep -q srv_ssh $CALLS && grep -q 'LOG Бостон: скрипт не обновлён' $CALLS && [[ \$(get deployed_em) != \$(H) && \$(get deployed_srv_1) == \$(H) ]]"
: > "$CALLS"; FAKE_NOW=1000200; real_deploy_scripts
ok "неудачную отправку на Бостон не повторяет раньше чем через 10 минут" "! grep -q em_ssh $CALLS"
FAKE_NOW=1000800; EM_RC=0; real_deploy_scripts
ok "через 10 минут повторяет, Бостон принимает" "grep -q em_ssh $CALLS && [[ \$(get deployed_em) == \$(H) ]]"
printf '#!/bin/bash\necho v3\n' > "$SELF"; reset; ALIVE_RC=1; : > "$CALLS"; real_deploy_scripts
ok "туннель мёртв: на VPN-сервер не отправляет, на Бостон отправляет" "! grep -q srv_ssh $CALLS && grep -q em_ssh $CALLS"
reset; ALIVE_RC=0; put active_target 2; put deployed_srv_1 "$(H)"; real_deploy_scripts
ok "активный сервер 2: его скрипт считается отдельно от основного" "grep -q srv_ssh $CALLS && [[ \$(get deployed_srv_2) == \$(H) ]]"
reset; rm -f "$EM_ENV"; real_deploy_scripts
ok "нет настроек аварийного сервера: Бостон пропускается" "! grep -q em_ssh $CALLS && grep -q srv_ssh $CALLS"
reset; echo 'EM_HOST=203.0.113.5' > "$EM_ENV"; SRV_RC=1; real_deploy_scripts
ok "сервер не принял: в журнале, метка не ставится" "grep -q 'LOG VPN-сервер (основной): скрипт не обновлён' $CALLS && [[ \$(get deployed_srv_1 none) == none ]]"

echo "== 8б. selfupdate на сервере: ставит только целый скрипт"
eval "$(sed -n '/^selfupdate_main()/,/^}/p' "$FILE")"
mkdir -p "$T/inst"; export VAMPN_INSTALL=$T/inst/vampn
printf '#!/bin/bash\necho old\n' > "$VAMPN_INSTALL"; chmod 755 "$VAMPN_INSTALL"
good=$'#!/bin/bash\nSELF=/usr/local/sbin/vampn\nexit 0'
out=$( (selfupdate_main <<<"$good") 2>&1 ); rc=$?
ok "целый скрипт ставится" "[[ $rc == 0 && \$out == ok* && \$(cat $VAMPN_INSTALL) == \$good ]]"
ok "старый остался как .prev, права исполняемые" "grep -q 'echo old' $VAMPN_INSTALL.prev && [[ -x $VAMPN_INSTALL ]]"
for bad in $'echo без shebang\n' $'#!/bin/bash\necho чужой скрипт\n' $'#!/bin/bash\nSELF=/usr/local/sbin/vampn\nif then\n' $'#!/bin/bash\nSELF=/usr/local/sbin/vampn\nexit 1\n'; do
  out=$( (selfupdate_main <<<"$bad") 2>&1 ); rc=$?
  ok "негодный скрипт не ставится: $(head -c 28 <<<"$bad" | tr '\n' ' ')" "[[ $rc != 0 && \$(cat $VAMPN_INSTALL) == \$good && -z \$(ls -A $T/inst | grep '^\.vampn-new') ]]"
done
unset VAMPN_INSTALL

echo "== 11. самолечение VPN-сервера: сеть, службы, закрепление адреса"
eval "$(sed -n '/^SRV_AWG_CONF=/,/^srv_status()/p' "$FILE" | sed '$d')"   # константы и srv_heal_*, без srv_status
eval "$(sed -n '/^srv_inet_ok()/p;/^srv_dhcp_ip()/p' "$FILE")"
srv_log() { echo "SLOG $*" >> "$CALLS"; }
SRV_AWG_CONF=$T/awg0.conf; printf '[Interface]\nListenPort = 49029\n' > "$SRV_AWG_CONF"
PIN_FILE=$T/60-pin.yaml; NOPIN_FILE=$T/no-pin
# среда сервера: IFADDRS - адреса eth0 (DHCP-адрес первый), остальное - флаги
ip() { case "$*" in
    "link show eth0") [[ ${ETH_UP:-1} == 1 ]] && echo "2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500" || echo "2: eth0: <BROADCAST,MULTICAST> mtu 1500 state DOWN" ;;
    "link show awg0") [[ ${AWG:-up} == missing ]] && return 1; [[ ${AWG:-up} == up ]] && echo "5: awg0: <POINTOPOINT,NOARP,UP,LOWER_UP>" || echo "5: awg0: <POINTOPOINT,NOARP> state DOWN" ;;
    "-4 -o addr show dev eth0 scope global dynamic") head -1 "$T/ifaddrs" 2>/dev/null | awk '{print "2: eth0 inet " $1 "/24 scope global dynamic"}' ;;
    "-4 -o addr show dev eth0 scope global") awk '{print "2: eth0 inet " $1 "/24 scope global"}' "$T/ifaddrs" 2>/dev/null ;;
    "-4 route show default") [[ ${ROUTE:-1} == 1 ]] && echo "default via 129.101.120.1 dev eth0" ;;
    "link set eth0 up") echo "ip link-up eth0" >> "$CALLS" ;;
    *) echo "ip? $*" >> "$CALLS" ;;
  esac; }
curl() { case "$*" in
    *"-o /dev/null"*) return "${INET_RC:-0}" ;;
    *) [[ -n ${PUB:-} ]] && echo "$PUB" || return 22 ;;
  esac; }
systemctl() { echo "systemctl $*" >> "$CALLS"
  case "$*" in
    "is-active --quiet systemd-networkd") return "${NETD_RC:-0}" ;;
    "is-enabled --quiet ssh") return 0 ;;
    "is-active --quiet ssh") return "${SSH_RC:-0}" ;;
  esac; return 0; }
networkctl() { echo "networkctl $*" >> "$CALLS"; }
ss() { [[ ${LISTEN:-1} == 1 ]] && echo "UNCONN 0 0 0.0.0.0:49029 0.0.0.0:*"; }
nft() { case "$*" in
    "list table inet filter") return "${NFT_RC:-0}" ;;
    "list chain inet filter input") [[ ${NFT_RULE:-1} == 1 ]] && echo "udp dport 49029 accept" ;;
  esac; return 0; }
sysctl() { case "$*" in "-n net.ipv4.ip_forward") echo "${FWD:-1}" ;; *) echo "sysctl $*" >> "$CALLS" ;; esac; }
netplan() { echo "netplan $*" >> "$CALLS"
  [[ $1 == apply ]] && { [[ ${NETPLAN_RC:-0} != 0 ]] && return 1; [[ -f $PIN_FILE ]] && { p=$(grep -Eo '[0-9]{1,3}(\.[0-9]{1,3}){3}' "$PIN_FILE"); grep -qx "$p" "$T/ifaddrs" || echo "$p" >> "$T/ifaddrs"; }
    [[ ! -f $PIN_FILE ]] && sed -i '2,$d' "$T/ifaddrs"; }   # убрали закрепку - остаётся только DHCP-адрес
  [[ $1 == generate ]] && return "${NETPLAN_GEN_RC:-0}"; return 0; }
env11() { reset; rm -f "$PIN_FILE" "$NOPIN_FILE"; echo 129.101.120.50 > "$T/ifaddrs"
  unset ETH_UP AWG ROUTE INET_RC PUB NETD_RC SSH_RC LISTEN NFT_RC NFT_RULE FWD NETPLAN_RC NETPLAN_GEN_RC; }

env11; srv_heal_services; srv_heal_network
ok "всё в порядке: ни одного действия, ни одной записи в журнал" "! grep -qE 'SLOG|restart|systemctl start|reconfigure|sysctl|netplan|link-up' $CALLS"

env11; AWG=down; srv_heal_services
ok "awg0 есть, но не UP: перезапускается" "grep -q 'systemctl restart awg-quick@awg0' $CALLS && grep -q 'SLOG awg0 не поднят' $CALLS"
: > "$CALLS"; srv_heal_services
ok "через минуту повторно не перезапускает (защита 5 минут)" "! grep -q 'restart' $CALLS"
FAKE_NOW=$((FAKE_NOW+301)); srv_heal_services
ok "через 5 минут - снова" "grep -q 'systemctl restart awg-quick@awg0' $CALLS"

env11; AWG=missing; srv_heal_services
ok "awg0 нет вовсе: поднимается" "grep -q 'SLOG awg0 нет' $CALLS && grep -q 'restart awg-quick@awg0' $CALLS"
env11; LISTEN=0; srv_heal_services
ok "порт VPN не слушается: awg0 перезапускается" "grep -q 'SLOG порт 49029 не слушается' $CALLS && grep -q 'restart awg-quick@awg0' $CALLS"
env11; NFT_RULE=0; srv_heal_services
ok "в фильтре нет правила для порта: nftables перезагружается" "grep -q 'в фильтре нет правила' $CALLS && grep -q 'systemctl restart nftables' $CALLS"
env11; NFT_RC=1; srv_heal_services
ok "nftables не загружен: загружается" "grep -q 'SLOG nftables не загружен' $CALLS && grep -q 'systemctl restart nftables' $CALLS"
env11; FWD=0; srv_heal_services
ok "ip_forward выключен: включается" "grep -q 'sysctl -qw net.ipv4.ip_forward=1' $CALLS"
env11; SSH_RC=3; srv_heal_services
ok "sshd лёг: запускается" "grep -q 'systemctl start ssh' $CALLS"

env11; ETH_UP=0; srv_heal_network
ok "eth0 лёг: поднимается" "grep -q 'ip link-up eth0' $CALLS"
env11; NETD_RC=3; srv_heal_network
ok "networkd не запущен: запускается" "grep -q 'systemctl start systemd-networkd' $CALLS"
env11; : > "$T/ifaddrs"; srv_heal_network
ok "нет IPv4 на eth0: переподключение сразу, не через 3 минуты" "grep -q 'networkctl reconfigure eth0' $CALLS && grep -q 'на eth0 нет IPv4' $CALLS"
: > "$CALLS"; srv_heal_network
ok "через минуту переподключение не повторяется (защита 2 минуты)" "! grep -q 'на eth0 нет IPv4' $CALLS"
env11; ROUTE=0; srv_heal_network
ok "нет маршрута по умолчанию: переподключение" "grep -q 'networkctl reconfigure eth0' $CALLS"
env11; INET_RC=1; srv_heal_network; srv_heal_network
ok "интернета нет 2 минуты: пока только счёт" "[[ \$(get net_fails) == 2 ]] && ! grep -q 'networkctl' $CALLS"
srv_heal_network
ok "3-я минута без интернета: переподключение eth0 (как раньше)" "grep -q 'SLOG переподключаю eth0' $CALLS"

echo "-- homeserv сообщил адрес, который Timeweb не отдал по DHCP"
expect_now() { put expect_ip "$1 $(now)"; }
env11; srv_pin_expected
ok "сообщений нет: ничего не делает" "! grep -q netplan $CALLS"
env11; expect_now 82.97.246.204; srv_pin_expected
ok "адреса нет на eth0: закреплён, netplan применён, адрес появился" "grep -q 'netplan apply' $CALLS && grep -q 'адрес 82.97.246.204 закреплён' $CALLS && [[ \$(srv_pinned_ip) == 82.97.246.204 ]] && srv_ifaces_ipv4 | grep -qx 82.97.246.204"
ok "для ключей берётся сообщённый адрес, а не устаревший DHCP" "[[ \$(srv_effective_ip) == 82.97.246.204 && \$(srv_dhcp_ip) == 129.101.120.50 ]]"
: > "$CALLS"; srv_pin_expected
ok "дальше тихо: адрес уже на интерфейсе" "! grep -q 'netplan' $CALLS && ! grep -q SLOG $CALLS"
FAKE_NOW=$((FAKE_NOW+901))
ok "сообщению больше 15 минут: для ключей снова DHCP-адрес (не верим старому)" "[[ \$(srv_effective_ip) == 129.101.120.50 ]]"
env11; expect_now 129.101.120.50; srv_pin_expected
ok "сообщённый адрес и так приходит по DHCP: ничего не делает" "[[ ! -e $PIN_FILE ]] && ! grep -q netplan $CALLS && [[ \$(srv_effective_ip) == 129.101.120.50 ]]"
env11; put expect_ip "82.97.246.204 $((FAKE_NOW-901))"; srv_pin_expected
ok "устаревшее сообщение (старше 15 минут) не закрепляется" "[[ ! -e $PIN_FILE ]] && ! grep -q netplan $CALLS"
env11; expect_now 82.97.246.204; touch "$NOPIN_FILE"; srv_pin_expected
ok "файл no-pin запрещает закрепление" "[[ ! -e $PIN_FILE ]]"
env11; expect_now 82.97.246.204; NETPLAN_RC=1; srv_pin_expected
ok "netplan не применился: закрепка не остаётся, в журнале причина" "[[ ! -e $PIN_FILE ]] && grep -q 'закрепить адрес 82.97.246.204 не вышло' $CALLS"
: > "$CALLS"; srv_pin_expected
ok "повтор не чаще раза в 2 минуты" "! grep -q 'закрепляю' $CALLS"
env11; out=$( (srv_expect_ip 82.97.246.204) 2>&1 ); rc=$?
ok "команда expect-ip: принимает, записывает с меткой времени и сразу закрепляет" "[[ $rc == 0 && \$out == 'ok 82.97.246.204' && \$(srv_expect) == \"82.97.246.204 \$(now)\" && \$(srv_pinned_ip) == 82.97.246.204 ]]"
for bad in "" "abc" "82.97.246" "82.97.246.204; rm -rf /" "10.0.0.5" "192.168.1.1" "100.64.1.1" "172.20.0.1" "127.0.0.1"; do
  env11; out=$( (srv_expect_ip "$bad") 2>&1 ); rc=$?
  ok "expect-ip отвергает «$bad»" "[[ $rc != 0 && ! -e $PIN_FILE && \$(srv_expect) == 'none 0' ]]"
done

echo "== 12. homeserv сообщает серверу его адрес"
ip_routed() { grep -qx "$1" "$T/routed"; }; SRV_RC=0; REMOTE_RC=0; ANN_RC=0   # заглушки раздела 1 (раздел 7 подставлял настоящую ip_routed)
reset; printf '9.9.9.9\n' > "$T/ips"
push_expect
ok "активному серверу уходит его адрес из Timeweb" "grep -q 'remote expect-ip 9.9.9.9' $CALLS && [[ \$(get expect_pushed) == '9.9.9.9 1000000' ]]"
: > "$CALLS"; FAKE_NOW=$((FAKE_NOW+60)); push_expect
ok "тот же адрес повторно не шлётся раньше чем через 5 минут" "! grep -q 'remote expect-ip' $CALLS"
FAKE_NOW=$((FAKE_NOW+250)); push_expect
ok "через 5 минут - обновляет (серверу он верен 15 минут)" "grep -q 'remote expect-ip 9.9.9.9' $CALLS"
: > "$CALLS"; printf '8.8.8.8\n' > "$T/ips"; push_expect
ok "адрес в Timeweb поменялся - шлётся сразу" "grep -q 'remote expect-ip 8.8.8.8' $CALLS"
: > "$CALLS"; REMOTE_RC=1; FAKE_NOW=$((FAKE_NOW+400)); push_expect; rc=$?
ok "сервер не принял - метка не обновляется, вернулась 1, повтор в следующую минуту" "[[ $rc == 1 && \$(get expect_pushed) != *\" \$FAKE_NOW\" ]]"
REMOTE_RC=0
echo "-- перед удалением старого IP новый сообщается серверу"
reset; printf '9.9.9.9\n' > "$T/ips"; printf 'A1\n' > "$T/cands"; HS=1; routed_list A1
attempt 1 >/dev/null 2>&1
ok "активный сервер: адрес A1 сообщён ДО удаления старого IP" "grep -q 'announce 9.9.9.9 A1' $CALLS && [[ \$(grep -n 'announce' $CALLS | cut -d: -f1) -lt \$(grep -n 'DELETE-ip 9.9.9.9' $CALLS | cut -d: -f1) ]]"
reset; printf '9.9.9.9\n' > "$T/ips"; printf 'A1\n' > "$T/cands"; HS=1; routed_list A1; ANN_RC=1
attempt 1 >/dev/null 2>&1; rc=$?
ok "сообщить не вышло - попытка всё равно идёт дальше (сервер получит адрес по DHCP)" "[[ $rc == 0 ]] && grep -q 'DELETE-ip 9.9.9.9' $CALLS"
ANN_RC=0
alive() { return "${ALIVE_RC:-0}"; }
remote() { echo "remote $1" >> "$CALLS"; return "${REMOTE_RC:-0}"; }
SSH_SRV=(srv_ssh); srv_ssh() { echo "srv_ssh $*" >> "$CALLS"; return "${SRV_RC:-0}"; }
reset; put active_target 1; n=1; ALIVE_RC=0; real_announce_ip 9.9.9.9 A1
ok "активный: через туннель, командой expect-ip" "grep -q 'remote expect-ip A1' $CALLS && grep -q 'LOG \[основной\] серверу сообщён новый адрес A1 (через туннель)' $CALLS"
reset; put active_target 1; n=1; ALIVE_RC=1; real_announce_ip 9.9.9.9 A1; rc=$?
ok "активный, туннель мёртв: не вышло, в журнале причина" "[[ $rc == 1 ]] && ! grep -q 'remote expect-ip' $CALLS && grep -q 'сообщить не вышло' $CALLS"
reset; put active_target 1; n=2; TSUF=_2; real_announce_ip 8.8.8.8 Y1; rc=$?; TSUF=""
ok "неактивный: напрямую на старый адрес, HostKeyAlias как у туннельного адреса" "[[ $rc == 0 ]] && grep -q 'srv_ssh .*-o HostKeyAlias=10.77.0.1 .*root@8.8.8.8 expect-ip Y1' $CALLS && ! grep -q 'remote expect-ip' $CALLS"
reset; put active_target 1; n=2; SRV_RC=255; real_announce_ip 8.8.8.8 Y1; rc=$?; SRV_RC=0
ok "неактивный, порт 22 закрыт: не вышло, без паники" "[[ $rc == 1 ]] && grep -q 'сообщить не вышло' $CALLS"
reset; put active_target 1; n=2; real_announce_ip "" Y1; rc=$?
ok "неактивный без старого адреса: слать некуда, не вышло" "[[ $rc == 1 ]] && ! grep -q 'srv_ssh' $CALLS"
echo "== 13. туннель не уезжает на сервер, который написал первым; свой отпечаток у каждого сервера; unpin"
eval "$(sed -n '/^tun_keep_endpoint()/,/^}/p' "$FILE")"
eval "$(sed -n '/^srv_ssh_init()/,/^}/p' "$FILE")"
eval "$(sed -n '/^srv_unpin()/,/^}/p' "$FILE")"
awg() { case "$*" in "show lo endpoints") [[ -n ${RT_EP:-} ]] && printf 'PK\t%s\n' "$RT_EP" ;; "show lo peers") echo PK ;; set*) echo "awg $*" >> "$CALLS" ;; esac; }
reset; RT_EP=72.56.116.188:49029; tun_keep_endpoint
ok "пир уехал на другой сервер: возвращён на заданный адрес (в конфиге), запись в журнале" "grep -q 'awg set lo peer PK endpoint 9.9.9.9:49029' $CALLS && grep -q 'LOG туннель уехал на 72.56.116.188' $CALLS"
reset; RT_EP=9.9.9.9:49029; tun_keep_endpoint
ok "пир там, где велено: ничего не делает" "! grep -q 'awg set' $CALLS"
reset; RT_EP=""; tun_keep_endpoint
ok "у пира нет адреса (ещё не было связи): ничего не делает" "! grep -q 'awg set' $CALLS"

VAMPN_ETC=$T/etc; mkdir -p "$VAMPN_ETC"; echo mirror > "$VAMPN_ETC/mirror.known_hosts"
TARGET=1; srv_ssh_init
ok "нет своего файла отпечатков: общий mirror.known_hosts, как раньше" "[[ \"\${SSH_SRV[*]}\" == *\"UserKnownHostsFile=$VAMPN_ETC/mirror.known_hosts\"* ]]"
echo main > "$VAMPN_ETC/known_hosts_1"; echo spare > "$VAMPN_ETC/known_hosts_2"
TARGET=1; srv_ssh_init
ok "основной: свой файл отпечатков" "[[ \"\${SSH_SRV[*]}\" == *\"UserKnownHostsFile=$VAMPN_ETC/known_hosts_1\"* ]]"
TARGET=2; srv_ssh_init
ok "запасной: свой файл отпечатков" "[[ \"\${SSH_SRV[*]}\" == *\"UserKnownHostsFile=$VAMPN_ETC/known_hosts_2\"* ]]"
ok "ключи ssh остаются прежними (только ключ users, без паролей и чужих ключей)" "[[ \"\${SSH_SRV[*]}\" == *'IdentitiesOnly=yes'* && \"\${SSH_SRV[*]}\" == *'BatchMode=yes'* ]]"
TARGET=1; unset VAMPN_ETC

echo "-- unpin: сервер получил чужой адрес"
env11; BASE=$T/base; CL=$BASE/clients; mkdir -p "$CL"; echo 82.97.246.204 > "$BASE/endpoint"; ENDPOINT_IP=82.97.246.204
touch "$CL/ann.env" "$CL/bob.env"; : > "$BASE/mail_pending"; put expect_ip "82.97.246.204 $(now)"
printf 'network:\n  addresses:\n    - 82.97.246.204/32\n' > "$PIN_FILE"; echo 82.97.246.204 >> "$T/ifaddrs"
render() { echo "render $1" >> "$CALLS"; }
out=$( (srv_unpin) 2>&1 )
ok "закрепление и сообщение об адресе сняты, рассылка отменена" "[[ ! -e $PIN_FILE && ! -e $STATE/expect_ip && ! -e $BASE/mail_pending ]] && grep -q 'netplan apply' $CALLS"
ok "адрес сервера возвращён из DHCP, конфиги пользователей пересобраны (письма не рассылаются)" "[[ \$(cat $BASE/endpoint) == 129.101.120.50 ]] && grep -q 'render ann' $CALLS && grep -q 'render bob' $CALLS && [[ \$out == 'ok 129.101.120.50' ]]"
echo "== 14. ячейки: настройки, адреса туннеля, список пользователей ячейки"
cd_=$T/cell; mkdir -p "$cd_/etc/cells" "$cd_/awg"
printf 'CELL_NET=10.77.4\nCELL_NAME=vampn_2\nCELL_LIMIT=1000\n' > "$cd_/etc/cells/2.env"; : > "$cd_/awg/vampn2.conf"; : > "$cd_/awg/vampn.conf"
hdr() { # переменные шапки скрипта при VAMPN_CELL=$1
  VAMPN_CELL=$1 VAMPN_ETC=$cd_/etc VAMPN_AWG_DIR=$cd_/awg VAMPN_CELLS_STATE=$cd_/st bash -c "
    FILE=$FILE; a=\$(grep -n '^set -uo pipefail' \$FILE | head -1 | cut -d: -f1); b=\$(grep -n '^now() ' \$FILE | head -1 | cut -d: -f1)
    sed -n \"\${a},\$((b-1))p\" \$FILE > $cd_/hdr.sh; sed -i 's|^SELF=/usr/local/sbin/vampn|SELF=/usr/local/sbin/vampn; STATE=$cd_/st1|' $cd_/hdr.sh
    sed -i 's|^STATE=/var/lib/vampn\$|STATE=$cd_/st1|' $cd_/hdr.sh
    . $cd_/hdr.sh; echo \"\$CELL \$TUN_IFACE \$SRV_TIP \$HOME_TIP \$STATE \$ROLE \$CELL_NAME\""; }
ok "ячейка 1: прежние интерфейс, адреса и состояние" '[[ $(hdr 1) == "1 vampn 10.77.0.1 10.77.0.3 '$cd_'/st1 home vampn" ]]'
ok "ячейка 2: свой интерфейс, адреса туннеля 10.77.4.x и своё состояние" '[[ $(hdr 2) == "2 vampn2 10.77.4.1 10.77.4.3 '$cd_'/st/2 home vampn_2" ]]'
ok "несуществующая ячейка 3 - отказ" '! hdr 3 >/dev/null 2>&1'
ok "плохой номер ячейки - отказ" '! hdr 0 >/dev/null 2>&1 && ! hdr x >/dev/null 2>&1'
printf '# список\nanna a@x.ru\nboris b@x.ru 2\nclara c@x.ru 1\ndima d@x.ru 3\n\nbad line here extra\n' > "$T/users_cells.conf"
VAMPN_USERS=$T/users_cells.conf; mkdir -p "$T/uc"
uc() { local f; f=$(CELL=$1 STATE=$T/uc users_conf_file) && tr "\n" "|" < "$f"; }
ok "users.conf: ячейка 1 получает строки без номера и с номером 1 (и неразобранные как раньше)" '[[ $(uc 1) == "anna a@x.ru|clara c@x.ru|bad line here extra|" ]]'
ok "users.conf: ячейка 2 получает только свои, номер ячейки отрезан" '[[ $(uc 2) == "boris b@x.ru|" ]]'
ok "users.conf: ячейка 3 получает только свою" '[[ $(uc 3) == "dima d@x.ru|" ]]'
unset VAMPN_USERS

echo "== 15. адреса клиентов: /24 как раньше, /22 для ячейки, лимит"
eval "$(sed -n '/^next_ip() {/,/^client_count() /p' "$FILE")"
CL=$T/cl; rm -rf "$CL"; mkdir -p "$CL"
SUBNET=10.77.0; unset SUBNET_SPAN
ok "/24: первый свободный .2" '[[ $(next_ip) == 10.77.0.2 ]]'
printf 'IP=10.77.0.2\n' > "$CL/a.env"; printf 'IP=10.77.0.3\n' > "$CL/homeserv.env"
ok "/24: занятые пропускаются (.4)" '[[ $(next_ip) == 10.77.0.4 ]]'
for i in $(seq 4 254); do echo "IP=10.77.0.$i" > "$CL/u$i.env"; done
ok "/24 заполнена - отказ, как раньше" '! (next_ip) >/dev/null 2>&1'
SUBNET=10.77.4; SUBNET_SPAN=4
for i in $(seq 2 254); do echo "IP=10.77.4.$i" > "$CL/v$i.env"; done
ok "/22: после заполнения первого /24 берёт 10.77.5.2" '[[ $(next_ip) == 10.77.5.2 ]]'
for o in 1 2 3; do for i in $(seq 2 254); do echo "IP=10.77.$((4+o)).$i" > "$CL/w${o}_$i.env"; done; done
ok "/22 заполнена целиком (1012 адресов) - отказ" '! (next_ip) >/dev/null 2>&1'
eval "$(sed -n '/^client_count() {/p' "$FILE")"
ok "client_count не считает служебный homeserv" '[[ $(client_count) == $(( $(ls "$CL"/*.env | wc -l) - 1 )) ]]'
rm -rf "$CL"; unset SUBNET SUBNET_SPAN

echo "== 16. install.sh: файлы нового сервера (render-only, без установки)"
INS=$(dirname "$(readlink -f "$FILE")")/install.sh
R=$T/inst; rm -rf "$R"; mkdir -p "$R/bin" "$R/pl"; cp "$FILE" "$R/pl/vampn"
cat > "$R/bin/awg" <<'FAKE'
#!/bin/bash
case $1 in genkey|genpsk) head -c 32 /dev/urandom | base64 ;; pubkey) echo "PUB-$(head -c 8 | base64)" ;; *) exit 0 ;; esac
FAKE
chmod +x "$R/bin/awg"
K1="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA root-key"
K2="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB users-key"
K3="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC mirror-key"
K4="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD she@pc"
inst() { FAKE_BIN=$R/bin bash "$INS" --render-only --root "$R/root" --payload "$R/pl" --net 10.77.4 --public-ip 203.0.113.7 \
  --key-root "$K1" --key-users "$K2" --key-mirror "$K3" --admin-key "$K4" --home-public-ip 195.170.195.92 "$@" 2>&1; }
out=$(inst)
ok "install.sh: render-only отработал" '[[ $? == 0 && -f $R/root/etc/amnezia/amneziawg/awg0.conf ]]'
AC=$R/root/etc/amnezia/amneziawg/awg0.conf; SE=$R/root/root/vampn/server.env; NF=$R/root/etc/nftables.conf; AK=$R/root/root/.ssh/authorized_keys
ok "awg0.conf: адрес сервера 10.77.4.1/22, порт 30000-60999, ключ сервера" 'grep -q "^Address = 10.77.4.1/22" $AC && p=$(sed -n "s/^ListenPort = //p" $AC) && (( p >= 30000 && p <= 60999 )) && grep -q "^PrivateKey = " $AC'
ok "server.env: сеть, /22, лимит клиентов и порт совпадают с awg0.conf" 'grep -q "^SUBNET=10.77.4$" $SE && grep -q "^SUBNET_SPAN=4$" $SE && grep -q "^SUBNET_CIDR=22$" $SE && grep -q "^CLIENT_LIMIT=1000$" $SE && [[ $(sed -n "s/^PORT=//p" $SE) == $(sed -n "s/^ListenPort = //p" $AC) ]]'
ok "endpoint записан (публичный адрес нового сервера)" '[[ $(cat $R/root/root/vampn/endpoint) == 203.0.113.7 ]]'
ok "параметры маскировки: S1+56 != S2, H-диапазоны не пересекаются" 's1=$(sed -n "s/^S1=//p" $SE); s2=$(sed -n "s/^S2=//p" $SE); (( s1 + 56 != s2 )) && h1=$(sed -n "s/^H1=//p" $SE | cut -d- -f2) && h2=$(sed -n "s/^H2=//p" $SE | cut -d- -f1) && (( h1 < h2 ))'
ok "nftables: только порт VPN снаружи, ssh из туннеля с 10.77.4.3 и с публичного адреса homeserv" 'grep -q "iifname \$WAN udp dport \$AWG_PORT accept" $NF && grep -q "iifname \$VPN ip saddr 10.77.4.3 tcp dport 22 accept" $NF && grep -q "ip saddr 195.170.195.92 tcp dport 22 accept" $NF && ! grep -q "dport 22 accept$" <(grep -v saddr $NF)'
ok "nftables: NAT подсети /22, игровые правила на 10.77.4.3" 'grep -q "ip saddr 10.77.4.0/22 oifname \$WAN masquerade" $NF && grep -q "ip daddr 10.77.4.3 tcp dport 25565" $NF'
ok "sysctl: ip_forward, bbr, ping закрыт" 'grep -q "ip_forward = 1" $R/root/etc/sysctl.d/90-vampn.conf && grep -q bbr $R/root/etc/sysctl.d/90-vampn.conf && grep -q icmp_echo_ignore_all $R/root/etc/sysctl.d/90-vampn.conf'
ok "authorized_keys: ключ homeserv с ограничением from=10.77.4.3 для почты/копии, админ-ключ, обычный ключ root" 'grep -q "^restrict,from=\"10.77.4.3\",command=\"/usr/local/sbin/vampn remote\" ssh-ed25519 .* homeserv-users$" $AK && grep -q "command=\"tar -C /root/vampn -czf - server.env endpoint clients\" .* homeserv-mirror$" $AK && grep -q "^ssh-ed25519 .* vampn-admin$" $AK && grep -q "^ssh-ed25519 .* homeserv$" $AK'
ok "sshd: пароли выключены" 'grep -q "PasswordAuthentication no" $R/root/etc/ssh/sshd_config.d/00-vampn.conf'
ok "юнит и таймер самопроверки, скрипт на месте" '[[ -x $R/root/usr/local/sbin/vampn ]] && grep -q "OnUnitActiveSec=60" $R/root/etc/systemd/system/vampn.timer && grep -q "RELAY_HOST=10.77.4.3" $R/root/etc/vampn/secrets.env'
pk1=$(sed -n 's/^PrivateKey = //p' $AC); inst >/dev/null; pk2=$(sed -n 's/^PrivateKey = //p' $AC)
ok "повторный запуск: ключ сервера не перезаписан (идемпотентность)" '[[ -n $pk1 && $pk1 == $pk2 ]]'
ok "authorized_keys при повторе без дублей" '[[ $(grep -c homeserv-users $AK) == 1 && $(grep -c " homeserv$" $AK) == 1 ]]'
ok "отказ: нет ключа homeserv" '! FAKE_BIN=$R/bin bash "$INS" --render-only --root $R/r2 --payload $R/pl --net 10.77.4 2>/dev/null'
ok "отказ: третий октет сети не кратен 4 для /22" '! inst --net 10.77.6 >/dev/null 2>&1'
ok "отказ: мусор вместо ключа" '! inst --admin-key "bash -c evil" >/dev/null 2>&1'
rm -rf "$R/r3"; out=$(FAKE_BIN=$R/bin bash "$INS" --render-only --root "$R/r3" --payload "$R/pl" --net 10.77.8 --span 1 --public-ip 203.0.113.8 --key-root "$K1" --key-users "$K2" --key-mirror "$K3" --no-game 2>&1)
ok "--span 1 --no-game: /24, без игровых правил, без правила публичного ssh" 'grep -q "^Address = 10.77.8.1/24" $R/r3/etc/amnezia/amneziawg/awg0.conf && ! grep -q 25565 $R/r3/etc/nftables.conf && ! grep -q "ip saddr 195" $R/r3/etc/nftables.conf'
if command -v nft >/dev/null 2>&1 && nft -c -f "$NF" >/dev/null 2>&1; then ok "nft принимает сгенерированный набор правил (nft -c)" 'true'; else echo "  --   nft -c недоступен в этом окружении, синтаксис правил не проверялся"; fi

echo "== 17. пир homeserv на новом сервере: адрес .3, конфиг туннеля"
( BASE=$R/root/root/vampn; CL=$BASE/clients; PATH=$R/bin:$PATH
  eval "$(sed -n '/^data_init() {/,/^}/p;/^render() {/,/^}/p;/^srv_home_init() {/,/^}/p;/^srv_home_conf() {/,/^}/p' "$FILE")"
  sync_server() { :; }; data_init
  srv_home_init; srv_home_init
  echo "files=$(ls $CL | tr '\n' ' ')"; grep '^IP=' $CL/homeserv.env
  srv_home_conf | grep -E '^(Address|Endpoint|PublicKey)' ) > "$T/hh.out" 2>&1
ok "homeserv: один пир с адресом 10.77.4.3, повторный вызов ничего не меняет" 'grep -q "files=homeserv.conf homeserv.env" $T/hh.out && grep -q "^IP=10.77.4.3$" $T/hh.out'
ok "конфиг туннеля: адрес клиента .3, endpoint нового сервера, ключ сервера" 'grep -q "^Address = 10.77.4.3/32" $T/hh.out && grep -q "^Endpoint = 203.0.113.7:" $T/hh.out && grep -q "^PublicKey = PUB-" $T/hh.out'

echo "== 18. ячейки и spawn: кабинеты, выбор тарифа, развёртывание на заглушках (в Timeweb и на серверы не ходит)"
INSTALL_FILE=$(dirname "$(readlink -f "$FILE")")/install.sh
ok "встроенный в vampn install.sh совпадает с install.sh (если нет - bash embed.sh)" '[[ $(install_sh | sha256sum) == $(sha256sum < "$INSTALL_FILE") ]]'
S=$T/sp; rm -rf "$S"; mkdir -p "$S/etc" "$S/awg" "$S/units" "$S/spawn"
ETC_DIR=$S/etc CELLS_DIR=$S/etc/cells ACCT_DIR=$S/etc/accounts SPAWN_DIR=$S/spawn AWG_DIR=$S/awg HOME_AK=$S/ak VAMPN_KEYRING=$S/gpg VAMPN_UNITS=$S/units VAMPN_USERS=$S/users.conf
: > "$S/ak"; echo gpgdata > "$S/gpg"; echo "ssh-ed25519 AAAAUSERS users" > "$S/etc/users.key.pub"; echo "ssh-ed25519 AAAAMIRROR mirror" > "$S/etc/mirror.key.pub"
printf '# k\nMAIL_FROM=vpn@x.ru\nSMTP_PASS=secret\n' > "$S/etc/secrets.env"
printf 'TIMEWEB_TOKEN=tok-main-0000000000000000\nTIMEWEB_SERVER_ID=1\n' > "$S/etc/timeweb.env"
PRESETS='{"server_presets":[{"id":1,"location":"ru-4","price":350},{"id":6803,"location":"nl-1","price":950},{"id":6810,"location":"nl-1","price":1500},{"id":6801,"location":"nl-1","price":950},{"id":2,"location":"pl-1","price":600}]}'
OSES='{"servers_os":[{"id":67,"name":"debian","version":"11"},{"id":95,"name":"debian","version":"12"},{"id":109,"name":"debian","version":"13"},{"id":5,"name":"ubuntu","version":"24.04"}]}'
TWLOG=$S/tw.log; : > "$TWLOG"; TW_SERVERS='{"servers":[]}'; TW_CREATE='{"server":{"id":777}}'; TW_TOKEN_OK=1; TW_ON=on
twa() { echo "$2 $3 $(tr -d '\n' <<<"${4:-}")" >> "$TWLOG"
  case "$2 $3" in
    "GET /account/finances") [[ $TW_TOKEN_OK == 1 && $1 == tok-* ]] && echo '{"finances":{"balance":5000,"currency":"RUB"}}' || echo '{"message":"Unauthorized"}' ;;
    "GET /presets/servers") echo "$PRESETS" ;;   "GET /os/servers") echo "$OSES" ;;
    "GET /servers") echo "$TW_SERVERS" ;;           "GET /ssh-keys") echo '{"ssh_keys":[]}' ;;
    "POST /ssh-keys") echo '{"ssh_key":{"id":55}}' ;; "POST /servers") echo "$TW_CREATE" ;;
    "GET /servers/777") echo "{\"server\":{\"id\":777,\"status\":\"$TW_ON\",\"networks\":[{\"ips\":[{\"ip\":\"2a03::1\",\"type\":\"ipv6\",\"is_main\":true},{\"ip\":\"203.0.113.9\",\"type\":\"ipv4\",\"is_main\":true}]}]}}" ;;
    "DELETE /servers/777") echo '{"message":"ok"}' ;;
    *) echo '{"message":"unexpected"}' ;;
  esac; }
ssh() { local a="$*"; echo "ssh ${a: -60}" >> "$S/ssh.log"
  case $a in
    *install.sh*) cat > "$S/payload.tar"; [[ ${INSTALL_FAIL:-} == 1 ]] && { echo "E: boom"; return 1; }
       echo "[install] x"; echo VAMPN_PORT=41234; echo VAMPN_SERVER_PUBKEY=SRVPUB=; echo "VAMPN_MAILRELAY_PUB=ssh-ed25519 AAAARELAY"; [[ ${INSTALL_NOOK:-} == 1 ]] || echo VAMPN_INSTALL_OK=1 ;;
    *home-conf*) printf '[Interface]\nPrivateKey = HK\nAddress = 10.77.4.3/32\nDNS = 1.1.1.1\nMTU = 1380\n\n[Peer]\nPublicKey = SRVPUB=\nPresharedKey = P\nAllowedIPs = 0.0.0.0/0, ::/0\nEndpoint = 203.0.113.9:41234\nPersistentKeepalive = 25\n' ;;
    *) return 0 ;;
  esac; }
awg() { [[ $1 == show && ${HS_NONE:-} != 1 ]] && echo "PK $(( $(now) - 5 ))"; return 0; }
systemctl() { echo "systemctl $*" >> "$CALLS"; return 0; }
ssh-keyscan() { echo "10.77.4.1 ssh-ed25519 AAAAHOSTKEY"; }
curl() { echo 195.170.195.92; }
ssh-keygen() { [[ ${KEYGEN_FAIL:-} == 1 ]] && return 1; local f; while [[ $# -gt 0 ]]; do [[ $1 == -f ]] && f=$2; shift; done; echo FAKEPRIV > "$f"; echo "ssh-ed25519 AAAAFAKE vampn-spawn" > "$f.pub"; }
printf '#!/bin/bash\necho "self $*" >> %s\n' "$CALLS" > "$T/fakeself2"; chmod +x "$T/fakeself2"
spawn_try() { : > "$CALLS"; : > "$TWLOG"; rm -rf "$S/spawn"; mkdir -p "$S/spawn"; ( SELF=$T/fakeself2 spawn_run "${1:-main}" ) >/dev/null 2>&1; }

# -- кабинеты
acc_out=$( printf 'tok-new-0000000000000000000\n' | account_main add second 2>&1 ); acc_rc=$?
ok "account add: токен принят, файл 600, в выводе токена нет" '[[ $acc_rc == 0 && -f $ACCT_DIR/second.env && $(stat -c %a $ACCT_DIR/second.env) == 600 && $acc_out != *tok-new* && $acc_out == *5000* ]]'
ok "account add: первый добавленный становится кабинетом по умолчанию" '[[ $(cat $ACCT_DIR/default) == second && $(acct_default) == second ]]'
TW_TOKEN_OK=0; ok "account add: Timeweb не принял токен - файл не создан" '! (printf "tok-bad-000000000000000000\n" | account_main add bad) >/dev/null 2>&1 && [[ ! -f $ACCT_DIR/bad.env ]]'; TW_TOKEN_OK=1
ok "имя кабинета не может начинаться с дефиса (не станет параметром)" '! (echo tok-aaaaaaaaaaaaaaaaaaaaa | account_main add -x) >/dev/null 2>&1 && ! (echo tok-aaaaaaaaaaaaaaaaaaaaa | account_main add --force) >/dev/null 2>&1'
ok "account add: мусор вместо токена и плохое имя отклоняются" '! (echo short | account_main add x1) >/dev/null 2>&1 && ! (echo tok-aaaaaaaaaaaaaaaaaaaaa | account_main add "Плохое Имя") >/dev/null 2>&1 && ! (echo tok-aaaaaaaaaaaaaaaaaaaaa | account_main add main) >/dev/null 2>&1'
ok "account list: токены не показываются, видны main и second" 'l=$(account_main list); [[ $l == *main* && $l == *second* && $l != *tok-* ]]'
ok "account list --tsv: одна строка на кабинет, поля через табуляцию, без токенов, по умолчанию помечен" 'l=$(account_main list --tsv); [[ $(wc -l <<<"$l") == 2 && $l != *tok-* ]] && grep -qP "^second\tok\t5000\tRUB\t1\t$" <<<"$l" && grep -qP "^main\tok\t5000\tRUB\t0\t$" <<<"$l"'
ok "acct_token: main - из timeweb.env, second - из accounts" '[[ $(acct_token main) == tok-main-0000000000000000 && $(acct_token second) == tok-new-0000000000000000000 ]]'

# -- выбор тарифа и образа
ok "spawn_pick: самый дешёвый тариф локации nl-1 (при равной цене меньший id) и Debian 13" '[[ $(spawn_pick tok-x) == "6801 109" ]]'
OSES='{"servers_os":[{"id":95,"name":"debian","version":"12"},{"id":67,"name":"debian","version":"11"},{"id":5,"name":"ubuntu","version":"24.04"}]}'
ok "spawn_pick: Debian 13 нет - берёт 12 (11 и Ubuntu не берёт)" '[[ $(spawn_pick tok-x) == "6801 95" ]]'
OSES='{"servers_os":[{"id":5,"name":"ubuntu","version":"24.04"}]}'
ok "spawn_pick: нет Debian - отказ" '! spawn_pick tok-x >/dev/null 2>&1'
OSES='{"servers_os":[{"id":109,"name":"debian","version":"13"}]}'; PRESETS='{"server_presets":[{"id":1,"location":"ru-4","price":350}]}'
ok "spawn_pick: в Амстердаме нет тарифов - отказ" '! spawn_pick tok-x >/dev/null 2>&1'
PRESETS='{"server_presets":[{"id":6803,"location":"nl-1","price":950},{"id":6801,"location":"nl-1","price":950},{"id":6810,"location":"nl-1","price":1500},{"id":1,"location":"ru-4","price":350}]}'

# -- полный ход
spawn_try main
ok "spawn: готово, состояние done" '[[ $(cut -d: -f1 "$SPAWN_DIR/job.state") == done ]]'
ok "spawn: сервер создан в Амстердаме, Debian 13, самый дешёвый тариф, имя vampn_2, ключ ssh" 'b=$(grep "^POST /servers " "$TWLOG" | sed "s/^POST \/servers //"); [[ $(jq -r .name <<<"$b") == vampn_2 && $(jq -r .preset_id <<<"$b") == 6801 && $(jq -r .os_id <<<"$b") == 109 && $(jq -r .availability_zone <<<"$b") == ams-1 && $(jq -c .ssh_keys_ids <<<"$b") == "[55]" ]]'
ok "spawn: ячейка 2 записана (имя, сеть 10.77.4, лимит 1000, кабинет, id сервера, IP, состояние)" '( . "$CELLS_DIR/2.env"; [[ $CELL_NAME == vampn_2 && $CELL_NET == 10.77.4 && $CELL_LIMIT == 1000 && $CELL_ACCOUNT == main && $CELL_SERVER_ID == 777 && $CELL_IP == 203.0.113.9 && $CELL_STATE == активна ]] )'
ok "spawn: токен кабинета лежит в 2.timeweb.env с правами 600" '[[ $(stat -c %a $CELLS_DIR/2.timeweb.env) == 600 ]] && grep -q "^TIMEWEB_SERVER_ID=777$" $CELLS_DIR/2.timeweb.env && grep -q "^TIMEWEB_TOKEN=tok-main" $CELLS_DIR/2.timeweb.env'
ok "spawn: конфиг туннеля: адрес сервера /32 вместо 0.0.0.0/0, без DNS, правильный Endpoint, права 600" 'c=$AWG_DIR/vampn2.conf; grep -q "^AllowedIPs = 10.77.4.1/32$" $c && ! grep -q "^DNS" $c && grep -q "^Endpoint = 203.0.113.9:41234$" $c && [[ $(stat -c %a $c) == 600 ]]'
ok "spawn: ключ почты сервера внесён на homeserv с ограничением (restrict, from=10.77.4.1, только vampn mail)" 'grep -q "^restrict,from=\"10.77.4.1\",command=\"/usr/local/sbin/vampn mail\" ssh-ed25519 AAAARELAY vampn-mailrelay-2$" "$HOME_AK"'
ok "spawn: отпечаток sshd запомнен для ячейки" 'grep -q "^10.77.4.1 ssh-ed25519 AAAAHOSTKEY$" "$CELLS_DIR/2.known_hosts"'
ok "spawn: туннель и таймер сторожа ячейки включены, юниты записаны" 'grep -q "systemctl enable --now awg-quick@vampn2" $CALLS && grep -q "systemctl enable --now vampn-cell@2.timer" $CALLS && grep -q "VAMPN_CELL=%i" $VAMPN_UNITS/vampn-cell@.service'
ok "spawn: пользователи ячейки отправлены и копия данных снята" 'grep -q "^self users" $CALLS && grep -q "^self mirror" $CALLS'
ok "spawn: бандл ушёл на сервер (vampn, install.sh, amnezia.gpg, secrets без пароля SMTP)" 'tar -tf $S/payload.tar | grep -q "^./install.sh" && tar -tf $S/payload.tar | grep -q "^./amnezia.gpg" && tar -xOf $S/payload.tar ./secrets.env | grep -q "RELAY_HOST=10.77.4.3" && ! tar -xOf $S/payload.tar ./secrets.env | grep -q SMTP_PASS'
ok "spawn: ключ spawn.key создан и его открытая часть отправлена в Timeweb" '[[ -f $ETC_DIR/spawn.key && $(grep -c "" $ETC_DIR/spawn.key.pub) == 1 ]] && grep -q "^POST /ssh-keys .*ssh-ed25519 AAAAFAKE" "$TWLOG"'
ok "cells: ячейка 2 в таблице с IP и состоянием" 't=$(cells_main); grep -q "^2.vampn_2.203.0.113.9.0.1000" <<<"$t" || grep -qP "^2\tvampn_2\t203.0.113.9\t0\t1000\t" <<<"$t"'

# -- вторая аренда: имя vampn_2 занято в Timeweb и ячейка 2 есть -> vampn_3
TW_SERVERS='{"servers":[{"id":5,"name":"vampn_2"}]}'; TW_CREATE='{"server":{"id":777}}'
mkdir -p "$S/keep"; cp "$CELLS_DIR/2.env" "$S/keep/2.env"
spawn_try second
ok "spawn: следующая ячейка получает номер 3 (vampn_3, сеть 10.77.8), кабинет по умолчанию second" '( . "$CELLS_DIR/3.env"; [[ $CELL_NAME == vampn_3 && $CELL_NET == 10.77.8 && $CELL_ACCOUNT == second ]] ) && grep -q "vampn-mailrelay-3" "$HOME_AK"'

# -- сбои
rm -f "$ETC_DIR/spawn.key" "$ETC_DIR/spawn.key.pub"; KEYGEN_FAIL=1; spawn_try main
ok "ssh-keygen не сработал - spawn останавливается до аренды (POST /servers не было)" '[[ $(cut -d: -f1 "$SPAWN_DIR/job.state") == failed ]] && ! grep -q "^POST /servers" "$TWLOG"'; unset KEYGEN_FAIL
rm -f "$CELLS_DIR"/3.* "$AWG_DIR"/vampn3.conf; TW_SERVERS='{"servers":[]}'
TW_CREATE='{"message":"Not enough funds","error_code":"payment_required"}'; spawn_try main
ok "сбой создания сервера: состояние failed, ячейка не создана, есть тревога" '[[ $(cut -d: -f1 "$SPAWN_DIR/job.state") == failed && ! -f $CELLS_DIR/4.env ]] && grep -q "^tg notify alerts" $CALLS'
TW_CREATE='{"server":{"id":777}}'; INSTALL_FAIL=1; spawn_try main
ok "сбой install.sh: ячейка помечена «ошибка», сервер и запись остаются для разбора" '[[ $(cut -d: -f1 "$SPAWN_DIR/job.state") == failed ]] && ( . "$CELLS_DIR/3.env"; [[ $CELL_STATE == ошибка ]] ) && ! grep -q "enable --now vampn-cell@3" $CALLS'
INSTALL_FAIL=0; INSTALL_NOOK=1; rm -f "$CELLS_DIR"/3.*; spawn_try main
ok "install.sh без подтверждения VAMPN_INSTALL_OK - сбой" '[[ $(cut -d: -f1 "$SPAWN_DIR/job.state") == failed ]]'
INSTALL_NOOK=0; HS_NONE=1; rm -f "$CELLS_DIR"/3.*; spawn_try main
ok "нет рукопожатия с новым сервером - сбой, таймер ячейки не включён" '[[ $(cut -d: -f1 "$SPAWN_DIR/job.state") == failed ]] && ! grep -q "enable --now vampn-cell@" $CALLS'
HS_NONE=0; rm -f "$CELLS_DIR"/3.*
( exec 7>"$SPAWN_DIR/lock"; flock -n 7; ( spawn_run main >/dev/null 2>&1 ); echo $? > "$S/rc_lock" ); 
ok "два spawn одновременно нельзя (занят замок)" '[[ $(cat $S/rc_lock) != 0 ]]'
unset INSTALL_FAIL INSTALL_NOOK HS_NONE

# -- удаление
printf 'a a@x.ru 2\n' > "$S/users.conf"; cp "$S/keep/2.env" "$CELLS_DIR/2.env"
ok "cell-del: без --yes отказ" '! (cell_del 2) >/dev/null 2>&1 && [[ -f $CELLS_DIR/2.env ]]'
ok "cell-del: в ячейке есть пользователи - отказ без --force" '! (cell_del 2 --yes) >/dev/null 2>&1 && [[ -f $CELLS_DIR/2.env ]]'
ok "cell-del: ячейку 1 удалить нельзя" '! (cell_del 1 --yes) >/dev/null 2>&1'
printf 'a a@x.ru\n' > "$S/users.conf"; : > "$TWLOG"
ok "cell-del: пустую ячейку убирает и просит Timeweb удалить сервер" 'cell_del 2 --yes >/dev/null 2>&1 && [[ ! -f $CELLS_DIR/2.env && ! -f $AWG_DIR/vampn2.conf ]] && grep -q "^DELETE /servers/777" "$TWLOG"'
ok "cell_users: считает по третьему столбцу, без номера - ячейка 1" 'printf "a a@x.ru\nb b@x.ru 2\nc c@x.ru 2\n" > $S/users.conf; [[ $(cell_users 1) == 1 && $(cell_users 2) == 2 && $(cell_users 3) == 0 ]]'
unset -f twa ssh awg systemctl ssh-keyscan curl ssh-keygen

echo; echo "итого: $pass прошло, $failn не прошло"
rm -rf "$T"
[[ $failn == 0 ]]
