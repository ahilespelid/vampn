import AsyncStorage from '@react-native-async-storage/async-storage';

import {defaultAppState, loadAppState, saveAppState, type AppState} from '../src/appStore';

const keychain = jest.requireMock('react-native-keychain');

const user = {email: 'me@example.com', role: 'user', accounts: []} as unknown as NonNullable<AppState['user']>;
const session: AppState = {
  ...defaultAppState,
  themeMode: 'dark',
  token: 'tok-secret',
  expiresAt: '2099-01-01T00:00:00Z',
  user,
};
const loggedOut: AppState = {...session, token: null, expiresAt: null, user: null};

/** То, что лежит в AsyncStorage, как объект. */
async function onDisk(): Promise<Record<string, unknown> | null> {
  const raw = await AsyncStorage.getItem('@vampn/app');
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
}

/** То, что лежит в keychain (пароль записи). */
async function inKeychain(): Promise<string | null> {
  const found = await keychain.getGenericPassword();
  return found ? found.password : null;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  keychain.__reset();
  jest.clearAllMocks();
});

describe('токен сессии в защищённом хранилище', () => {
  test('токен уходит в keychain, а в AsyncStorage остаётся состояние без него', async () => {
    await saveAppState(session);

    expect(await inKeychain()).toBe('tok-secret');
    const stored = await onDisk();
    expect(stored).toMatchObject({themeMode: 'dark', token: null, expiresAt: '2099-01-01T00:00:00Z'});
    expect(JSON.stringify(stored)).not.toContain('tok-secret');
    expect(keychain.setGenericPassword.mock.calls[0][2]).toEqual({
      accessible: 'AccessibleAfterFirstUnlockThisDeviceOnly',
    });
  });

  test('после перезапуска токен возвращается из keychain', async () => {
    await saveAppState(session);

    const loaded = await loadAppState();

    expect(loaded.token).toBe('tok-secret');
    expect(loaded.user).toEqual(user);
    expect(loaded.themeMode).toBe('dark');
  });

  test('выход стирает токен из keychain', async () => {
    await saveAppState(session);
    await saveAppState(loggedOut);

    expect(await inKeychain()).toBeNull();
    expect((await loadAppState()).token).toBeNull();
  });

  test('сохранения идут по очереди: медленная запись не переживает выход', async () => {
    const realSet = keychain.setGenericPassword.getMockImplementation();
    let finishSet: () => void = () => undefined;
    keychain.setGenericPassword.mockImplementationOnce(
      (username: string, password: string) =>
        new Promise(resolve => {
          finishSet = () => resolve(realSet(username, password));
        }),
    );

    const login = saveAppState(session);
    const logout = saveAppState(loggedOut);
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    // выход ждёт, пока завершится запись токена
    expect(keychain.resetGenericPassword).not.toHaveBeenCalled();

    finishSet();
    await Promise.all([login, logout]);

    expect(keychain.resetGenericPassword).toHaveBeenCalledTimes(1);
    expect(await inKeychain()).toBeNull();
    expect((await onDisk())?.token).toBeNull();
  });

  test('токен из прежней версии переезжает из AsyncStorage в keychain', async () => {
    await AsyncStorage.setItem('@vampn/app', JSON.stringify(session));

    const loaded = await loadAppState();

    expect(loaded.token).toBe('tok-secret');
    expect(await inKeychain()).toBe('tok-secret');
    expect(JSON.stringify(await onDisk())).not.toContain('tok-secret');
    expect((await onDisk())?.user).toEqual(user);
  });

  test('если keychain токен не принял, он остаётся в AsyncStorage и вход не теряется', async () => {
    keychain.setGenericPassword.mockResolvedValueOnce(false);
    await saveAppState(session);

    expect(await inKeychain()).toBeNull();
    expect((await onDisk())?.token).toBe('tok-secret');
    expect((await loadAppState()).token).toBe('tok-secret');
  });

  test('при ошибке записи в keychain токен тоже остаётся в AsyncStorage', async () => {
    keychain.setGenericPassword.mockRejectedValueOnce(new Error('keystore'));
    await saveAppState(session);

    expect((await onDisk())?.token).toBe('tok-secret');
  });

  test('если keychain не читается, работает прежний токен из AsyncStorage', async () => {
    await AsyncStorage.setItem('@vampn/app', JSON.stringify(session));
    keychain.getGenericPassword.mockRejectedValueOnce(new Error('keystore'));

    const loaded = await loadAppState();

    expect(loaded.token).toBe('tok-secret');
    expect(loaded.user).toEqual(user);
  });

  test('после переустановки (состояния нет, а токен в keychain есть) старый токен стирается', async () => {
    await keychain.setGenericPassword('session', 'tok-left-over');

    const loaded = await loadAppState();

    expect(loaded).toEqual(defaultAppState);
    expect(await inKeychain()).toBeNull();
  });

  test('токен без пользователя не принимается и стирается', async () => {
    await saveAppState(session);
    await AsyncStorage.setItem('@vampn/app', JSON.stringify({...session, token: null, user: null}));

    const loaded = await loadAppState();

    expect(loaded.token).toBeNull();
    expect(loaded.user).toBeNull();
    expect(await inKeychain()).toBeNull();
  });

  test('смена темы без токена не оставляет в keychain ничего лишнего', async () => {
    await saveAppState({...defaultAppState, themeMode: 'light'});

    expect(await inKeychain()).toBeNull();
    expect((await loadAppState()).themeMode).toBe('light');
  });
});
