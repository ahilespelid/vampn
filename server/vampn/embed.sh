#!/bin/bash
# embed.sh - вставляет install.sh внутрь скрипта vampn (команда `vampn spawn` отдаёт его новому серверу). Запускать после правки install.sh:
#   bash embed.sh        (test.sh проверяет, что встроенная копия совпадает с install.sh)
set -euo pipefail
cd "$(dirname "$0")"
a='# >>> install.sh (встроено командой embed.sh, не править здесь)'
b='# <<< install.sh'
grep -q '^INSTALL_EOF$' install.sh && { echo "в install.sh есть строка INSTALL_EOF" >&2; exit 1; }
python3 - "$a" "$b" <<'PY'
import sys
a, b = sys.argv[1], sys.argv[2]
s = open('vampn', encoding='utf-8').read()
body = open('install.sh', encoding='utf-8').read()
if not body.endswith('\n'): body += '\n'
block = a + "\ninstall_sh() { cat <<'INSTALL_EOF'\n" + body + "INSTALL_EOF\n}\n" + b + "\n"
i, j = s.find(a), s.find(b)
if i >= 0 and j > i:
    s = s[:i] + block + s[j + len(b) + 1:]
else:
    m = '\nhome_main() {'
    k = s.index(m)
    s = s[:k + 1] + block + '\n' + s[k + 1:]
open('vampn', 'w', encoding='utf-8').write(s)
PY
bash -n vampn && echo "встроено: $(sha256sum install.sh | cut -c1-12)"
