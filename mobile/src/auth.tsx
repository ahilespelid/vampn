import {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {Platform} from 'react-native';

import {ApiClient, normalizeBaseUrl, type SessionUser} from './api';
import {defaultAppState, loadAppState, saveAppState, type AppState} from './appStore';
import type {ThemeMode} from './theme';

type AuthValue = {
  ready: boolean;
  apiUrl: string;
  themeMode: ThemeMode;
  user: SessionUser | null;
  api: ApiClient;
  requestCode: (email: string) => Promise<void>;
  verifyCode: (email: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
  setApiUrl: (raw: string) => Promise<string>;
  setThemeMode: (mode: ThemeMode) => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth вне AuthProvider');
  }
  return value;
}

function deviceInfo() {
  return {platform: (Platform.OS === 'ios' ? 'ios' : 'android') as 'ios' | 'android', name: `${Platform.OS} ${Platform.Version}`};
}

export function AuthProvider({children}: {children: ReactNode}) {
  const [state, setState] = useState<AppState>(defaultAppState);
  const [ready, setReady] = useState(false);
  const stateRef = useRef<AppState>(defaultAppState);

  const commit = useCallback((next: AppState) => {
    stateRef.current = next;
    setState(next);
    saveAppState(next).catch(() => undefined);
  }, []);

  const clearSession = useCallback(() => {
    commit({...stateRef.current, token: null, expiresAt: null, user: null});
  }, [commit]);

  const api = useMemo(
    () =>
      new ApiClient({
        baseUrl: state.apiUrl,
        getToken: () => stateRef.current.token,
        onUnauthorized: clearSession,
      }),
    [state.apiUrl, clearSession],
  );

  useEffect(() => {
    let active = true;
    loadAppState().then(async loaded => {
      if (!active) {
        return;
      }
      stateRef.current = loaded;
      setState(loaded);
      setReady(true);
      if (!loaded.token) {
        return;
      }
      const expired = loaded.expiresAt ? new Date(loaded.expiresAt).getTime() < Date.now() : false;
      if (expired) {
        clearSession();
        return;
      }
      // Сессия проверяется в фоне: без связи вход остаётся, при отказе сервера (401) он сбрасывается.
      const client = new ApiClient({
        baseUrl: loaded.apiUrl,
        getToken: () => stateRef.current.token,
        onUnauthorized: clearSession,
      });
      try {
        const me = await client.me();
        if (active && stateRef.current.token) {
          commit({...stateRef.current, user: me});
        }
      } catch {
        // нет связи: остаёмся с сохранённой сессией
      }
    });
    return () => {
      active = false;
    };
  }, [clearSession, commit]);

  const requestCode = useCallback(
    async (email: string) => {
      await api.requestCode(email.trim());
    },
    [api],
  );

  const verifyCode = useCallback(
    async (email: string, code: string) => {
      const result = await api.verify(email.trim(), code, deviceInfo());
      commit({...stateRef.current, token: result.token, expiresAt: result.expires_at, user: result.user});
    },
    [api, commit],
  );

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // без связи или при уже закрытой сессии просто выходим локально
    }
    clearSession();
  }, [api, clearSession]);

  const setApiUrl = useCallback(
    async (raw: string) => {
      const normalized = normalizeBaseUrl(raw);
      if (!normalized) {
        throw new Error('Неверный адрес сервера');
      }
      if (normalized !== stateRef.current.apiUrl) {
        if (stateRef.current.token) {
          try {
            await api.logout();
          } catch {
            // старый сервер может быть недоступен
          }
        }
        commit({...stateRef.current, apiUrl: normalized, token: null, expiresAt: null, user: null});
      }
      return normalized;
    },
    [api, commit],
  );

  const setThemeMode = useCallback(
    async (mode: ThemeMode) => {
      commit({...stateRef.current, themeMode: mode});
    },
    [commit],
  );

  const value = useMemo<AuthValue>(
    () => ({
      ready,
      apiUrl: state.apiUrl,
      themeMode: state.themeMode,
      user: state.user,
      api,
      requestCode,
      verifyCode,
      signOut,
      setApiUrl,
      setThemeMode,
    }),
    [ready, state.apiUrl, state.themeMode, state.user, api, requestCode, verifyCode, signOut, setApiUrl, setThemeMode],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
