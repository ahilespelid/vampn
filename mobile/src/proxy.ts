import {actionPath, type ActionMode} from './buttonState';
import type {VampnConfig} from './types';

const TOKEN_HEADER = 'X-Vampn-Token';

export async function callProxy(
  config: VampnConfig,
  mode: ActionMode,
): Promise<string> {
  const base = config.proxyUrl.trim().replace(/\/+$/, '');
  if (!base) {
    return 'Укажите адрес прокси в настройках.';
  }

  const path = actionPath(mode);
  try {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        [TOKEN_HEADER]: config.proxyToken,
      },
    });
    const text = (await response.text()).trim();
    if (response.status === 400) {
      return text || 'Токен отклонён';
    }
    return text || `Готово (${response.status})`;
  } catch (error) {
    return error instanceof Error ? error.message : 'Прокси недоступен';
  }
}
