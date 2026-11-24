import {darkTheme, fontStyle, lightTheme, type FontKind, type FontWeight} from '../src/theme';

// В проекте нет типов Node, поэтому fs и path берём через jest и описываем только то, что нужно.
type Fs = {readFileSync(file: string, encoding?: string): any; existsSync(file: string): boolean};
type Path = {join(...parts: string[]): string};
declare const __dirname: string;
const fs = jest.requireActual<Fs>('fs');
const path = jest.requireActual<Path>('path');

const bundled = {...lightTheme, fontsBundled: true};
const system = {...lightTheme, fontsBundled: false, font: {sans: 'sans-serif', mono: 'monospace', display: 'monospace'}};
const kinds: FontKind[] = ['sans', 'mono', 'display'];
const weights: FontWeight[] = ['400', '600', '700'];

describe('fontStyle', () => {
  test('без файлов шрифтов (Expo Go, тесты) остаются системные шрифты', () => {
    expect(lightTheme.fontsBundled).toBe(false);
    expect(darkTheme.fontsBundled).toBe(false);
  });

  test('со шрифтами вес задаётся семейством, fontWeight не ставится', () => {
    expect(fontStyle(bundled, 'sans')).toEqual({fontFamily: 'IBMPlexSans-Regular'});
    expect(fontStyle(bundled, 'sans', '600')).toEqual({fontFamily: 'IBMPlexSans-SemiBold'});
    expect(fontStyle(bundled, 'mono', '700')).toEqual({fontFamily: 'IBMPlexMono-Bold'});
    for (const weight of weights) {
      expect(fontStyle(bundled, 'display', weight)).toEqual({fontFamily: 'Doto-Bold'});
    }
  });

  test('без файлов жирность остаётся обычным fontWeight', () => {
    expect(fontStyle(system, 'mono')).toEqual({fontFamily: 'monospace'});
    expect(fontStyle(system, 'mono', '600')).toEqual({fontFamily: 'monospace', fontWeight: '600'});
    expect(fontStyle(system, 'sans', '700')).toEqual({fontFamily: 'sans-serif', fontWeight: '700'});
  });
});

/** Достаёт PostScript-имя (nameID 6) из таблицы name файла TTF. */
function postScriptName(file: string): string | null {
  const bytes: Uint8Array = fs.readFileSync(file);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);

  let nameOffset = -1;
  for (let i = 0; i < view.getUint16(4); i += 1) {
    const record = 12 + i * 16;
    if (tag(record) === 'name') {
      nameOffset = view.getUint32(record + 8);
    }
  }
  if (nameOffset < 0) {
    return null;
  }
  const count = view.getUint16(nameOffset + 2);
  const storage = nameOffset + view.getUint16(nameOffset + 4);
  for (let i = 0; i < count; i += 1) {
    const record = nameOffset + 6 + i * 12;
    if (view.getUint16(record + 6) !== 6) {
      continue;
    }
    const platform = view.getUint16(record);
    const length = view.getUint16(record + 8);
    const start = storage + view.getUint16(record + 10);
    let text = '';
    if (platform === 3 || platform === 0) {
      for (let k = 0; k < length; k += 2) {
        text += String.fromCharCode(view.getUint16(start + k));
      }
    } else {
      for (let k = 0; k < length; k += 1) {
        text += String.fromCharCode(bytes[start + k]);
      }
    }
    return text;
  }
  return null;
}

describe('шрифты в нативных ресурсах', () => {
  const root = path.join(__dirname, '..');
  const androidDir = path.join(root, 'android', 'app', 'src', 'main', 'assets', 'fonts');
  const iosDir = path.join(root, 'ios', 'vampn', 'Fonts');
  const plist: string = fs.readFileSync(path.join(root, 'ios', 'vampn', 'Info.plist'), 'utf8');
  const project: string = fs.readFileSync(path.join(root, 'ios', 'vampn.xcodeproj', 'project.pbxproj'), 'utf8');
  const families = new Set<string>();
  for (const kind of kinds) {
    for (const weight of weights) {
      families.add(fontStyle(bundled, kind, weight).fontFamily as string);
    }
  }

  test.each([...families])('%s: файл на Android и iOS, имя файла равно PostScript-имени', family => {
    for (const dir of [androidDir, iosDir]) {
      const file = path.join(dir, `${family}.ttf`);
      expect(fs.existsSync(file)).toBe(true);
      expect(postScriptName(file)).toBe(family);
    }
  });

  test.each([...families])('%s: iOS знает файл (UIAppFonts и ресурсы проекта)', family => {
    expect(plist).toContain(`<string>${family}.ttf</string>`);
    expect(project).toContain(`${family}.ttf in Resources */`);
    expect(project).toContain(`path = "vampn/Fonts/${family}.ttf"`);
  });

  test('в Info.plist нет шрифтов без файла', () => {
    const listed = [...plist.matchAll(/<string>([^<]+\.ttf)<\/string>/g)].map(match => match[1]);
    expect(listed.length).toBeGreaterThan(0);
    for (const name of listed) {
      expect(fs.existsSync(path.join(iosDir, name))).toBe(true);
    }
  });
});
