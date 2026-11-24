import {useCallback, useEffect, useRef, useState} from 'react';
import {AppState} from 'react-native';

import type {ApiClient, AppNotification} from './api';

const POLL_MS = 15000;

export type NotificationsState = {
  items: AppNotification[];
  unread: number;
  banner: AppNotification | null;
  dismissBanner: () => void;
  refresh: () => Promise<void>;
  markRead: (id: number) => Promise<void>;
};

/**
 * Пока приложение открыто, раз в 15 секунд спрашивает у сервера уведомления.
 * Новые показывает баннером и отмечает «доставлено»; «прочитано» ставится по нажатию.
 */
export function useNotifications(api: ApiClient, enabled: boolean): NotificationsState {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [banner, setBanner] = useState<AppNotification | null>(null);
  const seen = useRef<Set<number> | null>(null);
  const delivering = useRef<Set<number>>(new Set());

  const refresh = useCallback(async () => {
    try {
      const {notifications} = await api.notifications();
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
    refresh();
    let timer: ReturnType<typeof setInterval> | null = setInterval(refresh, POLL_MS);
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'active') {
        refresh();
        if (!timer) {
          timer = setInterval(refresh, POLL_MS);
        }
      } else if (timer) {
        clearInterval(timer);
        timer = null;
      }
    });
    return () => {
      if (timer) {
        clearInterval(timer);
      }
      subscription.remove();
    };
  }, [enabled, refresh]);

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
