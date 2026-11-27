import type {KeyDay, KeyEvent, KeyStats, KeyStatsTotals} from './api';

/** За какой срок показывать байты: сутки, 7 дней, 30 дней или всё время учёта. */
export type Period = '24h' | '7d' | '30d' | 'total';

export const PERIODS: {value: Period; label: string}[] = [
  {value: '24h', label: 'сутки'},
  {value: '7d', label: 'неделя'},
  {value: '30d', label: 'месяц'},
  {value: 'total', label: 'всего'},
];

type Traffic = {up: number; down: number};
type Counters = Pick<KeyStats, 'up_total' | 'down_total' | 'up_24h' | 'down_24h' | 'up_7d' | 'down_7d' | 'up_30d' | 'down_30d'>;

/** Отдано (up) и скачано (down) ключом за срок. */
export function periodTraffic(source: Counters, period: Period): Traffic {
  switch (period) {
    case '24h':
      return {up: source.up_24h, down: source.down_24h};
    case '7d':
      return {up: source.up_7d, down: source.down_7d};
    case '30d':
      return {up: source.up_30d, down: source.down_30d};
    default:
      return {up: source.up_total, down: source.down_total};
  }
}

/** Ключи по убыванию трафика за срок, при равенстве по имени. Новый массив, исходный не меняется. */
export function sortKeys(keys: KeyStats[], period: Period): KeyStats[] {
  const volume = (k: KeyStats) => {
    const t = periodTraffic(k, period);
    return t.up + t.down;
  };
  return [...keys].sort((a, b) => volume(b) - volume(a) || a.name.localeCompare(b.name));
}

/** Удалён ли ключ (пользователь отозван). Ключ без пользователя в базе считается живым. */
export function isRemoved(k: Pick<KeyStats, 'active'>): boolean {
  return k.active === false;
}

/** Самое раннее начало учёта среди ключей (ISO) или null, если данных нет. */
export function trackedSince(keys: KeyStats[]): string | null {
  const times = keys.map(k => k.tracked_since).filter((v): v is string => !!v);
  return times.length ? times.reduce((a, b) => (a < b ? a : b)) : null;
}

/** Идёт ли уже хоть какой-то учёт: есть трафик, подключения или замеченный ключ. */
export function hasData(totals: KeyStatsTotals, keys: KeyStats[]): boolean {
  return totals.up_total + totals.down_total + totals.connections > 0 || keys.some(k => !!k.last_seen_at);
}

/** «основной · 198.51.100.7», «аварийный», либо пустая строка. */
export function serverText(label: string | null | undefined, ip: string | null | undefined): string {
  return [label, ip].filter(Boolean).join(' · ');
}

/** Ряд из `count` последних суток (UTC, как на сервере) с суммой байт за день; дни без трафика - нули. */
export function dailySeries(days: KeyDay[], count: number, now: number = Date.now()): {day: string; bytes: number}[] {
  const byDay = new Map(days.map(d => [d.day, d.up + d.down]));
  const out: {day: string; bytes: number}[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const day = new Date(now - i * 86400000).toISOString().slice(0, 10);
    out.push({day, bytes: byDay.get(day) ?? 0});
  }
  return out;
}

/** Событие ключа для списка: заголовок и подробность. */
export function eventText(e: KeyEvent): {title: string; sub: string} {
  const arrow = `${e.old ?? '—'} → ${e.new ?? '—'}`;
  switch (e.kind) {
    case 'connect': {
      const place = serverText(e.server, e.server_ip);
      return {title: 'подключение', sub: [e.new ? `с ${e.new}` : 'IP клиента неизвестен', place ? `сервер ${place}` : ''].filter(Boolean).join(' · ')};
    }
    case 'client_ip':
      return {title: 'сменился IP клиента', sub: arrow};
    case 'server_ip':
      return {title: 'сменился IP сервера', sub: arrow};
    case 'server_switch':
      return {title: 'переключили сервер', sub: arrow};
    default:
      return {title: e.kind, sub: ''};
  }
}
