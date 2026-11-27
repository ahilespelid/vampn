#!/bin/bash
# install.sh - разворачивает VPN-сервер vampn на ЧИСТОМ Debian 13 (root) за несколько минут.
# Его запускает `vampn spawn` на homeserv (после аренды сервера в Timeweb); вручную тоже можно.
# Что ставит: AmneziaWG (модуль DKMS из PPA Amnezia + утилиты из исходников, версия закреплена), nftables, sysctl, sshd только по ключам,
# скрипт vampn + таймер самопроверки, ключи и параметры маскировки САМОГО сервера (у каждой ячейки свои), ключи homeserv с ограничениями.
# Идемпотентен: повторный запуск ничего не ломает, существующие ключи и конфиги сервера не перезаписываются.
#
#   install.sh --net 10.77.4 --payload DIR --key-root 'ssh-ed25519 ...' --key-users '...' --key-mirror '...'
#              [--public-ip IP] [--span 4] [--limit 1000] [--port N] [--home-public-ip IP] [--admin-key '...']... [--no-game] [--name vampn_2]
#              [--packages-only]                 только поставить пакеты, модуль AmneziaWG и утилиты awg (так работает `vampn init`)
#              [--render-only --root DIR]        только записать файлы в DIR (для проверки), ничего не ставить и не запускать
#   В DIR (--payload): vampn (скрипт), amnezia.gpg (ключ PPA), secrets.env (почта через homeserv: MAIL_METHOD=relay ...), необязательно.
# В конце печатает строки "VAMPN_*=..." (порт, публичный ключ сервера, ключ для почты) - их читает spawn.
set -euo pipefail

TOOLS_TAG=v3.1.20260812 TOOLS_COMMIT=ee0f0a9aa34ff0a0da4b3433b9512781cfe02843   # amnezia-vpn/amneziawg-tools, как на рабочих серверах
NET="" SPAN=4 LIMIT=1000 PORT="" PUBLIC_IP="" HOME_PUB_IP="" PAYLOAD="" NAME="" GAME=1 RENDER_ONLY=0 ROOT="" PACKAGES_ONLY=0
KEY_ROOT="" KEY_USERS="" KEY_MIRROR="" ADMIN_KEYS=()
say() { echo "[install] $*" >&2; }
die() { echo "install.sh: $*" >&2; exit 1; }

while (( $# )); do
  case $1 in
    --net) NET=$2; shift 2 ;;            --span) SPAN=$2; shift 2 ;;      --limit) LIMIT=$2; shift 2 ;;
    --port) PORT=$2; shift 2 ;;          --payload) PAYLOAD=$2; shift 2 ;; --name) NAME=$2; shift 2 ;;
    --home-public-ip) HOME_PUB_IP=$2; shift 2 ;;  --public-ip) PUBLIC_IP=$2; shift 2 ;;
    --key-root) KEY_ROOT=$2; shift 2 ;;  --key-users) KEY_USERS=$2; shift 2 ;; --key-mirror) KEY_MIRROR=$2; shift 2 ;;
    --admin-key) ADMIN_KEYS+=("$2"); shift 2 ;;
    --no-game) GAME=0; shift ;;
    --packages-only) PACKAGES_ONLY=1; shift ;;
    --render-only) RENDER_ONLY=1; shift ;; --root) ROOT=${2%/}; shift 2 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) die "неизвестный параметр $1" ;;
  esac
done

# ---------- проверка входных данных ----------
if (( PACKAGES_ONLY )); then [[ $EUID == 0 ]] || die "нужен root"; ROOT=""; else
[[ $NET =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]] || die "--net: три октета, например 10.77.4"
[[ $SPAN =~ ^[1-4]$ ]] || die "--span: от 1 до 4 подряд идущих /24"
[[ $LIMIT =~ ^[0-9]+$ ]] || die "--limit: число"
[[ -z $PORT || $PORT =~ ^[0-9]{4,5}$ ]] || die "--port: число"
[[ -z $PUBLIC_IP || $PUBLIC_IP =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || die "--public-ip: адрес IPv4"
[[ -z $HOME_PUB_IP || $HOME_PUB_IP =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || die "--home-public-ip: адрес IPv4"
okkey() { [[ $1 =~ ^ssh-(ed25519|rsa)\ [A-Za-z0-9+/=]+(\ [^\"\']*)?$ ]]; }
for k in "$KEY_ROOT" "$KEY_USERS" "$KEY_MIRROR" "${ADMIN_KEYS[@]}"; do [[ -z $k ]] || okkey "$k" || die "не похоже на открытый ключ ssh: ${k:0:30}"; done
[[ -n $KEY_ROOT && -n $KEY_USERS && -n $KEY_MIRROR ]] || die "нужны --key-root, --key-users и --key-mirror (открытые ключи homeserv)"
[[ -n $PAYLOAD && -f $PAYLOAD/vampn ]] || die "--payload DIR: в каталоге должен лежать скрипт vampn"
if (( ! RENDER_ONLY )); then [[ $EUID == 0 ]] || die "нужен root"; ROOT=""; else [[ -n $ROOT ]] || die "--render-only требует --root DIR"; fi

HOME_TIP=$NET.3 SRV_TIP=$NET.1
case $SPAN in 1) CIDR=24 ;; 2) CIDR=23 ;; *) CIDR=22; SPAN=4 ;; esac   # три /24 подряд в одну маску не уложить - берём /22 (третий октет сети кратен числу /24)
(( ${NET##*.} % SPAN == 0 )) || die "--net: третий октет ${NET##*.} не кратен $SPAN (сеть /$CIDR должна начинаться на границе)"
D=$ROOT/etc/amnezia/amneziawg V=$ROOT/root/vampn
fi

# ---------- что записать: функции без побочных эффектов, кроме файлов ----------
rnd() { shuf -i "$1-$2" -n 1; }

gen_params() {  # параметры маскировки AmneziaWG 2.0 (как setup_awg.sh на основном сервере); ключи сервера - только если конфига ещё нет
  [[ -n $PORT ]] || PORT=$(rnd 30000 60999)
  JC=$(rnd 4 8); JMIN=$(rnd 40 80); JMAX=$(rnd 600 1000)
  while :; do S1=$(rnd 15 150); S2=$(rnd 15 150); (( S1 + 56 != S2 )) && break; done
  S3=$(rnd 15 64); S4=$(rnd 4 24)
  local b; b=$(rnd 100000000 400000000)
  H1="$b-$((b + 50000000))"; H2="$((b + 60000000))-$((b + 110000000))"; H3="$((b + 120000000))-$((b + 170000000))"; H4="$((b + 180000000))-$((b + 230000000))"
  I1="<b 0xc30000000108><r 8><b 0x0000449e><r 1150>"   # имитация QUIC v1 Initial
}

write_awg() {
  install -d -m 700 "$D" "$V" "$V/clients"
  [[ -n $PUBLIC_IP ]] && ! [[ -f $V/endpoint ]] && echo "$PUBLIC_IP" > "$V/endpoint"
  if [[ -f $D/awg0.conf ]]; then say "awg0.conf уже есть - ключи и параметры сервера не трогаю"; return 0; fi
  [[ -f $V/endpoint ]] || { PUBLIC_IP=$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p'); [[ -n $PUBLIC_IP ]] && echo "$PUBLIC_IP" > "$V/endpoint"; }
  gen_params
  local sk pk; sk=$(awg genkey); pk=$(echo "$sk" | awg pubkey)
  ( umask 077
    cat > "$D/awg0.conf" <<EOF
[Interface]
Address = $SRV_TIP/$CIDR
ListenPort = $PORT
PrivateKey = $sk
Jc = $JC
Jmin = $JMIN
Jmax = $JMAX
S1 = $S1
S2 = $S2
S3 = $S3
S4 = $S4
H1 = $H1
H2 = $H2
H3 = $H3
H4 = $H4
EOF
    cat > "$V/server.env" <<EOF
SERVER_PUBKEY=$pk
PORT=$PORT
JC=$JC
JMIN=$JMIN
JMAX=$JMAX
S1=$S1
S2=$S2
S3=$S3
S4=$S4
H1=$H1
H2=$H2
H3=$H3
H4=$H4
I1='$I1'
MTU=$((1420 - S4 - 20))
SUBNET=$NET
SUBNET_SPAN=$SPAN
SUBNET_CIDR=$CIDR
CLIENT_LIMIT=$LIMIT
EOF
  )
}

write_sysctl() {
  install -d "$ROOT/etc/sysctl.d"
  cat > "$ROOT/etc/sysctl.d/90-vampn.conf" <<'EOF'
net.ipv4.ip_forward = 1
net.ipv4.icmp_echo_ignore_all = 1
net.ipv6.icmp.echo_ignore_all = 1
net.ipv4.tcp_syncookies = 1
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.all.accept_redirects = 0
net.ipv6.conf.all.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
net.mptcp.enabled = 0
EOF
}

write_nft() {
  local port; port=$(awk -F' *= *' '/^ListenPort/{print $2; exit}' "$D/awg0.conf")
  local ssh_pub="" game_fwd="" game_nat=""
  [[ -z $HOME_PUB_IP ]] || ssh_pub="        # homeserv по публичному адресу (если туннель лёг): только ssh и только с него
        ip saddr $HOME_PUB_IP tcp dport 22 accept"
  if (( GAME )); then
    game_fwd="        # Minecraft и голосовой чат на homeserv ($HOME_TIP) - только для клиентов VPN
        iifname \$VPN oifname \$VPN ip daddr $HOME_TIP tcp dport 25565 accept
        iifname \$VPN oifname \$VPN ip daddr $HOME_TIP udp dport 24454 accept"
    game_nat="        ip saddr $NET.0/$CIDR ip daddr $HOME_TIP tcp dport 25565 oifname \$VPN masquerade
        ip saddr $NET.0/$CIDR ip daddr $HOME_TIP udp dport 24454 oifname \$VPN masquerade"
  fi
  install -d "$ROOT/etc"
  cat > "$ROOT/etc/nftables.conf" <<EOF
#!/usr/sbin/nft -f
# vampn firewall (install.sh): наружу открыт только порт AmneziaWG; ssh - только из туннеля с адреса homeserv.
flush ruleset

define WAN = "eth0"
define VPN = "awg0"
define AWG_PORT = $port

table inet filter {
    chain input {
        type filter hook input priority 0; policy drop;
        iif lo accept
        ct state invalid drop
        ct state established,related accept
        meta l4proto ipv6-icmp icmpv6 type { nd-neighbor-solicit, nd-neighbor-advert, nd-router-advert, packet-too-big } accept
        iifname \$WAN udp dport \$AWG_PORT accept
        iifname \$VPN ip saddr $HOME_TIP tcp dport 22 accept
${ssh_pub}
    }

    chain forward {
        type filter hook forward priority 0; policy drop;
        tcp flags syn tcp option maxseg size set rt mtu
        ct state invalid drop
        ct state established,related accept
        iifname \$VPN oifname \$WAN accept
${game_fwd}
    }

    chain output {
        type filter hook output priority 0; policy accept;
    }
}

table ip nat {
    chain postrouting {
        type nat hook postrouting priority 100;
        ip saddr $NET.0/$CIDR oifname \$WAN masquerade
${game_nat}
    }
}
EOF
  chmod 755 "$ROOT/etc/nftables.conf"
}

write_ssh() {
  install -d -m 700 "$ROOT/root/.ssh"; install -d "$ROOT/etc/ssh/sshd_config.d"
  cat > "$ROOT/etc/ssh/sshd_config.d/00-vampn.conf" <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
  local ak=$ROOT/root/.ssh/authorized_keys tmp k; tmp=$(mktemp)
  [[ -f $ak ]] && grep -vE ' (homeserv|homeserv-mirror|homeserv-users|vampn-admin)$' "$ak" > "$tmp" || true
  for k in "${ADMIN_KEYS[@]}"; do echo "$k"; done | awk 'NF' | sed -E 's/^(ssh-[a-z0-9-]+ [A-Za-z0-9+\/=]+).*/\1 vampn-admin/' >> "$tmp"
  echo "restrict,from=\"$HOME_TIP\",command=\"tar -C /root/vampn -czf - server.env endpoint clients\" $(awk '{print $1, $2}' <<<"$KEY_MIRROR") homeserv-mirror" >> "$tmp"
  echo "restrict,from=\"$HOME_TIP\",command=\"/usr/local/sbin/vampn remote\" $(awk '{print $1, $2}' <<<"$KEY_USERS") homeserv-users" >> "$tmp"
  echo "$(awk '{print $1, $2}' <<<"$KEY_ROOT") homeserv" >> "$tmp"
  install -m 600 "$tmp" "$ak"; rm -f "$tmp"
}

write_units() {
  install -d "$ROOT/etc/systemd/system" "$ROOT/usr/local/sbin"
  install -m 755 "$PAYLOAD/vampn" "$ROOT/usr/local/sbin/vampn"
  cat > "$ROOT/etc/systemd/system/vampn.service" <<'EOF'
[Unit]
Description=vampn: self-check (firewall, awg0, network, public IP change)
Wants=network-online.target
After=network-online.target awg-quick@awg0.service nftables.service
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/vampn check
EOF
  cat > "$ROOT/etc/systemd/system/vampn.timer" <<'EOF'
[Unit]
Description=vampn: self-check every minute
[Timer]
OnBootSec=30
OnUnitActiveSec=60
AccuracySec=10
[Install]
WantedBy=timers.target
EOF
  install -d -m 700 "$ROOT/etc/vampn"
  if [[ -f $PAYLOAD/secrets.env ]]; then install -m 600 "$PAYLOAD/secrets.env" "$ROOT/etc/vampn/secrets.env"
  else printf 'MAIL_METHOD=relay\nRELAY_HOST=%s\nRELAY_PORT=777\n' "$HOME_TIP" > "$ROOT/etc/vampn/secrets.env"; chmod 600 "$ROOT/etc/vampn/secrets.env"; fi
  grep -q '^RELAY_HOST=' "$ROOT/etc/vampn/secrets.env" || printf 'RELAY_HOST=%s\n' "$HOME_TIP" >> "$ROOT/etc/vampn/secrets.env"
}

# ---------- то, что делается только на живом сервере ----------
install_packages() {
  say "пакеты"
  export DEBIAN_FRONTEND=noninteractive
  # у новых серверов Timeweb сеть бывает с потерями: apt сам повторяет загрузки
  local -a APT=(apt-get -o Acquire::Retries=8 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30)
  "${APT[@]}" update -qq
  "${APT[@]}" install -y -qq curl jq nftables python3 ca-certificates gnupg git make gcc build-essential dkms perl \
      "linux-headers-$(uname -r)" openssh-server unattended-upgrades systemd-timesyncd traceroute qrencode >/dev/null
  if [[ -f $PAYLOAD/amnezia.gpg ]]; then install -m 644 "$PAYLOAD/amnezia.gpg" /usr/share/keyrings/amnezia.gpg
  elif [[ ! -s /usr/share/keyrings/amnezia.gpg ]]; then
    # на чистом сервере ключа ещё нет (его кладёт spawn): пробуем взять с сервера ключей Ubuntu
    local g; g=$(mktemp -d); chmod 700 "$g"
    GNUPGHOME=$g gpg -q --batch --keyserver hkps://keyserver.ubuntu.com --recv-keys 75C9DD72C799870E310542E24166F2C257290828 >/dev/null 2>&1 \
      && GNUPGHOME=$g gpg -q --batch --export 75C9DD72C799870E310542E24166F2C257290828 > /usr/share/keyrings/amnezia.gpg 2>/dev/null || true
    rm -rf "$g"
    [[ -s /usr/share/keyrings/amnezia.gpg ]] || die "нет ключа PPA Amnezia: положите amnezia.gpg в /usr/share/keyrings или в --payload"
  fi
  echo 'deb [signed-by=/usr/share/keyrings/amnezia.gpg] https://ppa.launchpadcontent.net/amnezia/ppa/ubuntu noble main' > /etc/apt/sources.list.d/amnezia.list
  "${APT[@]}" update -qq
  "${APT[@]}" install -y -qq amneziawg-dkms >/dev/null
  modprobe amneziawg 2>/dev/null || dkms autoinstall >/dev/null 2>&1 || true
  modprobe amneziawg || die "модуль amneziawg не загрузился (dkms status: $(dkms status 2>&1 | head -2 | tr '\n' ' '))"
}

install_tools() {
  if command -v awg >/dev/null && awg --version 2>&1 | grep -q "${TOOLS_TAG#v}"; then say "утилиты awg уже стоят"; return 0; fi
  say "утилиты awg ($TOOLS_TAG)"
  local src=/usr/local/src/amneziawg-tools
  if [[ ! -d $src/.git ]]; then
    local t; for t in 1 2 3 4 5; do rm -rf "$src"; git clone -q https://github.com/amnezia-vpn/amneziawg-tools "$src" && break; sleep 5; done
    [[ -d $src/.git ]] || die "не удалось скачать amneziawg-tools с GitHub"
  fi
  git -C "$src" fetch -q --tags origin 2>/dev/null || true
  git -C "$src" checkout -q "$TOOLS_COMMIT"
  make -C "$src/src" -j2 >/dev/null
  make -C "$src/src" install PREFIX=/usr WITH_SYSTEMDUNITS=yes WITH_WGQUICK=yes >/dev/null
  command -v awg >/dev/null || die "awg не установился"
}

activate() {
  say "запуск"
  systemctl daemon-reload
  sysctl -q --system
  systemctl enable --now nftables >/dev/null 2>&1; nft -f /etc/nftables.conf
  sshd -t && systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
  systemctl enable --now awg-quick@awg0 >/dev/null
  systemctl enable --now vampn.timer >/dev/null
  if [[ -n $NAME ]]; then hostnamectl set-hostname "$NAME" 2>/dev/null || hostnamectl set-hostname "${NAME//_/-}" 2>/dev/null || true; fi
  [[ -f /root/.ssh/mailrelay ]] || ssh-keygen -q -t ed25519 -N '' -C "vampn-mailrelay" -f /root/.ssh/mailrelay
  # настройки автообновлений безопасности остаются по умолчанию Debian
}

verify() {
  ip link show awg0 >/dev/null 2>&1 || die "интерфейс awg0 не поднялся"
  ss -lunH "sport = :$(awk -F' *= *' '/^ListenPort/{print $2; exit}' "$D/awg0.conf")" | grep -q . || die "порт VPN не слушается"
  nft list table inet filter >/dev/null 2>&1 || die "nftables не загружен"
  [[ $(sysctl -n net.ipv4.ip_forward) == 1 ]] || die "ip_forward выключен"
  /usr/local/sbin/vampn status >/dev/null 2>&1 || die "vampn status не отработал"
}

# ---------- ход ----------
if (( RENDER_ONLY )); then
  [[ -z ${FAKE_BIN:-} ]] || PATH=$FAKE_BIN:$PATH
  write_awg; write_sysctl; write_nft; write_ssh; write_units
  say "записано в $ROOT (render-only)"
  exit 0
fi
install_packages
install_tools
if (( PACKAGES_ONLY )); then say "пакеты и утилиты awg готовы"; echo "VAMPN_INIT_OK=1"; exit 0; fi
write_awg; write_sysctl; write_nft; write_ssh; write_units
activate
"/usr/local/sbin/vampn" homeinit >/dev/null     # создаёт пира homeserv (адрес $NET.3); его конфиг homeserv заберёт командой `vampn homeconf`
verify
echo "VAMPN_PORT=$(awk -F' *= *' '/^ListenPort/{print $2; exit}' "$D/awg0.conf")"
echo "VAMPN_SERVER_PUBKEY=$(sed -n 's/^SERVER_PUBKEY=//p' "$V/server.env")"
echo "VAMPN_MAILRELAY_PUB=$(awk '{print $1, $2}' /root/.ssh/mailrelay.pub)"
echo "VAMPN_INSTALL_OK=1"
