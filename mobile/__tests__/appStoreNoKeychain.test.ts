import AsyncStorage from '@react-native-async-storage/async-storage';

import {defaultAppState, loadAppState, saveAppState, type AppState} from '../src/appStore';

// Без нативной части (Expo Go) сам импорт пакета бросает ошибку: токен остаётся там, где был раньше.
jest.mock('react-native-keychain', () => {
  throw new Error('TurboModule RNKeychainManager не найден');
});

const user = {email: 'me@example.com', role: 'user', accounts: []} as unknown as NonNullable<AppState['user']>;
const session: AppState = {...defaultAppState, token: 'tok-secret', expiresAt: '2099-01-01T00:00:00Z', user};

beforeEach(async () => {
  await AsyncStorage.clear();
});

test('без keychain токен хранится в AsyncStorage, как раньше, и переживает перезапуск', async () => {
  await saveAppState(session);

  const raw = JSON.parse((await AsyncStorage.getItem('@vampn/app')) as string);
  expect(raw.token).toBe('tok-secret');

  const loaded = await loadAppState();
  expect(loaded.token).toBe('tok-secret');
  expect(loaded.user).toEqual(user);
});

test('без keychain выход убирает токен из AsyncStorage', async () => {
  await saveAppState(session);
  await saveAppState({...session, token: null, expiresAt: null, user: null});

  const raw = JSON.parse((await AsyncStorage.getItem('@vampn/app')) as string);
  expect(raw.token).toBeNull();
  expect((await loadAppState()).token).toBeNull();
});
