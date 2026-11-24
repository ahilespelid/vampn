# vampn API

Сервис для мобильного приложения vampn: вход по коду на почту, роли, ключи, уведомления, управление VPN.
Работает на homeserv рядом с базой `vampn` (Percona) и запускает команды `/usr/local/sbin/vampn`.
Существующий агент `server/vampn_server.py` не затрагивается.

## Как это устроено

- **Вход.** `POST /v1/auth/request {email}` всегда отвечает `200`, письмо с 4-значным кодом уходит только известной почте.
  `POST /v1/auth/verify {email, code, device?}` выдаёт токен сессии (30 дней). Код живёт 10 минут, 6 попыток, затем блокировка почты на час.
  Не более 3 кодов в час на почту (в том числе на неизвестную, чтобы нельзя было узнать, есть ли почта). Отдельный лимит по IP.
- **Почта = учётки.** Под одной почтой может быть несколько имён (`mio`, `andrey`): после входа доступны ключи всех активных имён с этой почтой.
- **Роли.** `admin` (суперадмин): список и добавление пользователей, `rotate --force`, `emergency on/off`, история всех ключей.
  `user`: статус, `rotate`, `reboot`, свои ключи и уведомления.
- **Ключи.** Новый ключ рассылает сам `vampn` на почту; API дополнительно записывает выдачу (`keys`), создаёт уведомление (`notifications`:
  почта, push, доставлено, прочитано) и отправляет push. Сама ссылка `vpn://` в базе не хранится: приложение получает её запросом `POST /v1/keys/{name}/link`.
- **Пользователи.** Источник правды для приложения: таблица `users`. Скрипт `vampn-users-sync` на homeserv раз в минуту синхронизирует её с
  `/etc/vampn/users.conf` в обе стороны; отозванные не удаляются, а помечаются (`active=0`, `revoked_at`, история в `user_events`).
- **Команды `vampn`.** Только фиксированный список (`commands.py`), имена проверяются регулярным выражением; на хосте дополнительно ограничивает sudoers.

## Эндпоинты (префикс `/v1`)

| Метод и путь | Доступ | Что делает |
|---|---|---|
| `POST /auth/request`, `POST /auth/verify` | все | вход по коду |
| `POST /auth/logout`, `GET /me`, `POST /devices` | вошедшие | сессия, учётки, push-токен |
| `GET /status`, `GET /server`, `GET /stats` | вошедшие | статус сторожа/сервера VPN, метрики |
| `POST /control/rotate`, `POST /control/reboot` | вошедшие (`force` только admin) | смена IP, перезагрузка |
| `POST /control/emergency` | `status` всем, `on/off` admin | аварийный канал |
| `GET /keys`, `POST /keys/{name}/link\|resend\|reissue` | свои (admin любые) | ключи и история |
| `GET /notifications`, `POST /notifications/{id}/delivered\|read` | вошедшие | уведомления |
| `GET /admin/users`, `GET /admin/events`, `POST /admin/users`, `PATCH /admin/users/{name}` | admin | пользователи и история |

Ошибки: JSON `{"error": "...", "message": "..."}`; блокировка: `429` и заголовок `Retry-After`.

## Запуск и тесты

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/pytest -q                       # тесты на фейках, без базы
VAMPN_TEST_DB=127.0.0.1:3399:vampn:pass:vampn_test .venv/bin/pytest -q   # + интеграционные (очищает тестовую базу!)
```

Боевой запуск (файлы в `deploy/`, так стоит на homeserv): пользователь `vampn`, окружение `/etc/vampn-api/api.env` (см. `.env.example`),
служба `vampn-api.service`, правило `/etc/sudoers.d/vampn-api`, сайт `vamp.new.litewms.ru` в Caddy.
`deploy/install.sh` ставит всё одним запуском от root (архив кода кладётся в `/root/vampn-api-src.tar`), секреты берёт из файлов на сервере.
Caddy работает в Docker, поэтому API слушает адрес шлюза сети `litewms_net`, а не 127.0.0.1. `deploy/caddy-dns-fix.sh` чинил DNS в контейнере Caddy (без него не выпускались сертификаты).
Сборщик метрик для статистики: `../metrics`.

## Что ещё не сделано

- Push через Firebase (Android) и APNs (iOS): сейчас `NullPush`; для iOS нужна подпись Apple Developer.
- Живые уведомления при открытом приложении (сейчас опрос `GET /notifications`).
- Telegram-сообщение при блокировке входа (хук `on_lockout` уже есть).
