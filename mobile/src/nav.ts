import {createContext, useContext} from 'react';

/** Что оболочка даёт экранам: открыть вкладку настроек (круг аккаунта в шапке). */
export type Nav = {openSettings: () => void};

export const NavContext = createContext<Nav>({openSettings: () => undefined});

export function useNav(): Nav {
  return useContext(NavContext);
}
