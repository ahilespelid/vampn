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

## Tests

```sh
cd mobile
npm test
```
