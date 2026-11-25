import {useSyncExternalStore} from 'react';

import type {TraceEvent} from './api';

/** Один обмен с сервером: что приложение отправило и что сервер ответил. */
export type LogEntry = {
  id: number;
  at: number;
  method: string;
  path: string;
  body?: string;
  /** Команда vampn, которую сервер запускает по этому запросу. */
  command: string;
  state: 'pending' | 'ok' | 'error';
  /** HTTP-статус; 0, если ответа не было. */
  status?: number;
  ms?: number;
  response?: string;
};

export type LogSnapshot = {entries: LogEntry[]; dismissed: number};

const MAX_ENTRIES = 30;

/** Чистая часть: как событие запроса меняет список (новые записи сверху). */
export function reduceTrace(entries: LogEntry[], event: TraceEvent): LogEntry[] {
  if (event.phase === 'start') {
    const entry: LogEntry = {
      id: event.id,
      at: event.at,
      method: event.method,
      path: event.path,
      body: event.body,
      command: event.command,
      state: 'pending',
    };
    return [entry, ...entries].slice(0, MAX_ENTRIES);
  }
  const state: LogEntry['state'] = event.ok ? 'ok' : 'error';
  return entries.map(entry =>
    entry.id === event.id ? {...entry, state, status: event.status, ms: event.ms, response: event.response} : entry,
  );
}

let snapshot: LogSnapshot = {entries: [], dismissed: 0};
const listeners = new Set<() => void>();

function publish(next: LogSnapshot) {
  snapshot = next;
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function pushTrace(event: TraceEvent) {
  publish({...snapshot, entries: reduceTrace(snapshot.entries, event)});
}

/** Очищает журнал: при выходе, смене сервера и закрытии приложения. */
export function clearLog() {
  if (snapshot.entries.length > 0 || snapshot.dismissed !== 0) {
    publish({entries: [], dismissed: 0});
  }
}

/** Прячет строку внизу экрана до следующего обмена; сам журнал остаётся. */
export function dismissLatest() {
  const latest = snapshot.entries[0];
  if (latest) {
    publish({...snapshot, dismissed: latest.id});
  }
}

export function useServerLog(): LogSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot);
}
