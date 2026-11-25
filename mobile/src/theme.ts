import {createContext, useContext} from 'react';
import {Platform, type TextStyle} from 'react-native';

import {getNativeVampnSsh} from '../specs/NativeVampnSsh';

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
  /** Красный для текста и значков на фоне темы: на тёмном светлее, чтобы читался. */
  signalSoft: string;
  signalText: string;
  ok: string;
  button: string;
  buttonText: string;
  backdrop: string;
  radius: {m: number; l: number; card: number; hero: number; button: number};
  font: {sans: string; mono: string; display: string};
  /** Файлы шрифтов support есть в этой сборке (в Expo Go их нет). */
  fontsBundled: boolean;
};

export type FontKind = 'sans' | 'mono' | 'display';
export type FontWeight = '400' | '600' | '700';

// Шрифты проекта support (IBM Plex Sans/Mono, Doto, DotGothic16) лежат файлами в нативных ресурсах:
// Android android/app/src/main/assets/fonts, iOS ios/vampn/Fonts (+ UIAppFonts в Info.plist).
// Имя файла и PostScript-имя шрифта совпадают, поэтому одно и то же имя работает на обеих платформах.
// В Expo Go этих ресурсов нет, там остаются системные шрифты с тем же характером (моноширинный для подписей).
// Признак настоящей сборки: в ней есть собственный нативный модуль приложения.
const FONTS_BUNDLED = getNativeVampnSsh() !== null;

const bundledFamilies: Record<FontKind, Record<FontWeight, string>> = {
  sans: {'400': 'IBMPlexSans-Regular', '600': 'IBMPlexSans-SemiBold', '700': 'IBMPlexSans-Bold'},
  mono: {'400': 'IBMPlexMono-Regular', '600': 'IBMPlexMono-SemiBold', '700': 'IBMPlexMono-Bold'},
  display: {'400': 'Doto-Bold', '600': 'Doto-Bold', '700': 'Doto-Bold'},
};

const fonts = FONTS_BUNDLED
  ? {sans: bundledFamilies.sans['400'], mono: bundledFamilies.mono['400'], display: bundledFamilies.display['400']}
  : Platform.select({
      ios: {sans: 'System', mono: 'Menlo', display: 'Menlo'},
      default: {sans: 'sans-serif', mono: 'monospace', display: 'monospace'},
    })!;

/**
 * Шрифт нужного начертания. С файлами шрифтов вес задаётся именем семейства, а не fontWeight: на Android со своим шрифтом
 * fontWeight ищет файл «<имя>_bold» и при его отсутствии подменяет шрифт системным. Без файлов (Expo Go) работает fontWeight.
 */
export function fontStyle(theme: AppTheme, kind: FontKind, weight: FontWeight = '400'): TextStyle {
  if (theme.fontsBundled) {
    return {fontFamily: bundledFamilies[kind][weight]};
  }
  return weight === '400' ? {fontFamily: theme.font[kind]} : {fontFamily: theme.font[kind], fontWeight: weight};
}

// m: поля ввода и плашки; card: карточки; hero: главная карточка; button: кнопки; l: переключатели и шторки.
const radius = {m: 12, l: 24, card: 22, hero: 24, button: 16};

export const lightTheme: AppTheme = {
  dark: false,
  bg: '#f4f4f2',
  surface: '#ffffff',
  surfaceAlt: '#e8e8e4',
  text: '#111111',
  muted: '#62625f',
  border: '#dcdcd7',
  signal: '#d71921',
  signalSoft: '#d71921',
  signalText: '#ffffff',
  ok: '#1f8f4e',
  button: '#111111',
  buttonText: '#ffffff',
  backdrop: 'rgba(0, 0, 0, 0.4)',
  radius,
  font: fonts,
  fontsBundled: FONTS_BUNDLED,
};

export const darkTheme: AppTheme = {
  dark: true,
  bg: '#0b0c0e',
  surface: '#151618',
  surfaceAlt: '#222326',
  text: '#f4f4f2',
  muted: '#a7a8ae',
  border: '#292a2e',
  signal: '#d71921',
  signalSoft: '#e8545a',
  signalText: '#ffffff',
  ok: '#3ecf7a',
  button: '#f4f4f2',
  buttonText: '#000000',
  backdrop: 'rgba(0, 0, 0, 0.65)',
  radius,
  font: fonts,
  fontsBundled: FONTS_BUNDLED,
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
