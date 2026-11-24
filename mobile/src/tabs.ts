import type {Role} from './api';

export type TabId = 'service' | 'keys' | 'stats' | 'users' | 'settings';

export type TabDef = {id: TabId; label: string; adminOnly: boolean};

export const TABS: TabDef[] = [
  {id: 'service', label: 'сервис', adminOnly: false},
  {id: 'keys', label: 'ключи', adminOnly: false},
  {id: 'stats', label: 'статистика', adminOnly: false},
  {id: 'users', label: 'люди', adminOnly: true},
  {id: 'settings', label: 'ещё', adminOnly: false},
];

export function tabsFor(role: Role): TabDef[] {
  return TABS.filter(tab => !tab.adminOnly || role === 'admin');
}
