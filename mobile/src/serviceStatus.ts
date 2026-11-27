/**
 * Разбор текста, который сервер отдаёт на «статус» и «аварийный канал» (вывод команд vampn status и vampn emergency status).
 * Формат свободный, поэтому разбор осторожный: чего не нашлось, то остаётся пустым, а полный текст экран показывает отдельно.
 */

import type {Tone} from './format';

export type ServiceState = 'ok' | 'down' | 'unknown';

export type ServiceStatus = {
  /** Отвечает ли сервер через туннель. */
  state: ServiceState;
  /** Адрес сервера (без порта). */
  ip: string;
  /** Как давно было рукопожатие туннеля. */
  tunnel: string;
  /** Сколько сервер без связи. */
  fails: string;
};

/** Строки вида «ключ: значение» из начала строки (вложенные строки с отступом пропускаются). */
function fields(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split('\n')) {
    const match = /^([^\s:][^:]*?)\s*:\s*(.*)$/.exec(line);
    if (match && !out.has(match[1])) {
      out.set(match[1], match[2].trim());
    }
  }
  return out;
}

/** Значение без пояснения в скобках: «рукопожатие 12 с назад (…)» даёт «рукопожатие 12 с назад». */
function short(value: string | undefined): string {
  return (value ?? '').replace(/\s*\(.*$/, '').trim();
}

export function parseStatus(text: string): ServiceStatus {
  const f = fields(text);
  const state: ServiceState = /сервер отвечает через туннель/.test(text)
    ? 'ok'
    : /ответа через туннель нет/.test(text)
      ? 'down'
      : 'unknown';
  return {
    state,
    ip: (f.get('сервер') ?? '').replace(/:\d+$/, ''),
    tunnel: short(f.get('туннель')),
    fails: short(f.get('без связи')),
  };
}

export type EmergencyState = 'on' | 'off' | 'unknown';

export function parseEmergency(text: string): EmergencyState {
  if (/аварийный режим:\s*ВКЛЮЧ/i.test(text)) {
    return 'on';
  }
  if (/аварийный режим:\s*выключен/i.test(text)) {
    return 'off';
  }
  return 'unknown';
}

/** Кабинет Timeweb: на нём стоит один из двух одинаковых VPN-серверов (основной и запасной). */
export type Cabinet = {
  /** Номер для команд сервера: 1 основной, 2 запасной. */
  server: 1 | 2;
  label: 'основной' | 'запасной';
  /** На него сейчас смотрит туннель. */
  active: boolean;
  /** Статус сервера в Timeweb как он пришёл: on, off, rebooting, unknown и так далее. */
  state: string;
  ips: string[];
  /** Сколько новых IP создано за сутки и сколько можно. */
  used: number;
  limit: number;
  /** Что стоит в конце строки, например «смена IP на паузе до 27.11 03:00 МСК». */
  note: string;
};

// «Timeweb (запасной, активный): статус on, IPv4 203.0.113.7 , новых IP за сутки 2 из 10; смена IP на паузе до 27.11 03:00 МСК»
const CABINET_LINE = /^Timeweb \((основной|запасной)(, активный)?\):\s*статус\s+(\S+?),\s*IPv4\s*(.*?)\s*,\s*новых IP за сутки\s+(\d+)\s+из\s+(\d+)\s*(?:;\s*(.*))?$/;

/** Кабинеты из вывода `vampn status`: по строке на каждый; нет строк (старый формат, мусор) - пустой список. */
export function parseCabinets(text: string): Cabinet[] {
  const out: Cabinet[] = [];
  for (const line of text.split('\n')) {
    const m = CABINET_LINE.exec(line.trim());
    if (!m) {
      continue;
    }
    const label = m[1] as Cabinet['label'];
    out.push({
      server: label === 'основной' ? 1 : 2,
      label,
      active: !!m[2],
      state: m[3],
      ips: m[4].split(/\s+/).filter(Boolean),
      used: Number(m[5]),
      limit: Number(m[6]),
      note: (m[7] ?? '').trim(),
    });
  }
  return out;
}

/** Статус кабинета словами и цветом плашки. */
export function cabinetState(state: string): {text: string; tone: Tone} {
  switch (state) {
    case 'on':
      return {text: 'включён', tone: 'ok'};
    case 'off':
    case 'stopped':
      return {text: 'выключен', tone: 'signal'};
    case 'rebooting':
    case 'starting':
      return {text: 'перезагружается', tone: 'muted'};
    default:
      return {text: state || 'нет данных', tone: 'muted'};
  }
}
