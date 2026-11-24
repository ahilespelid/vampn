import AsyncStorage from '@react-native-async-storage/async-storage';

import {DEFAULT_API_URL, type SessionUser} from './api';
import {clearSecureToken, readSecureToken, secureStorageAvailable, writeSecureToken} from './secureToken';
import type {ThemeMode} from './theme';

export type AppState = {
  apiUrl: string;
  themeMode: ThemeMode;
  token: string | null;
  expiresAt: string | null;
  user: SessionUser | null;
};

export const defaultAppState: AppState = {
  apiUrl: DEFAULT_API_URL,
  themeMode: 'auto',
  token: null,
  expiresAt: null,
  user: null,
};

const STORAGE_KEY = '@vampn/app';
const memory = new Map<string, string>();

// Сохранения идут строго по очереди: иначе медленная запись токена старого состояния могла бы
// завершиться после сброса при выходе, и токен остался бы в keychain.
let queue: Promise<void> = Promise.resolve();

type RawState = {
  raw: string | null;
  /** `false` — AsyncStorage не ответил, состояние взято из памяти процесса. */
  reliable: boolean;
};

async function readRaw(): Promise<RawState> {
  try {
    return {raw: await AsyncStorage.getItem(STORAGE_KEY), reliable: true};
  } catch {
    return {raw: memory.get(STORAGE_KEY) ?? null, reliable: false};
  }
}

async function writeRaw(raw: string): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, raw);
  } catch {
    // Без нативного хранилища (например, Expo Go) состояние живёт до закрытия приложения.
  }
}

function parseState(raw: string | null): AppState {
  if (!raw) {
    return {...defaultAppState};
  }
  try {
    const state: AppState = {...defaultAppState, ...(JSON.parse(raw) as Partial<AppState>)};
    if (state.themeMode !== 'light' && state.themeMode !== 'dark') {
      state.themeMode = 'auto';
    }
    if (!state.apiUrl) {
      state.apiUrl = DEFAULT_API_URL;
    }
    if (typeof state.token !== 'string' || !state.token) {
      state.token = null;
    }
    return state;
  } catch {
    return {...defaultAppState};
  }
}

export async function loadAppState(): Promise<AppState> {
  await queue;
  const {raw, reliable} = await readRaw();
  const stored = parseState(raw);
  const secure = await readSecureToken();

  // Токен берётся из защищённого хранилища. Токен в самом состоянии остался от прежних версий
  // (или от записи, которую хранилище не приняло): его переносим в keychain.
  let token = stored.token;
  let inKeychain = false;
  if (secure.ok) {
    if (secure.token !== null) {
      if (raw === null && reliable) {
        // Состояния приложения нет, а токен есть: на iOS keychain переживает удаление приложения.
        await clearSecureToken();
        token = null;
      } else {
        token = secure.token;
        inKeychain = true;
      }
    } else if (stored.token !== null) {
      inKeychain = await writeSecureToken(stored.token);
    }
  }
  if (inKeychain && stored.token !== null) {
    await writeRaw(JSON.stringify({...stored, token: null}));
  }

  const state: AppState = {...stored, token};
  if (!state.token || !state.user) {
    if (state.token && inKeychain && reliable) {
      // Токен без пользователя бесполезен (запись оборвалась на полпути): не оставляем его в keychain.
      await clearSecureToken();
    }
    state.token = null;
    state.user = null;
    state.expiresAt = null;
  }
  return state;
}

async function persist(state: AppState): Promise<void> {
  memory.set(STORAGE_KEY, JSON.stringify(state));
  let onDisk = state;
  if (secureStorageAvailable()) {
    if (state.token === null) {
      await clearSecureToken();
    } else if (await writeSecureToken(state.token)) {
      onDisk = {...state, token: null};
    }
    // Если keychain запись не принял, токен остаётся в AsyncStorage, как раньше: вход не теряется.
  }
  await writeRaw(JSON.stringify(onDisk));
}

export function saveAppState(state: AppState): Promise<void> {
  const run = queue.then(() => persist(state));
  queue = run.catch(() => undefined);
  return run;
}
