export type NetState = 'unknown' | 'online' | 'offline';

export function buttonLabel(state: NetState, busy: boolean): string {
  if (busy || state === 'unknown') {
    return '...';
  }
  if (state === 'online') {
    return 'есть интернет';
  }
  return 'сбросить IP';
}

export function showsOfflineStatus(state: NetState, busy: boolean): boolean {
  return state === 'offline' && !busy;
}

export type PressPlan = 'check-and-run' | 'reset-ip';

export function pressPlan(state: NetState): PressPlan {
  return state === 'offline' ? 'reset-ip' : 'check-and-run';
}
