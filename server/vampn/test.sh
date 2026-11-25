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
a=$(grep -n '^IFACE=vampn' "$FILE" | cut -d: -f1); b=$(grep -n '^home_main()' "$FILE" | cut -d: -f1)
sed -n "${a},$((b-1))p" "$FILE" > "$T/seg.sh"
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
reset() { : > "$CALLS"; rm -rf "$STATE" "$T/twn"; mkdir -p "$STATE/mirror"; touch "$STATE/mirror/server.env"; FAKE_NOW=1000000; TW_NOW=on; TW_LATE=on; }
log() { echo "LOG $*" >> "$CALLS"; }
do_reboot() { echo "reboot ${1:-soft}" >> "$CALLS"; return 0; }
all_ipv4() { cat "$T/ips" 2>/dev/null; }
main_ipv4() { head -1 "$T/ips"; }
tun_set_endpoint() { echo "endpoint $1" >> "$CALLS"; echo "$1" > "$T/ep"; }
tun_endpoint() { cat "$T/ep" 2>/dev/null || echo 1.1.1.1; }
mail_from_mirror() { echo "keys-mail $1" >> "$CALLS"; return "${MAIL_RC:-0}"; }
pull_mirror() { :; }
push_users() { :; }
em_active() { return 1; }
inet_ok() { return 0; }
TW_LATE=on
tw_status() { local n; n=$(cat "$T/twn" 2>/dev/null || echo 0); echo $((n+1)) > "$T/twn"; if (( n >= 1 )) && [[ $TW_LATE != on ]]; then echo "$TW_LATE"; else echo "${TW_NOW:-on}"; fi; }
emergency_on() { echo emergency-on >> "$CALLS"; }
# Timeweb: POST отдаёт адреса по очереди, DELETE пишет в журнал
NEXT=0
api() {
  if [[ $1 == POST ]]; then local c n; n=$(cat "$T/next" 2>/dev/null || echo 0); c=$(sed -n "$((n+1))p" "$T/cands"); echo $((n+1)) > "$T/next"; echo "POST-ip $c" >> "$CALLS"; echo "$c" >> "$T/ips"
    echo "{\"server_ip\":{\"ip\":\"$c\"}}"
  elif [[ $1 == DELETE ]]; then local d; d=$(jq -r .ip <<<"$3"); echo "DELETE-ip $d" >> "$CALLS"; sed -i "/^$d\$/d" "$T/ips"; echo '{}'
  else echo '{}'; fi
}
routed_list() { printf '%s\n' "$@" > "$T/routed"; }
ip_routed() { grep -qx "$1" "$T/routed"; }
HS=0   # когда появится "новое рукопожатие" (0 = никогда)
wait_new_handshake() { echo "wait-hs since=$1 secs=$2" >> "$CALLS"; (( HS )); }
notify() { echo "NOTIFY $1" >> "$CALLS"; }

echo "== 1. смена IP: первые два адреса режутся, третий проходит"
reset; printf '9.9.9.9\n' > "$T/ips"; printf 'A.A.A.1\nA.A.A.2\nA.A.A.3\n' > "$T/cands"; rm -f "$T/next"; HS=1
routed_list A.A.A.3; rm -f "$T/ep"
rotate >/dev/null 2>&1; rc=$?
ok "rotate вернул 0" "[[ $rc == 0 ]]"
ok "лишние адреса 1 и 2 убраны" "grep -q 'DELETE-ip A.A.A.1' $CALLS && grep -q 'DELETE-ip A.A.A.2' $CALLS"
ok "старый адрес удалён только после успешного подбора" "[[ \$(grep -n -E 'DELETE-ip 9.9.9.9' $CALLS | cut -d: -f1) -gt \$(grep -n 'POST-ip A.A.A.3' $CALLS | cut -d: -f1) ]]"
ok "адрес A.A.A.3 остался, он единственный" "[[ \$(cat $T/ips | tr '\n' ' ') == 'A.A.A.3 ' ]]"
ok "ключи разосланы ровно один раз" "[[ \$(grep -c 'keys-mail' $CALLS) == 1 ]]"
ok "ключи ушли с новым адресом" "grep -q 'keys-mail A.A.A.3' $CALLS"
ok "ключи после ожидания нового рукопожатия" "[[ \$(grep -n 'wait-hs' $CALLS | cut -d: -f1) -lt \$(grep -n 'keys-mail' $CALLS | cut -d: -f1) ]]"
ok "метка ожидания равна моменту переключения" "grep -q 'wait-hs since=1000000' $CALLS"
ok "ждёт рукопожатие 150 с, а не 8 минут" "grep -q 'secs=150' $CALLS && [[ \$(grep -c wait-hs $CALLS) == 1 ]]"
ok "удачная смена записана тремя полями" "[[ \$(awk 'NF==3' $STATE/rotations | wc -l) == 1 ]]"
ok "счётчика неудач нет" "[[ ! -e $STATE/rot_fails ]]"
ok "отложенной рассылки не осталось" "[[ ! -e $STATE/keys_pending ]]"
ok "смена записана в rotations" "grep -q '9.9.9.9 A.A.A.3' $STATE/rotations"
ok "сообщение об успехе" "grep -q 'NOTIFY IP сменён: 9.9.9.9 → A.A.A.3' $CALLS"

echo "== 2. все 6 адресов режутся"
reset; printf '9.9.9.9\n' > "$T/ips"; printf 'B1\nB2\nB3\nB4\nB5\nB6\nB7\n' > "$T/cands"; rm -f "$T/next"; HS=1; routed_list none
rotate >/dev/null 2>&1; rc=$?
ok "rotate вернул 1" "[[ $rc == 1 ]]"
ok "старый адрес НЕ удалён" "! grep -q 'DELETE-ip 9.9.9.9' $CALLS"
ok "сделано ровно 6 попыток" "[[ \$(grep -c POST-ip $CALLS) == 6 ]]"
ok "все кандидаты убраны, остался только старый" "[[ \$(cat $T/ips | tr '\n' ' ') == '9.9.9.9 ' ]]"
ok "ключи не рассылались" "! grep -q keys-mail $CALLS"
ok "перезагрузки VPS не было" "! grep -q reboot $CALLS"
ok "повтор разрешён через 3 минуты, не через час" "[[ \$(get last_rotation) == \$((1000000 - 3600 + 180)) ]]"
ok "в rotations ничего не записано" "[[ ! -s $STATE/rotations ]]"
ok "сообщение о неудаче подбора" "grep -q 'не нашёл адрес' $CALLS"

echo "== 3. адрес проходит, но туннель не поднялся"
reset; printf '9.9.9.9\n' > "$T/ips"; printf 'C1\n' > "$T/cands"; rm -f "$T/next"; HS=0; routed_list C1
rotate >/dev/null 2>&1; rc=$?
ok "rotate вернул 1" "[[ $rc == 1 ]]"
ok "ключи НЕ разосланы" "! grep -q keys-mail $CALLS"
ok "рассылка отложена до связи" "[[ \$(get keys_pending) == C1 ]]"
ok "жёсткая перезагрузка" "grep -q 'reboot hard' $CALLS"
ok "неудача помечена fail и в суточный лимит не идёт" "grep -q '9.9.9.9 C1 fail' $STATE/rotations && [[ \$(awk 'NF==3' $STATE/rotations | wc -l) == 0 ]]"
ok "счётчик неудач подряд = 1" "[[ \$(get rot_fails) == 1 ]]"
ok "повтор разрешён через 3 минуты" "[[ \$(get last_rotation) == \$((1000000 - 3600 + 180)) ]]"
ok "один проход ожидания (сервер on)" "[[ \$(grep -c wait-hs $CALLS) == 1 ]]"
echo "== 3б. сервер в Timeweb ещё грузится: ожидание продлевается один раз"
reset; printf '9.9.9.9\n' > "$T/ips"; printf 'C2\n' > "$T/cands"; rm -f "$T/next"; HS=0; routed_list C2; TW_LATE=rebooting
rotate >/dev/null 2>&1
ok "два ожидания: 150 и 120 с" "[[ \$(grep -c wait-hs $CALLS) == 2 ]] && grep -q 'secs=120' $CALLS"
echo "== 3в. после 3 неудач подряд автосмена стоит, ручная --force идёт"
reset; printf '9.9.9.9\n' > "$T/ips"; printf 'C3\n' > "$T/cands"; rm -f "$T/next"; HS=1; routed_list C3; put rot_fails 3
rotate >/dev/null 2>&1; rc=$?
ok "автосмена не пошла" "[[ $rc == 1 ]] && ! grep -q POST-ip $CALLS"
ok "одно сообщение о тупике" "[[ \$(grep -c 'смены IP подряд не помогли' $CALLS) == 1 ]]"
: > "$CALLS"; rotate >/dev/null 2>&1
ok "второй раз то же сообщение не шлётся" "! grep -q 'смены IP подряд' $CALLS"
: > "$CALLS"; rotate --force >/dev/null 2>&1; rc=$?
ok "ручная смена --force проходит" "[[ $rc == 0 ]] && grep -q POST-ip $CALLS"
ok "после успеха счётчик неудач сброшен" "[[ ! -e $STATE/rot_fails ]]"
echo "== 3г. статус сервера не on: смена IP не начинается"
reset; printf '9.9.9.9\n' > "$T/ips"; printf 'D1\n' > "$T/cands"; rm -f "$T/next"; HS=1; routed_list D1; TW_NOW=off
rotate >/dev/null 2>&1; rc=$?
ok "rotate вернул 1, Timeweb не трогали" "[[ $rc == 1 ]] && ! grep -q POST-ip $CALLS"
ok "в журнале причина" "grep -q 'статус сервера в Timeweb off' $CALLS"
rotate --force >/dev/null 2>&1; rc=$?
ok "и ручная --force тоже ждёт статуса on" "[[ $rc == 1 ]] && ! grep -q POST-ip $CALLS"
echo "== 3д. неудачные смены не мешают суточному лимиту удачных"
reset; printf '9.9.9.9\n' > "$T/ips"; printf 'E1\n' > "$T/cands"; rm -f "$T/next"; HS=1; routed_list E1
printf '%s a b fail\n%s a b fail\n%s a b fail\n%s a b fail\n' 999000 999100 999200 999300 > "$STATE/rotations"; put last_rotation 0
rotate >/dev/null 2>&1; rc=$?
ok "четыре неудачи за сутки не блокируют смену" "[[ $rc == 0 ]] && grep -q POST-ip $CALLS"

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

echo; echo "итого: $pass прошло, $failn не прошло"
rm -rf "$T"
[[ $failn == 0 ]]
