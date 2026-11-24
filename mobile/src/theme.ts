import {createContext, useContext} from 'react';
import {Platform} from 'react-native';

export type ThemeMode = 'auto' | 'light' | 'dark';

export type AppTheme = {
  dark: boolean;
  bg: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  muted: string;
  border: string;
  signal: string;
  signalText: string;
  ok: string;
  button: string;
  buttonText: string;
  backdrop: string;
  radius: {m: number; l: number};
  font: {sans: string; mono: string; display: string};
};

// Шрифты проекта support (IBM Plex Sans/Mono, Doto, DotGothic16) подключаются
// файлами в нативные ресурсы. Пока файлов нет, берём системные шрифты с тем же
// характером: моноширинный для подписей и заголовков.
const FONTS_BUNDLED = false;

const fonts = FONTS_BUNDLED
  ? {sans: 'IBMPlexSans-Regular', mono: 'IBMPlexMono-Regular', display: 'Doto-Bold'}
  : Platform.select({
      ios: {sans: 'System', mono: 'Menlo', display: 'Menlo'},
      default: {sans: 'sans-serif', mono: 'monospace', display: 'monospace'},
    })!;

const radius = {m: 12, l: 24};

export const lightTheme: AppTheme = {
  dark: false,
  bg: '#f4f4f2',
  surface: '#ffffff',
  surfaceAlt: '#ecece8',
  text: '#111111',
  muted: '#6b6b68',
  border: '#dcdcd7',
  signal: '#d71921',
  signalText: '#ffffff',
  ok: '#1f8f4e',
  button: '#111111',
  buttonText: '#ffffff',
  backdrop: 'rgba(0, 0, 0, 0.4)',
  radius,
  font: fonts,
};

export const darkTheme: AppTheme = {
  dark: true,
  bg: '#000000',
  surface: '#121212',
  surfaceAlt: '#1c1c1c',
  text: '#f4f4f2',
  muted: '#8d8d8a',
  border: '#2a2a2a',
  signal: '#d71921',
  signalText: '#ffffff',
  ok: '#3ecf7a',
  button: '#f4f4f2',
  buttonText: '#000000',
  backdrop: 'rgba(0, 0, 0, 0.65)',
  radius,
  font: fonts,
};

export function resolveTheme(mode: ThemeMode, systemDark: boolean): AppTheme {
  if (mode === 'light') {
    return lightTheme;
  }
  if (mode === 'dark') {
    return darkTheme;
  }
  return systemDark ? darkTheme : lightTheme;
}

export const ThemeContext = createContext<AppTheme>(lightTheme);

export function useTheme(): AppTheme {
  return useContext(ThemeContext);
}
