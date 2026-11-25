import type {Role} from './api';
import type {IconName} from './icons';

export type TabId = 'service' | 'keys' | 'stats' | 'users' | 'settings';

export type TabDef = {id: TabId; label: string; adminOnly: boolean; icon: IconName};

export const TABS: TabDef[] = [
  {id: 'service', label: 'сервис', adminOnly: false, icon: 'shield'},
  {id: 'keys', label: 'ключи', adminOnly: false, icon: 'key'},
  {id: 'stats', label: 'статистика', adminOnly: false, icon: 'bars'},
  {id: 'users', label: 'люди', adminOnly: true, icon: 'users'},
  {id: 'settings', label: 'настройки', adminOnly: false, icon: 'sliders'},
];

export function tabsFor(role: Role): TabDef[] {
  return TABS.filter(tab => !tab.adminOnly || role === 'admin');
}
