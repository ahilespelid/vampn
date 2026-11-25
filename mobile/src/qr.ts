import qrcode from 'qrcode-generator';

/** Матрица QR-кода (true = тёмный модуль). Строится на устройстве, ключ никуда не отправляется. */
export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, 'L'); // версия подбирается по длине, низкая коррекция: .conf ключа около 550 байт
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const rows: boolean[][] = [];
  for (let y = 0; y < n; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < n; x++) {
      row.push(qr.isDark(y, x));
    }
    rows.push(row);
  }
  return rows;
}

/** То же, но вместо исключения (текст не помещается в QR) возвращает null. */
export function tryQrMatrix(text: string): boolean[][] | null {
  try {
    return text ? qrMatrix(text) : null;
  } catch {
    return null;
  }
}

/** Подряд идущие тёмные модули строки: [начало, длина]. Рисуем по полосе на серию, а не по квадрату на модуль. */
export function darkRuns(row: boolean[]): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  let start = -1;
  for (let x = 0; x <= row.length; x++) {
    if (x < row.length && row[x]) {
      if (start < 0) {
        start = x;
      }
    } else if (start >= 0) {
      runs.push([start, x - start]);
      start = -1;
    }
  }
  return runs;
}
