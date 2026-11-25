/**
 * Разбор текста, который сервер отдаёт на «статус» и «аварийный канал» (вывод команд vampn status и vampn emergency status).
 * Формат свободный, поэтому разбор осторожный: чего не нашлось, то остаётся пустым, а полный текст экран показывает отдельно.
 */

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
