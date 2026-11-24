import {useEffect, useRef} from 'react';

import {useAuth} from './auth';

/** Вызывает `load` заново каждый раз, когда связь с сервером вернулась после обрыва. */
export function useReconnect(load: () => void): void {
  const {reconnects} = useAuth();
  const seen = useRef(reconnects);

  useEffect(() => {
    if (reconnects !== seen.current) {
      seen.current = reconnects;
      load();
    }
  }, [reconnects, load]);
}
