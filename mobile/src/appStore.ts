import AsyncStorage from '@react-native-async-storage/async-storage';

import {DEFAULT_API_URL, type SessionUser} from './api';
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

export async function loadAppState(): Promise<AppState> {
  let raw: string | null = null;
  try {
    raw = await AsyncStorage.getItem(STORAGE_KEY);
  } catch {
    raw = memory.get(STORAGE_KEY) ?? null;
  }
  if (!raw) {
    return {...defaultAppState};
  }
  try {
    const parsed = JSON.parse(raw) as Partial<AppState>;
    const state: AppState = {...defaultAppState, ...parsed};
    if (state.themeMode !== 'light' && state.themeMode !== 'dark') {
      state.themeMode = 'auto';
    }
    if (!state.apiUrl) {
      state.apiUrl = DEFAULT_API_URL;
    }
    if (!state.token || !state.user) {
      state.token = null;
      state.user = null;
      state.expiresAt = null;
    }
    return state;
  } catch {
    return {...defaultAppState};
  }
}

export async function saveAppState(state: AppState): Promise<void> {
  const raw = JSON.stringify(state);
  memory.set(STORAGE_KEY, raw);
  try {
    await AsyncStorage.setItem(STORAGE_KEY, raw);
  } catch {
    // Без нативного хранилища (например, Expo Go) состояние живёт до закрытия приложения.
  }
}
