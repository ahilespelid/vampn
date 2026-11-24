import {useCallback, useEffect, useState} from 'react';
import {View} from 'react-native';

import type {StatPoint} from '../api';
import {useAuth} from '../auth';
import {describeError, formatDate} from '../format';
import {useTheme} from '../theme';
import {useReconnect} from '../useReconnect';
import {Body, Card, Empty, ErrorNote, KV, Label, Page, Segmented} from '../ui';

const RANGES = [
  {value: '24', label: 'сутки'},
  {value: '72', label: '3 дня'},
  {value: '168', label: 'неделя'},
] as const;

const MAX_BARS = 48;

/** Сжимает ряд до MAX_BARS столбцов, беря максимум в каждой корзине. */
export function downsample(points: StatPoint[], bars = MAX_BARS): number[] {
  if (points.length <= bars) {
    return points.map(p => p.value);
  }
  const size = points.length / bars;
  const out: number[] = [];
  for (let i = 0; i < bars; i += 1) {
    const slice = points.slice(Math.floor(i * size), Math.floor((i + 1) * size));
    out.push(Math.max(...slice.map(p => p.value)));
  }
  return out;
}

export function StatsScreen() {
  const t = useTheme();
  const {api} = useAuth();
  const [range, setRange] = useState<'24' | '72' | '168'>('24');
  const [points, setPoints] = useState<StatPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const out = await api.stats('users_online', Number(range));
      setPoints(out.points);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, [api, range]);

  useEffect(() => {
    load();
  }, [load]);

  useReconnect(load);

  const bars = downsample(points);
  const peak = bars.length ? Math.max(...bars, 1) : 1;
  const values = points.map(p => p.value);
  const last = points[points.length - 1];

  return (
    <Page title="статистика" refreshing={loading} onRefresh={load}>
      <Segmented value={range} onChange={setRange} options={RANGES.map(r => ({value: r.value, label: r.label}))} />
      {error ? <ErrorNote text={error} /> : null}
      <Card style={{gap: 12}}>
        <Label>подключено одновременно</Label>
        {bars.length === 0 ? (
          <Empty text={loading ? 'Загрузка…' : error ? 'Не удалось загрузить данные.' : 'Данных пока нет: сервер ещё не накопил метрики.'} />
        ) : (
          <>
            <View style={{flexDirection: 'row', alignItems: 'flex-end', height: 120, gap: 2}}>
              {bars.map((value, index) => (
                <View
                  key={index}
                  style={{flex: 1, height: Math.max(3, (value / peak) * 120), backgroundColor: index === bars.length - 1 ? t.signal : t.text, opacity: index === bars.length - 1 ? 1 : 0.8, borderRadius: 1}}
                />
              ))}
            </View>
            <View>
              <KV k="сейчас" v={String(last.value)} mono />
              <KV k="максимум" v={String(Math.max(...values))} mono />
              <KV k="минимум" v={String(Math.min(...values))} mono />
              <KV k="последний замер" v={formatDate(last.ts)} mono />
            </View>
          </>
        )}
      </Card>
      <Body muted>Метрики хранятся в базе на сервере и собираются автоматически.</Body>
    </Page>
  );
}
