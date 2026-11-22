# vampn

One large button.

- While Telegram answers, the button says **есть интернет**. Pressing it runs the SSH commands from settings.
- When Telegram cannot be reached, the caption says **нет интернет** and the button says **сбросить IP**. Pressing it runs the reset commands.

Settings stores the SSH host, port, user, password or private key, both command lists, and the Telegram bot token and chat id on the device.

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

Telegram status and the button work there. SSH does not: Expo Go has no `NativeVampnSsh` module, so the log says the command is available only in the built app.

## Tests

```sh
cd mobile
npm test
```
