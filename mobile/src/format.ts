import {ApiError, type AppNotification} from './api';

export function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function validName(value: string): boolean {
  return /^[A-Za-z0-9._-]{1,32}$/.test(value);
}

export function cleanCode(value: string): string {
  return value.replace(/\D/g, '').slice(0, 4);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatDate(iso?: string | null): string {
  if (!iso) {
    return '—';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

export function lockMessage(seconds?: number): string {
  if (!seconds || seconds <= 0) {
    return 'Слишком много попыток. Повторите позже.';
  }
  const minutes = Math.ceil(seconds / 60);
  return minutes >= 60
    ? 'Слишком много попыток. Повторите примерно через час.'
    : `Слишком много попыток. Повторите через ${minutes} мин.`;
}

export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'locked') {
      return lockMessage(error.retryAfter);
    }
    if (error.code === 'invalid_code') {
      const left = error.attemptsLeft;
      return left && left > 0 ? `Неверный код. Осталось попыток: ${left}.` : 'Неверный или просроченный код. Запросите новый.';
    }
    if (error.code === 'unauthorized') {
      return 'Сессия закончилась. Войдите заново.';
    }
    if (error.code === 'forbidden') {
      return 'Недостаточно прав.';
    }
    if (error.code === 'command_failed') {
      return 'Команда на сервере не выполнилась.';
    }
    return error.message;
  }
  return error instanceof Error ? error.message : 'Что-то пошло не так';
}

export function keyReasonLabel(reason: string): string {
  switch (reason) {
    case 'created':
      return 'выдан';
    case 'reissued':
      return 'перевыпущен';
    case 'resent':
      return 'отправлен повторно';
    default:
      return reason;
  }
}

export function eventLabel(event: string): string {
  switch (event) {
    case 'created':
      return 'добавлен';
    case 'email_changed':
      return 'почта изменена';
    case 'revoked':
      return 'отозван';
    case 'restored':
      return 'восстановлен';
    case 'role_changed':
      return 'роль изменена';
    case 'conflict':
      return 'конфликт';
    default:
      return event;
  }
}

export function sourceLabel(source: string): string {
  switch (source) {
    case 'file':
      return 'файл';
    case 'db':
      return 'база';
    case 'app':
      return 'приложение';
    case 'system':
      return 'система';
    default:
      return source;
  }
}

export function roleLabel(role: string): string {
  return role === 'admin' ? 'суперадмин' : 'пользователь';
}

export type Tone = 'ok' | 'signal' | 'muted';

export function notificationStatus(n: AppNotification): {label: string; tone: Tone} {
  if (n.read_at) {
    return {label: 'прочитано', tone: 'ok'};
  }
  if (n.delivered_at) {
    return {label: 'доставлено', tone: 'muted'};
  }
  if (n.push_sent_at) {
    return {label: 'push отправлен', tone: 'muted'};
  }
  if (n.email_sent_at) {
    return {label: 'на почте', tone: 'muted'};
  }
  return {label: 'создано', tone: 'muted'};
}

/** Время суток с секундами: 14:05:09. */
export function formatClock(ms: number): string {
  const date = new Date(ms);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Длительность: «3,4 с», «45 с», «2 мин 5 с». */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, ms) / 1000;
  if (seconds < 10) {
    return `${(Math.round(seconds * 10) / 10).toString().replace('.', ',')} с`;
  }
  const whole = Math.round(seconds);
  if (whole < 60) {
    return `${whole} с`;
  }
  return `${Math.floor(whole / 60)} мин ${whole % 60} с`;
}
