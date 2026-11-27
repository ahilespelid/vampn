import {useEffect, useState} from 'react';
import {View} from 'react-native';

import type {KeyDay, KeyStats, KeyStatsDetail as Detail} from './api';
import {useAuth} from './auth';
import {
  describeError,
  formatAgo,
  formatBytes,
  formatDate,
  formatDay,
  keyReasonLabel,
  removedReasonLabel,
  roleLabel,
} from './format';
import {dailySeries, eventText, isRemoved, serverText} from './keyStats';
import {useTheme} from './theme';
import {Body, Card, ErrorNote, KV, Label, Pill} from './ui';

const DAY_BARS = 30;
const DAY_HEIGHT = 80;
const EVENTS_SHOWN = 30;

/** Таблица «скачано / отдано» по срокам. Скачано - отправлено на устройство, отдано - принято с устройства. */
export function TrafficRows({rows}: {rows: {label: string; up: number; down: number}[]}) {
  return (
    <View style={{gap: 6}}>
      <View style={{flexDirection: 'row'}}>
        <View style={{flex: 1}} />
        <Body muted mono style={{flex: 1, textAlign: 'right', fontSize: 12}}>
          скачано
        </Body>
        <Body muted mono style={{flex: 1, textAlign: 'right', fontSize: 12}}>
          отдано
        </Body>
      </View>
      {rows.map(r => (
        <View key={r.label} style={{flexDirection: 'row', alignItems: 'baseline'}}>
          <Body muted style={{flex: 1}}>
            {r.label}
          </Body>
          <Body mono style={{flex: 1, textAlign: 'right'}}>
            {formatBytes(r.down)}
          </Body>
          <Body mono style={{flex: 1, textAlign: 'right'}}>
            {formatBytes(r.up)}
          </Body>
        </View>
      ))}
    </View>
  );
}

function DayBars({days}: {days: KeyDay[]}) {
  const t = useTheme();
  const series = dailySeries(days, DAY_BARS);
  const peak = Math.max(...series.map(s => s.bytes), 0);
  if (peak === 0) {
    return <Body muted>За 30 дней трафика не было.</Body>;
  }
  const best = series.reduce((a, b) => (b.bytes > a.bytes ? b : a));
  return (
    <View style={{gap: 8}}>
      <View style={{flexDirection: 'row', alignItems: 'flex-end', height: DAY_HEIGHT, gap: 2}}>
        {series.map((s, index) => (
          <View
            key={s.day}
            style={{
              flex: 1,
              height: Math.max(2, (s.bytes / peak) * DAY_HEIGHT),
              backgroundColor: index === series.length - 1 ? t.signal : t.text,
              opacity: s.bytes ? 0.85 : 0.2,
              borderRadius: 1,
            }}
          />
        ))}
      </View>
      <View style={{flexDirection: 'row', justifyContent: 'space-between'}}>
        <Body mono muted style={{fontSize: 12}}>
          {formatDay(series[0].day)}
        </Body>
        <Body mono muted style={{fontSize: 12}}>
          сегодня
        </Body>
      </View>
      <Body muted style={{fontSize: 13}}>
        Больше всего за день: {formatBytes(best.bytes)} ({formatDay(best.day)})
      </Body>
    </View>
  );
}

/**
 * Всё про один ключ: трафик по срокам и по дням, подключения, с каких IP заходил, на какой сервер,
 * когда добавлен и удалён, события. Итоги видны сразу из списка, остальное подгружается.
 */
export function KeyStatsDetail({summary}: {summary: KeyStats}) {
  const {api} = useAuth();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setError('');
    api
      .keyStatsDetail(summary.name)
      .then(out => {
        if (alive) {
          setDetail(out);
        }
      })
      .catch(err => {
        if (alive) {
          setError(describeError(err));
        }
      });
    return () => {
      alive = false;
    };
  }, [api, summary.name]);

  const k: KeyStats = detail ?? summary;
  const removed = isRemoved(k);
  const place = serverText(k.last_server, k.last_server_ip);
  const loading = !detail && !error;

  return (
    <View style={{gap: 14}}>
      <View style={{flexDirection: 'row', gap: 8, flexWrap: 'wrap'}}>
        <Pill text={removed ? 'удалён' : k.online ? 'онлайн' : 'не в сети'} tone={!removed && k.online ? 'ok' : 'muted'} />
        {k.role ? <Pill text={roleLabel(k.role)} tone={k.role === 'admin' ? 'signal' : 'muted'} /> : null}
        {k.last_server ? <Pill text={k.last_server} /> : null}
      </View>
      {error ? <ErrorNote text={error} /> : null}

      <Card style={{gap: 12}}>
        <Label>трафик</Label>
        <TrafficRows
          rows={[
            {label: 'сутки', up: k.up_24h, down: k.down_24h},
            {label: '7 дней', up: k.up_7d, down: k.down_7d},
            {label: '30 дней', up: k.up_30d, down: k.down_30d},
            {label: 'всего', up: k.up_total, down: k.down_total},
          ]}
        />
      </Card>

      <Card style={{gap: 12}}>
        <Label>по дням · 30 дней</Label>
        {detail ? <DayBars days={detail.days} /> : <Body muted>{loading ? 'Загрузка…' : 'Нет данных.'}</Body>}
      </Card>

      <Card>
        <Label style={{marginBottom: 6}}>подключения</Label>
        <KV k="всего подключений" v={String(k.connections)} mono />
        <KV k="последнее" v={k.online ? 'сейчас онлайн' : formatAgo(k.last_seen_at)} mono />
        <KV k="дата последнего" v={formatDate(k.last_seen_at)} mono />
        <KV k="впервые замечен" v={formatDate(k.first_seen_at)} mono />
        <KV k="учёт ведётся с" v={formatDate(k.tracked_since)} mono />
      </Card>

      <Card style={{gap: 6}}>
        <Label>адреса</Label>
        <KV k="IP клиента" v={k.last_client_ip ?? '—'} mono />
        <KV k="сервер" v={place || '—'} mono />
        {detail && detail.client_ips.length > 0 ? (
          <View style={{gap: 6, marginTop: 8}}>
            <Body muted>С каких IP подключался</Body>
            {detail.client_ips.map(row => (
              <View key={row.ip} style={{flexDirection: 'row', justifyContent: 'space-between', gap: 12}}>
                <Body mono>{row.ip}</Body>
                <Body muted mono style={{fontSize: 12, textAlign: 'right', flexShrink: 1}}>
                  {row.connects > 0 ? `${row.connects} подкл. · ` : ''}
                  {formatAgo(row.last_at)}
                </Body>
              </View>
            ))}
          </View>
        ) : null}
      </Card>

      <Card>
        <Label style={{marginBottom: 6}}>ключ</Label>
        <KV k="добавлен" v={formatDate(k.added_at)} mono />
        {removed ? <KV k="удалён" v={formatDate(k.removed_at)} mono /> : null}
        {removed && k.removed_reason ? <KV k="причина" v={removedReasonLabel(k.removed_reason)} /> : null}
        {detail?.issued.map(item => (
          <KV key={`${item.reason}-${item.at}`} k={keyReasonLabel(item.reason)} v={formatDate(item.at)} mono />
        ))}
      </Card>

      <Card style={{gap: 10}}>
        <Label>события</Label>
        {detail && detail.events.length === 0 ? <Body muted>Событий пока нет.</Body> : null}
        {!detail ? <Body muted>{loading ? 'Загрузка…' : 'Нет данных.'}</Body> : null}
        {detail?.events.slice(0, EVENTS_SHOWN).map((e, index) => {
          const text = eventText(e);
          return (
            <View key={`${e.at}-${e.kind}-${index}`} style={{gap: 2}}>
              <Body mono weight="700">
                {text.title}
                {e.key === null ? ' · для всех' : ''}
              </Body>
              {text.sub ? <Body muted mono style={{fontSize: 12}}>{text.sub}</Body> : null}
              <Body muted mono style={{fontSize: 12}}>
                {formatDate(e.at)}
              </Body>
            </View>
          );
        })}
      </Card>
    </View>
  );
}
