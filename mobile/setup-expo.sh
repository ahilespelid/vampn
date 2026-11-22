#!/bin/sh
# Install Node if needed, install the app and Expo, then serve it on port 8081.
set -eu
cd "$(dirname "$0")"
export PATH="/usr/local/bin:$PATH"

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 13) ? 0 : 1)'
}

if ! node_ok; then
  echo "Ставлю Node.js 22..."
  if ! command -v curl >/dev/null 2>&1 || ! command -v tar >/dev/null 2>&1; then
    if [ "$(id -u)" -eq 0 ]; then
      apt-get update
      apt-get install -y ca-certificates curl tar xz-utils
    else
      sudo apt-get update
      sudo apt-get install -y ca-certificates curl tar xz-utils
    fi
  fi
  case "$(uname -m)" in
    aarch64|arm64) node_arch=arm64 ;;
    armv7l) node_arch=armv7l ;;
    x86_64|amd64) node_arch=x64 ;;
    i686|i386) node_arch=x86 ;;
    *)
      echo "Неизвестная архитектура: $(uname -m)" >&2
      exit 1
      ;;
  esac
  version=$(curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt | sed -n "s/.*node-v\\(22\\.[0-9][0-9.]*\\)-linux-${node_arch}\\.tar\\.xz/\\1/p" | head -n 1)
  if [ -z "$version" ]; then
    echo "Не удалось определить версию Node.js 22." >&2
    exit 1
  fi
  tmp=$(mktemp -d)
  url="https://nodejs.org/dist/v${version}/node-v${version}-linux-${node_arch}.tar.xz"
  curl -fsSL "$url" -o "$tmp/node.tar.xz"
  if [ "$(id -u)" -eq 0 ]; then
    tar -xJf "$tmp/node.tar.xz" -C /usr/local --strip-components=1
  else
    sudo tar -xJf "$tmp/node.tar.xz" -C /usr/local --strip-components=1
  fi
  rm -rf "$tmp"
  hash -r || true
fi

npm install
npm install expo@~58.0.26

export EXPO_NO_TELEMETRY=1
echo "Сервер Expo: порт 8081. Откройте показанную ссылку exp:// в Expo Go на этом телефоне."
exec npx expo start --port 8081 --host lan --go
