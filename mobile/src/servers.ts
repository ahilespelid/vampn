import type {Cell, SpawnState, SpawnStatus} from './api';

export const TIMEWEB_TOKENS_URL = 'https://timeweb.cloud/my/api-keys';
export const SPAWN_POLL_MS = 5000;

/** Имя кабинета: как проверяет сервер (латиница в нижнем регистре, цифры, _ и -, до 24 знаков, с буквы или цифры). */
export function validAccountName(name: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,23}$/.test(name) && name !== 'main' && name !== 'spare';
}

/** Токен API Timeweb - длинная строка из букв, цифр и . _ -; пробелы по краям (при вставке) не считаются. */
export function validTimewebToken(token: string): boolean {
  return /^[A-Za-z0-9._-]{20,4096}$/.test(token.trim());
}

export function spawnBusy(state: SpawnState | undefined): boolean {
  return state === 'queued' || state === 'running';
}

export function cellTone(state: string): 'ok' | 'signal' | 'muted' {
  if (state === 'активна') {
    return 'ok';
  }
  if (state === 'ошибка') {
    return 'signal';
  }
  return 'muted';
}

/** Сколько ещё влезет в ячейку (клиентов). */
export function cellFree(cell: Pick<Cell, 'users' | 'limit'>): number {
  return Math.max(0, cell.limit - cell.users);
}

export function spawnTitle(status: SpawnStatus | null): string {
  switch (status?.state) {
    case 'queued':
      return 'Аренда поставлена в очередь';
    case 'running':
      return `Идёт развёртывание: ${status.detail || 'подготовка'}`;
    case 'done':
      return `Готово: ${status.detail}`;
    case 'failed':
      return `Не удалось: ${status.detail}`;
    default:
      return '';
  }
}
