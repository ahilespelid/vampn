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
SELF=$T/fakeself; USERS_CONF=$T/users.conf; MAILLOG=$STATE/mail-status.tsv
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

echo; echo "итого: $pass прошло, $failn не прошло"
rm -rf "$T"
[[ $failn == 0 ]]
