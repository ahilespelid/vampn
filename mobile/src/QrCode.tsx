import {View} from 'react-native';

import {darkRuns} from './qr';

/** QR-код из готовой матрицы. Фон всегда белый с полями в 4 модуля, иначе в тёмной теме его не считают. */
export function QrCode({rows, size = 260}: {rows: boolean[][]; size?: number}) {
  const quiet = 4;
  const cell = Math.max(1, Math.floor(size / (rows.length + quiet * 2)));
  const side = cell * (rows.length + quiet * 2);
  return (
    <View
      testID="key-qr"
      accessible
      accessibilityLabel="QR-код ключа"
      style={{alignSelf: 'center', width: side, height: side, backgroundColor: '#ffffff', padding: cell * quiet}}>
      {rows.map((row, y) => {
        let at = 0;
        return (
          <View key={y} style={{flexDirection: 'row', height: cell}}>
            {darkRuns(row).map(([start, len]) => {
              const gap = start - at;
              at = start + len;
              return (
                <View key={start} style={{flexDirection: 'row'}}>
                  {gap > 0 ? <View style={{width: gap * cell, height: cell}} /> : null}
                  <View style={{width: len * cell, height: cell, backgroundColor: '#000000'}} />
                </View>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}
