import type * as KeychainTypes from 'react-native-keychain';

type KeychainModule = typeof KeychainTypes;

// Имя пользователя в записи keychain: пакету нужна пара «имя + пароль», роль пароля играет токен сессии.
// Имя сервиса не задаётся: пакет берёт идентификатор приложения.
const ACCOUNT = 'session';

let cached: KeychainModule | null | undefined;

/** Модуль keychain подключается лениво: без нативной части (Expo Go, тесты) сам импорт пакета бросает ошибку. */
function keychain(): KeychainModule | null {
  if (cached === undefined) {
    try {
      cached = require('react-native-keychain') as KeychainModule;
    } catch {
      cached = null;
    }
  }
  return cached;
}

export function secureStorageAvailable(): boolean {
  return keychain() !== null;
}

/** `ok: false` — хранилища нет или чтение не удалось; `token: null` — хранилище работает, но токена в нём нет. */
export type SecureRead = {ok: true; token: string | null} | {ok: false};

export async function readSecureToken(): Promise<SecureRead> {
  const module = keychain();
  if (!module) {
    return {ok: false};
  }
  try {
    const found = await module.getGenericPassword();
    return {ok: true, token: found && found.password ? found.password : null};
  } catch {
    return {ok: false};
  }
}

/** Кладёт токен в keychain (iOS) или Keystore (Android). `false` — хранилища нет или запись не удалась. */
export async function writeSecureToken(token: string): Promise<boolean> {
  const module = keychain();
  if (!module) {
    return false;
  }
  try {
    // На iOS запись не уходит в iCloud и в резервные копии, перенесённые на другое устройство.
    const saved = await module.setGenericPassword(ACCOUNT, token, {
      accessible: module.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
    return saved !== false;
  } catch {
    return false;
  }
}

export async function clearSecureToken(): Promise<boolean> {
  const module = keychain();
  if (!module) {
    return false;
  }
  try {
    return await module.resetGenericPassword();
  } catch {
    return false;
  }
}
