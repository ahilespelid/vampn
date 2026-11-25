import {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {Platform} from 'react-native';

import {ApiClient, normalizeBaseUrl, type LinkState, type SessionUser} from './api';
import {defaultAppState, loadAppState, saveAppState, type AppState} from './appStore';
import {clearLog, pushTrace} from './serverLog';
import type {ThemeMode} from './theme';

type AuthValue = {
  ready: boolean;
  apiUrl: string;
  themeMode: ThemeMode;
  user: SessionUser | null;
  api: ApiClient;
  /** Связь с сервером по итогам последнего запроса. */
  link: LinkState;
  /** Сколько раз связь возвращалась после обрыва: экраны по этому счётчику загружают данные заново. */
  reconnects: number;
  /** Проверяет связь запросом к серверу; результат попадает в `link`. */
  checkLink: () => Promise<void>;
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
  const [link, setLink] = useState<LinkState>('ok');
  const [reconnects, setReconnects] = useState(0);
  const linkRef = useRef<LinkState>('ok');
  const stateRef = useRef<AppState>(defaultAppState);

  // Итог каждого запроса к серверу. Возврат связи после обрыва считается, чтобы экраны перезагрузились сами.
  const handleLink = useCallback((next: LinkState) => {
    if (linkRef.current !== 'ok' && next === 'ok') {
      setReconnects(count => count + 1);
    }
    linkRef.current = next;
    setLink(next);
  }, []);

  // Сброс без отсчёта возврата: при выходе и смене сервера прежнее состояние связи не нужно.
  const resetLink = useCallback(() => {
    linkRef.current = 'ok';
    setLink('ok');
    clearLog(); // журнал обмена относится к прежнему входу и серверу
  }, []);

  // Журнал живёт, пока открыто приложение; при размонтировании чистится, чтобы не тянуть записи в новый сеанс.
  useEffect(() => clearLog, []);

  const commit = useCallback((next: AppState) => {
    stateRef.current = next;
    setState(next);
    saveAppState(next).catch(() => undefined);
  }, []);

  const clearSession = useCallback(() => {
    resetLink();
    commit({...stateRef.current, token: null, expiresAt: null, user: null});
  }, [commit, resetLink]);

  const api = useMemo(
    () =>
      new ApiClient({
        baseUrl: state.apiUrl,
        getToken: () => stateRef.current.token,
        onUnauthorized: clearSession,
        onLink: handleLink,
        onTrace: pushTrace,
      }),
    [state.apiUrl, clearSession, handleLink],
  );

  const checkLink = useCallback(async () => {
    try {
      await api.health();
    } catch {
      // состояние связи обновит сам клиент
    }
  }, [api]);

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
        onLink: handleLink,
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
  }, [clearSession, commit, handleLink]);

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
        resetLink();
        commit({...stateRef.current, apiUrl: normalized, token: null, expiresAt: null, user: null});
      }
      return normalized;
    },
    [api, commit, resetLink],
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
      link,
      reconnects,
      checkLink,
      requestCode,
      verifyCode,
      signOut,
      setApiUrl,
      setThemeMode,
    }),
    [
      ready,
      state.apiUrl,
      state.themeMode,
      state.user,
      api,
      link,
      reconnects,
      checkLink,
      requestCode,
      verifyCode,
      signOut,
      setApiUrl,
      setThemeMode,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
