import jsQR from 'jsqr';

import {darkRuns, qrMatrix, tryQrMatrix} from '../src/qr';

const CONF = [
  '[Interface]',
  'PrivateKey = ' + 'A'.repeat(43) + '=',
  'Address = 10.77.0.12/32',
  'DNS = 1.1.1.1, 9.9.9.9',
  'Jc = 4',
  'S1 = 15',
  'H1 = 1020325451',
  '',
  '[Peer]',
  'PublicKey = ' + 'B'.repeat(43) + '=',
  'PresharedKey = ' + 'C'.repeat(43) + '=',
  'AllowedIPs = 0.0.0.0/0, ::/0',
  'Endpoint = 129.101.120.50:49029',
  'PersistentKeepalive = 25',
].join('\n');

/** Рисуем матрицу в картинку (с полями) и читаем настоящим декодером QR: так проверяется, что код считывается. */
function decode(rows: boolean[][], scale = 4): string | null {
  const quiet = 4;
  const side = (rows.length + quiet * 2) * scale;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  rows.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (!dark) {
        return;
      }
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const i = (((y + quiet) * scale + dy) * side + (x + quiet) * scale + dx) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }
      }
    }),
  );
  return jsQR(data, side, side)?.data ?? null;
}

describe('qrMatrix', () => {
  test('квадрат допустимого размера с метками в трёх углах', () => {
    const m = qrMatrix('hello');
    const n = m.length;
    expect(n).toBe(21);
    expect(m.every(row => row.length === n)).toBe(true);
    for (const [r0, c0] of [
      [0, 0],
      [0, n - 7],
      [n - 7, 0],
    ]) {
      expect(m[r0].slice(c0, c0 + 7).every(Boolean)).toBe(true); // верхняя сторона метки
      expect(m[r0 + 3][c0 + 3]).toBe(true); // центр
      expect(m[r0 + 1][c0 + 1]).toBe(false); // светлое кольцо
    }
  });

  test('.conf ключа считывается обратно без потерь', () => {
    const m = qrMatrix(CONF);
    expect((m.length - 17) % 4).toBe(0);
    expect(decode(m)).toBe(CONF);
  });

  test('ссылка vpn:// и короткий текст тоже считываются', () => {
    expect(decode(qrMatrix('vpn://AAAB' + 'x'.repeat(300)))).toBe('vpn://AAAB' + 'x'.repeat(300));
    expect(decode(qrMatrix('abc'))).toBe('abc');
  });

  test('слишком длинный текст: tryQrMatrix возвращает null, qrMatrix бросает', () => {
    const huge = 'x'.repeat(5000);
    expect(() => qrMatrix(huge)).toThrow();
    expect(tryQrMatrix(huge)).toBeNull();
    expect(tryQrMatrix('')).toBeNull();
  });
});

describe('darkRuns', () => {
  test('серии тёмных модулей', () => {
    expect(darkRuns([true, true, false, true, false, false, true])).toEqual([
      [0, 2],
      [3, 1],
      [6, 1],
    ]);
    expect(darkRuns([false, false])).toEqual([]);
    expect(darkRuns([true, true, true])).toEqual([[0, 3]]);
    expect(darkRuns([])).toEqual([]);
  });
});
