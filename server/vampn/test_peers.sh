#!/bin/bash
# Проверка команды vampn peers (статистика по ключам для приложения). Ничего не ставит и никуда не ходит:
# функции users_peers и home_peers вырезаются из скрипта vampn и запускаются с поддельными awg, ssh и состоянием.
# Запуск: bash test_peers.sh [путь/к/vampn]
set -uo pipefail
SRC=${1:-$(dirname "$0")/vampn}
fail=0
ok()  { echo "ok   $*"; }
bad() { echo "FAIL $*"; fail=1; }
eq()  {  # имя, получили, ждали
  if [[ $2 == "$3" ]]; then ok "$1"; else bad "$1"; printf '  ждали:\n%s\n  получили:\n%s\n' "$3" "$2"; fi
}
extract() { awk -v n="$1" '$0 ~ "^" n "\\(\\) \\{" {p=1} p {print} p && /^}/ {exit}' "$SRC"; }

bash -n "$SRC" && ok "синтаксис vampn" || bad "синтаксис vampn"

UP=$(extract users_peers); HP=$(extract home_peers)
[[ -n $UP && -n $HP ]] && ok "функции найдены" || { bad "функции users_peers/home_peers не найдены"; exit 1; }
eval "$UP"; eval "$HP"

T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
CL=$T/clients; mkdir -p "$CL"
for u in anna:PKA bob:PKB carol:PKC dave:PKD; do printf 'NAME=%s\nPUBKEY=%s\nIP=10.8.0.2\n' "${u%%:*}" "${u##*:}" > "$CL/${u%%:*}.env"; done

AWG_FAIL=0
awg() {
  [[ ${1:-} == show && ${2:-} == awg0 && ${3:-} == dump ]] || { echo "awg: неожиданный вызов $*" >&2; return 2; }
  (( AWG_FAIL )) && return 1
  printf 'PRIVATE\tPUBSRV\t51820\toff\n'
  printf 'PKA\tPSK1\t203.0.113.5:40000\t10.8.0.2/32\t1700000100\t1048576\t2097152\toff\n'
  printf 'PKB\t(none)\t(none)\t10.8.0.3/32\t0\t0\t0\toff\n'
  printf 'PKC\tPSK3\t[2001:db8::1]:5555\t10.8.0.4/32\t1700000200\t5\t6\toff\n'
  printf 'PKZ\tPSKZ\t198.51.100.99:1\t10.8.0.9/32\t1700000300\t7\t8\toff\n'   # ключ не из clients: в вывод не попадает
}

out=$(users_peers)
eq "users_peers: по строке на ключ" "$out" "$(printf 'anna\t203.0.113.5\t1700000100\t1048576\t2097152\nbob\t-\t0\t0\t0\ncarol\t2001:db8::1\t1700000200\t5\t6\ndave\t-\t0\t0\t0')"
for secret in PKA PKB PKC PKZ PSK1 PSK3 PRIVATE PUBSRV; do
  [[ $out == *"$secret"* ]] && bad "users_peers выдал секрет/лишнее: $secret"
done
ok "users_peers: ключей и конфигов в выводе нет"

AWG_FAIL=1
eq "users_peers: интерфейс не поднят - нули, не ошибка" "$(users_peers)" "$(printf 'anna\t-\t0\t0\t0\nbob\t-\t0\t0\t0\ncarol\t-\t0\t0\t0\ndave\t-\t0\t0\t0')"
AWG_FAIL=0

# home_peers: добавляет сервер и его IP, чужие строки отбрасывает
EM=0; REMOTE_FAIL=0
em_active() { (( EM )); }
em_init() { EM_HOST=192.0.2.9; }
tw_label() { echo основной; }
tun_endpoint() { echo 198.51.100.7; }
die() { echo "vampn: $*" >&2; exit 1; }
remote() { (( REMOTE_FAIL )) && return 1; [[ $1 == peers ]] || return 2; printf 'шум без табуляций\n'; users_peers; }
em_ssh() { [[ $1 == peers ]] || return 2; printf 'eve\t192.0.2.50\t1700000400\t10\t20\n'; }

want=$(printf 'основной\t198.51.100.7\tanna\t203.0.113.5\t1700000100\t1048576\t2097152\nосновной\t198.51.100.7\tbob\t-\t0\t0\t0\nосновной\t198.51.100.7\tcarol\t2001:db8::1\t1700000200\t5\t6\nосновной\t198.51.100.7\tdave\t-\t0\t0\t0')
eq "home_peers: основной сервер" "$(home_peers)" "$want"
EM=1
eq "home_peers: аварийный режим спрашивает аварийный сервер" "$(home_peers)" "$(printf 'аварийный\t192.0.2.9\teve\t192.0.2.50\t1700000400\t10\t20')"
EM=0; REMOTE_FAIL=1
res=$( (home_peers) 2>&1 ); code=$?
[[ $code -ne 0 && $res == *"VPN-сервер не ответил"* ]] && ok "home_peers: нет ответа сервера - ошибка с понятным текстом" || bad "home_peers: код $code, вывод: $res"

# peers разрешён во всех списках и ничего не меняет
[[ $(grep -c 'userspush|list|peers|status|selfupdate)' "$SRC") -eq 1 ]] && ok "peers в списке VPN-сервера (remote)" || bad "peers нет в списке VPN-сервера"
[[ $(grep -c 'on|off|peers|status|selfupdate)' "$SRC") -eq 1 ]] && ok "peers в списке аварийного сервера (remote)" || bad "peers нет в списке аварийного сервера"
grep -q '^    peers)  home_peers ;;' "$SRC" && ok "peers в команде homeserv" || bad "peers нет в команде homeserv"
grep -q '^    peers)  data_init; users_peers ;;' "$SRC" && ok "peers в командах серверов" || bad "peers нет в командах серверов"
if { printf '%s\n%s\n' "$UP" "$HP"; } | grep -Eq '(awg set|awg-quick|systemctl|\brm\b|\btee\b|>>|\bmv\b|\bcp\b|\bchmod\b)'; then
  bad "peers должна только читать, а в ней есть запись или управление"
else
  ok "peers только читает"
fi

exit $fail
