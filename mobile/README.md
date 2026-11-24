# vampn

Мобильное приложение для пользователей VPN vampn.

- **Вход по коду.** Приложение спрашивает почту, на неё приходит код из 4 цифр (10 минут, 6 попыток, затем блокировка на час). Входят только те, чья почта есть в списке пользователей vampn.
- **Роли.** Суперадмин (`ahilespelid`) видит список пользователей, добавляет и отзывает их, меняет IP принудительно и управляет аварийным каналом. Обычный пользователь видит статистику, управляет службой (смена IP, перезагрузка), получает свои ключи и уведомления. Списка пользователей у него нет.
- **Ключи.** Новый ключ приходит на почту и в приложение: при закрытом приложении push, при открытом уведомление появляется сразу: приложение держит живой поток (SSE, `src/sse.ts`) с сервером и по событию перечитывает список; если потока нет (обрыв, сервер без этой возможности), список опрашивается раз в 15 секунд, а поток переподключается сам. История выдачи и статусы (на почте, доставлено, прочитано) хранятся на сервере.
- **Оформление** как у проекта support: светлая и тёмная тема (по системе или вручную), красный сигнальный цвет, моноширинные подписи.
- **Сервер.** Адрес API по умолчанию `https://vamp.new.litewms.ru`; на экране входа и в «ещё» его можно заменить своим.

Серверная часть лежит в `../server/api` (FastAPI, база Percona), описание: `../server/api/README.md`.

Не сделано: push-уведомления при закрытом приложении (нужны Firebase для Android и сертификат Apple Developer для iOS), шрифты support (IBM Plex, Doto, DotGothic16) как файлы в нативных ресурсах, точечный фон.

В коде остались прежние модули прямого управления через SSH и Telegram (`src/ssh.ts`, `src/agent.ts`, `src/telegram.ts`, `src/buttonState.ts`, нативный модуль `NativeVampnSsh`). Новые экраны ими не пользуются.

## Android

```sh
cd mobile
npm install
npm run android
```

Release APK:

```sh
cd mobile/android
./gradlew assembleRelease
```

The APK is `android/app/build/outputs/apk/release/app-release.apk`. The debug keystore signs release builds so CI can assemble them. Replace that before shipping.

## Mac / iOS

On a Mac, with Xcode:

```sh
cd mobile
npm install
bundle install
cd ios && bundle exec pod install && cd ..
npm run ios
```

## Expo Go

On the phone, in Debian under UserLand:

```sh
command -v git >/dev/null 2>&1 || { apt-get update && apt-get install -y git; }; git clone https://github.com/ahilespelid/vampn.git 2>/dev/null || git -C vampn pull; cd vampn/mobile && sh setup-expo.sh
```

The script installs Node.js 22 if it is missing, installs dependencies and Expo, and starts the dev server on port 8081. Open the printed `exp://` link in Expo Go on the same phone.

Вход, роли, ключи и управление работают и там: им нужен только доступ к API. SSH не работает: в Expo Go нет модуля `NativeVampnSsh`.

## Tests

```sh
cd mobile
npm test
```
