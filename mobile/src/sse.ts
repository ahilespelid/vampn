/**
 * Клиент Server-Sent Events на XMLHttpRequest.
 * EventSource не подходит: он не умеет слать заголовок Authorization, а токен в адрес класть нельзя (попадёт в журналы).
 * В React Native XHR отдаёт ответ по частям: пока есть обработчик onprogress, responseText растёт по мере прихода данных.
 */

export type SseFrame = {event: string; data: string};

/** Как закончился поток. status: 200 — сервер закрыл сам, 0 — сети нет, иначе код ответа. */
export type StreamEnd = {status: number; reason: 'ended' | 'http' | 'network' | 'idle'};

export type StreamHandle = {close: () => void};

/** Раз в 15 секунд сервер шлёт «пинг»; если нет ни байта дольше 45 секунд, соединение считается мёртвым. */
export const STREAM_IDLE_MS = 45000;

/** Достаёт из накопленного текста все законченные кадры. Хвост без пустой строки остаётся до следующей порции. */
export function takeFrames(buffer: string): {frames: SseFrame[]; consumed: number} {
  const frames: SseFrame[] = [];
  const separator = /\r?\n\r?\n/g;
  let consumed = 0;
  let match: RegExpExecArray | null = separator.exec(buffer);
  while (match !== null) {
    const block = buffer.slice(consumed, match.index);
    consumed = match.index + match[0].length;
    let event = '';
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (!line || line.startsWith(':')) {
        continue; // пустая строка или комментарий («пинг»)
      }
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) {
        value = value.slice(1);
      }
      if (field === 'event') {
        event = value;
      } else if (field === 'data') {
        data.push(value);
      }
    }
    if (event || data.length > 0) {
      frames.push({event: event || 'message', data: data.join('\n')});
    }
    match = separator.exec(buffer);
  }
  return {frames, consumed};
}

type OpenOptions = {
  url: string;
  headers?: Record<string, string>;
  /** Сервер ответил 200, поток начался. */
  onOpen?: () => void;
  onEvent: (event: string, data: string) => void;
  /** Вызывается один раз, когда поток закончился сам; после close() не вызывается. */
  onEnd: (end: StreamEnd) => void;
  idleMs?: number;
  xhrFactory?: () => XMLHttpRequest;
};

export function openEventStream(options: OpenOptions): StreamHandle {
  const xhr = (options.xhrFactory ?? (() => new XMLHttpRequest()))();
  const idleMs = options.idleMs ?? STREAM_IDLE_MS;
  let offset = 0;
  let opened = false;
  let finished = false;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const clearIdle = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };

  const finish = (end: StreamEnd) => {
    if (finished) {
      return;
    }
    finished = true;
    clearIdle();
    options.onEnd(end);
  };

  const armIdle = () => {
    clearIdle();
    idleTimer = setTimeout(() => {
      const status = xhr.status || 0;
      try {
        xhr.abort();
      } catch {
        // уже закрыт
      }
      finish({status, reason: 'idle'});
    }, idleMs);
  };

  const consume = () => {
    const {frames, consumed} = takeFrames((xhr.responseText ?? '').slice(offset));
    offset += consumed;
    for (const frame of frames) {
      if (finished) {
        return;
      }
      options.onEvent(frame.event, frame.data);
    }
  };

  const open = () => {
    if (opened || finished) {
      return;
    }
    opened = true;
    armIdle();
    options.onOpen?.();
  };

  xhr.open('GET', options.url);
  xhr.setRequestHeader('Accept', 'text/event-stream');
  xhr.setRequestHeader('Cache-Control', 'no-cache');
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    xhr.setRequestHeader(name, value);
  }
  xhr.timeout = 0;
  xhr.onreadystatechange = () => {
    if (xhr.readyState >= 2 && xhr.status === 200) {
      open();
    }
  };
  xhr.onprogress = () => {
    if (finished || xhr.status !== 200) {
      return;
    }
    open();
    armIdle();
    consume();
  };
  xhr.onload = () => {
    if (finished) {
      return;
    }
    if (xhr.status === 200) {
      consume();
      finish({status: 200, reason: 'ended'});
    } else {
      finish({status: xhr.status, reason: 'http'});
    }
  };
  xhr.onerror = () => finish({status: xhr.status || 0, reason: 'network'});
  xhr.ontimeout = () => finish({status: 0, reason: 'network'});
  xhr.onabort = () => finish({status: 0, reason: 'network'});
  xhr.send();

  return {
    close() {
      if (finished) {
        return;
      }
      finished = true; // дальше никаких событий: ни кадров, ни onEnd
      clearIdle();
      try {
        xhr.abort();
      } catch {
        // уже закрыт
      }
    },
  };
}
