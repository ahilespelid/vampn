import {useCallback, useEffect, useState} from 'react';
import {Pressable, View} from 'react-native';

import type {KeyStats, KeyStatsList, StatPoint} from '../api';
import {useAuth} from '../auth';
import {describeError, formatAgo, formatBytes, formatDate} from '../format';
import {KeyStatsDetail, TrafficRows} from '../KeyStatsDetail';
import {hasData, isRemoved, PERIODS, periodTraffic, sortKeys, trackedSince, type Period} from '../keyStats';
import {useTheme} from '../theme';
import {useReconnect} from '../useReconnect';
import {Body, Card, Empty, ErrorNote, KV, Label, Notice, Page, Segmented, Sheet} from '../ui';

const RANGES = [
  {value: '24', label: 'сутки'},
  {value: '72', label: '3 дня'},
  {value: '168', label: 'неделя'},
] as const;

const MAX_BARS = 48;
const CHART_HEIGHT = 160;

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

function KeyRow({k, period, onPress}: {k: KeyStats; period: Period; onPress: () => void}) {
  const t = useTheme();
  const traffic = periodTraffic(k, period);
  const removed = isRemoved(k);
  const when = removed
    ? `удалён ${formatDate(k.removed_at)}`
    : k.online
      ? 'сейчас онлайн'
      : k.last_seen_at
        ? `был ${formatAgo(k.last_seen_at)}`
        : 'ещё не подключался';
  const where = [k.last_client_ip ? `IP ${k.last_client_ip}` : '', k.last_server ?? ''].filter(Boolean).join(' · ');
  return (
    <Pressable onPress={onPress} accessibilityRole="button" testID={`stat-key-${k.name}`}>
      <Card style={{flexDirection: 'row', alignItems: 'center', gap: 14, opacity: removed ? 0.6 : 1}}>
        <View style={{width: 40, height: 40, borderRadius: 20, backgroundColor: t.surfaceAlt, alignItems: 'center', justifyContent: 'center'}}>
          <Body mono weight="700">
            {k.name.slice(0, 1).toUpperCase()}
          </Body>
        </View>
        <View style={{flex: 1, gap: 2}}>
          <Body mono weight="700">
            {k.name}
          </Body>
          <Body mono style={{fontSize: 13, lineHeight: 19}}>
            скачано {formatBytes(traffic.down)} · отдано {formatBytes(traffic.up)}
          </Body>
          <Body muted style={{fontSize: 12, lineHeight: 18}}>
            {when} · подключений {k.connections}
          </Body>
          {where ? (
            <Body muted mono style={{fontSize: 12, lineHeight: 18}}>
              {where}
            </Body>
          ) : null}
        </View>
        <View accessibilityLabel={k.online ? 'онлайн' : 'не в сети'} style={{width: 8, height: 8, borderRadius: 4, backgroundColor: k.online ? t.ok : t.muted}} />
      </Card>
    </Pressable>
  );
}

export function StatsScreen() {
  const t = useTheme();
  const {api, user} = useAuth();
  const admin = user?.role === 'admin';
  const [range, setRange] = useState<'24' | '72' | '168'>('24');
  const [period, setPeriod] = useState<Period>('total');
  const [points, setPoints] = useState<StatPoint[]>([]);
  const [keyData, setKeyData] = useState<KeyStatsList | null>(null);
  const [loadingChart, setLoadingChart] = useState(false);
  const [loadingKeys, setLoadingKeys] = useState(false);
  const [chartError, setChartError] = useState('');
  const [keyError, setKeyError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const loadChart = useCallback(async () => {
    setLoadingChart(true);
    setChartError('');
    try {
      const out = await api.stats('users_online', Number(range));
      setPoints(out.points);
    } catch (err) {
      setChartError(describeError(err));
    } finally {
      setLoadingChart(false);
    }
  }, [api, range]);

  const loadKeys = useCallback(async () => {
    setLoadingKeys(true);
    setKeyError('');
    try {
      setKeyData(await api.keyStats());
    } catch (err) {
      setKeyError(describeError(err));
    } finally {
      setLoadingKeys(false);
    }
  }, [api]);

  useEffect(() => {
    loadChart();
  }, [loadChart]);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  const reload = useCallback(() => {
    loadChart();
    loadKeys();
  }, [loadChart, loadKeys]);

  useReconnect(reload);

  const keys = keyData ? sortKeys(keyData.keys, period) : [];
  const alive = keys.filter(k => !isRemoved(k));
  const removed = keys.filter(isRemoved);
  const totals = keyData?.totals;
  const since = keyData ? trackedSince(keyData.keys) : null;
  const current = keyData?.keys.find(k => k.name === selected) ?? null;

  const bars = downsample(points);
  const peak = bars.length ? Math.max(...bars, 1) : 1;
  const values = points.map(p => p.value);
  const last = points[points.length - 1];

  return (
    <Page
      title="Всё в цифрах."
      subtitle={admin ? 'Каждый ключ: сколько прошло, откуда и куда.' : 'Ваш ключ: сколько прошло, откуда и куда.'}
      refreshing={loadingChart || loadingKeys}
      onRefresh={reload}>
      {keyError ? <ErrorNote text={keyError} /> : null}
      {keyData && totals && !hasData(totals, keyData.keys) ? (
        <Notice kind="info" text="Учёт ключей только начался: мегабайты и подключения копятся с первого запуска сборщика на сервере, раньше ничего не сохранялось." />
      ) : null}

      {totals ? (
        <Card style={{gap: 14}}>
          <Label>{admin ? 'итого по всем ключам' : 'итого'}</Label>
          <TrafficRows
            rows={[
              {label: 'сутки', up: totals.up_24h, down: totals.down_24h},
              {label: '7 дней', up: totals.up_7d, down: totals.down_7d},
              {label: '30 дней', up: totals.up_30d, down: totals.down_30d},
              {label: 'всего', up: totals.up_total, down: totals.down_total},
            ]}
          />
          <View style={{borderTopWidth: 1, borderTopColor: t.border, paddingTop: 12}}>
            <KV k="онлайн сейчас" v={`${totals.online} из ${totals.keys}`} mono />
            <KV k="подключений всего" v={String(totals.connections)} mono />
            <KV k="учёт ведётся с" v={formatDate(since)} mono />
          </View>
        </Card>
      ) : null}

      <Label>{admin ? `ключи · ${alive.length}` : 'ваши ключи'}</Label>
      <Segmented value={period} onChange={setPeriod} options={PERIODS} />
      {alive.map(k => (
        <KeyRow key={k.name} k={k} period={period} onPress={() => setSelected(k.name)} />
      ))}
      {keyData && keys.length === 0 ? <Empty text="Ключей пока нет" /> : null}
      {!keyData && !keyError ? <Empty text={loadingKeys ? 'Загрузка…' : 'Нет данных.'} /> : null}
      {removed.length > 0 ? <Label>удалённые · {removed.length}</Label> : null}
      {removed.map(k => (
        <KeyRow key={k.name} k={k} period={period} onPress={() => setSelected(k.name)} />
      ))}

      <Label>активность сервера</Label>
      <Segmented value={range} onChange={setRange} options={RANGES.map(r => ({value: r.value, label: r.label}))} />
      {chartError ? <ErrorNote text={chartError} /> : null}
      <Card style={{gap: 16}}>
        <Label>подключено одновременно</Label>
        {bars.length === 0 ? (
          <Empty text={loadingChart ? 'Загрузка…' : chartError ? 'Не удалось загрузить данные.' : 'Данных пока нет: сервер ещё не накопил метрики.'} />
        ) : (
          <>
            <View style={{flexDirection: 'row', alignItems: 'flex-end', height: CHART_HEIGHT, gap: 3}}>
              {bars.map((value, index) => (
                <View
                  key={index}
                  style={{
                    flex: 1,
                    height: Math.max(4, (value / peak) * CHART_HEIGHT),
                    backgroundColor: index === bars.length - 1 ? t.signal : t.text,
                    opacity: index === bars.length - 1 ? 1 : 0.85,
                    borderRadius: 1,
                  }}
                />
              ))}
            </View>
            <View style={{flexDirection: 'row', justifyContent: 'space-between'}}>
              <Body mono muted style={{fontSize: 12}}>
                начало периода
              </Body>
              <Body mono muted style={{fontSize: 12}}>
                сейчас
              </Body>
            </View>
            <View style={{borderTopWidth: 1, borderTopColor: t.border, paddingTop: 12}}>
              <KV k="сейчас" v={String(last.value)} mono />
              <KV k="максимум" v={String(Math.max(...values))} mono />
              <KV k="минимум" v={String(Math.min(...values))} mono />
              <KV k="последний замер" v={formatDate(last.ts)} mono />
            </View>
          </>
        )}
      </Card>
      <Body muted>
        Цифры собираются на сервере раз в минуту. «Скачано» - то, что пришло на устройство, «отдано» - то, что с него ушло. Учёт идёт с первого запуска сборщика.
      </Body>

      <Sheet visible={!!current} onClose={() => setSelected(null)} title={current?.name ?? ''}>
        {current ? <KeyStatsDetail key={current.name} summary={current} /> : null}
      </Sheet>
    </Page>
  );
}
