import {useCallback, useEffect, useRef, useState} from 'react';
import {AppState} from 'react-native';

import type {ApiClient, AppNotification, NotificationStreamHandlers} from './api';
import type {StreamHandle} from './sse';

/** Опрос, когда живого потока нет. */
export const POLL_MS = 15000;
/** Страховочный опрос при живом потоке: на случай, если поток молча потерял событие. */
export const LIVE_POLL_MS = 60000;
/** Переподключение после обрыва: 3 с, дальше вдвое дольше, не реже раза в минуту. */
export const RECONNECT_MIN_MS = 3000;
export const RECONNECT_MAX_MS = 60000;
/** Плановое закрытие потока сервером (`bye`) не ошибка: подключаемся почти сразу. */
export const RECONNECT_AFTER_BYE_MS = 1000;
/** Сервер без потока (старая версия отвечает 404/405/501): проверяем раз в 10 минут. */
export const UNSUPPORTED_RETRY_MS = 600000;

export type NotificationsState = {
  items: AppNotification[];
  unread: number;
  banner: AppNotification | null;
  dismissBanner: () => void;
  refresh: () => Promise<void>;
  markRead: (id: number) => Promise<void>;
};

/**
 * Пока приложение открыто, держит поток SSE: сервер сам сообщает, когда уведомления изменились, и список обновляется сразу.
 * Если потока нет (обрыв, сервер без этой возможности), список опрашивается раз в 15 секунд, а поток переподключается.
 * Новые уведомления показываются баннером и отмечаются «доставлено»; «прочитано» ставится по нажатию.
 */
export function useNotifications(api: ApiClient, enabled: boolean): NotificationsState {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [banner, setBanner] = useState<AppNotification | null>(null);
  const seen = useRef<Set<number> | null>(null);
  const delivering = useRef<Set<number>>(new Set());
  const requested = useRef(0);
  const applied = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++requested.current;
    try {
      const {notifications} = await api.notifications();
      if (mine < applied.current) {
        return; // уже применён более свежий ответ
      }
      applied.current = mine;
      const known = seen.current;
      const fresh = known ? notifications.filter(n => !known.has(n.id) && !n.read_at) : [];
      seen.current = new Set(notifications.map(n => n.id));
      if (fresh.length > 0) {
        setBanner(fresh[0]);
      }

      const toDeliver = notifications.filter(n => !n.delivered_at && !delivering.current.has(n.id));
      const nowIso = new Date().toISOString();
      for (const n of toDeliver) {
        delivering.current.add(n.id);
        api.markDelivered(n.id).catch(() => delivering.current.delete(n.id));
      }
      setItems(
        notifications.map(n => (toDeliver.includes(n) ? {...n, delivered_at: nowIso} : n)),
      );
    } catch {
      // нет связи: останется прежний список
    }
  }, [api]);

  const markRead = useCallback(
    async (id: number) => {
      await api.markRead(id);
      const nowIso = new Date().toISOString();
      setItems(list => list.map(n => (n.id === id ? {...n, read_at: nowIso, delivered_at: n.delivered_at ?? nowIso} : n)));
    },
    [api],
  );

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    seen.current = null;
    delivering.current = new Set();
    applied.current = requested.current;

    let stopped = false;
    let live = false;
    let failures = 0;
    let generation = 0;
    let stream: StreamHandle | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const stopPoll = () => {
      if (poll) {
        clearInterval(poll);
        poll = null;
      }
    };
    const startPoll = () => {
      stopPoll();
      poll = setInterval(refresh, live ? LIVE_POLL_MS : POLL_MS);
    };
    const stopStream = () => {
      generation += 1; // события закрытого потока больше не обрабатываются
      if (retry) {
        clearTimeout(retry);
        retry = null;
      }
      if (stream) {
        stream.close();
        stream = null;
      }
      live = false;
    };

    const connect = () => {
      if (stopped || stream) {
        return;
      }
      retry = null;
      const mine = (generation += 1);
      let lastEvent = '';
      const handlers: NotificationStreamHandlers = {
        onEvent: event => {
          if (mine !== generation) {
            return;
          }
          lastEvent = event;
          if (event === 'ready') {
            failures = 0;
            live = true;
            startPoll();
            refresh(); // догоняем всё, что случилось, пока потока не было
          } else if (event === 'changed') {
            refresh();
          } else if (event === 'unauthorized') {
            refresh(); // ответ 401 сбросит сессию так же, как при обычном запросе
          }
        },
        onEnd: end => {
          if (mine !== generation) {
            return;
          }
          stream = null;
          live = false;
          startPoll();
          if (end.status === 401) {
            refresh();
          }
          const clean = lastEvent === 'bye';
          if (!clean) {
            failures += 1;
          }
          const unsupported = end.status === 404 || end.status === 405 || end.status === 501;
          const delay = unsupported
            ? UNSUPPORTED_RETRY_MS
            : clean
            ? RECONNECT_AFTER_BYE_MS
            : Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** (failures - 1));
          retry = setTimeout(connect, delay);
        },
      };
      try {
        stream = api.notificationStream(handlers);
      } catch {
        // поток открыть нельзя (нет XMLHttpRequest и т. п.): остаётся обычный опрос, исключение не должно ронять экран
        stream = null;
        retry = setTimeout(connect, UNSUPPORTED_RETRY_MS);
      }
    };

    refresh();
    startPoll();
    connect();
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'active') {
        refresh();
        startPoll();
        failures = 0;
        connect();
      } else {
        stopPoll();
        stopStream();
      }
    });
    return () => {
      stopped = true;
      stopPoll();
      stopStream();
      subscription.remove();
    };
  }, [api, enabled, refresh]);

  useEffect(() => {
    if (!banner) {
      return undefined;
    }
    const timer = setTimeout(() => setBanner(null), 8000);
    return () => clearTimeout(timer);
  }, [banner]);

  const dismissBanner = useCallback(() => setBanner(null), []);

  return {
    items,
    unread: items.filter(n => !n.read_at).length,
    banner,
    dismissBanner,
    refresh,
    markRead,
  };
}
