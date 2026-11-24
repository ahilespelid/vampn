import {ApiError, type AppNotification} from '../src/api';
import {
  cleanCode,
  describeError,
  formatDate,
  lockMessage,
  notificationStatus,
  validEmail,
  validName,
} from '../src/format';
import {tabsFor} from '../src/tabs';
import {resolveTheme} from '../src/theme';
import {downsample} from '../src/screens/StatsScreen';

test('почта и имя', () => {
  expect(validEmail('a@example.com')).toBe(true);
  expect(validEmail(' a@example.com ')).toBe(true);
  expect(validEmail('a@example')).toBe(false);
  expect(validEmail('a b@example.com')).toBe(false);
  expect(validName('ivan.petrov-1')).toBe(true);
  expect(validName('bad name')).toBe(false);
  expect(validName('')).toBe(false);
  expect(validName('x'.repeat(33))).toBe(false);
});

test('код: только цифры, не больше четырёх', () => {
  expect(cleanCode('12 34-56')).toBe('1234');
  expect(cleanCode('ab')).toBe('');
});

test('дата', () => {
  expect(formatDate(null)).toBe('—');
  expect(formatDate('не дата')).toBe('—');
  expect(formatDate('2026-11-24T03:05:00Z')).toMatch(/^\d{2}\.\d{2}\.2026 \d{2}:\d{2}$/);
});

test('сообщения об ошибках входа', () => {
  expect(lockMessage(3600)).toContain('час');
  expect(lockMessage(300)).toContain('5 мин');
  expect(describeError(new ApiError(401, 'invalid_code', 'x', {attempts_left: 4}))).toContain('4');
  expect(describeError(new ApiError(401, 'invalid_code', 'x', {attempts_left: 0}))).toContain('новый');
  expect(describeError(new ApiError(429, 'locked', 'x', {retry_after: 3600}))).toContain('час');
  expect(describeError(new ApiError(0, 'network', 'Нет связи с сервером'))).toBe('Нет связи с сервером');
  expect(describeError(new Error('boom'))).toBe('boom');
});

test('вкладки зависят от роли', () => {
  expect(tabsFor('admin').map(t => t.id)).toEqual(['service', 'keys', 'stats', 'users', 'settings']);
  expect(tabsFor('user').map(t => t.id)).toEqual(['service', 'keys', 'stats', 'settings']);
});

test('статус уведомления: от создания до прочтения', () => {
  const base: AppNotification = {
    id: 1,
    user_name: 'a',
    key_id: 1,
    kind: 'key',
    title: 't',
    email_sent_at: null,
    push_sent_at: null,
    delivered_at: null,
    read_at: null,
    created_at: '2026-11-24T00:00:00Z',
  };
  expect(notificationStatus(base).label).toBe('создано');
  expect(notificationStatus({...base, email_sent_at: 'x'}).label).toBe('на почте');
  expect(notificationStatus({...base, email_sent_at: 'x', push_sent_at: 'x'}).label).toBe('push отправлен');
  expect(notificationStatus({...base, delivered_at: 'x'}).label).toBe('доставлено');
  expect(notificationStatus({...base, delivered_at: 'x', read_at: 'x'})).toEqual({label: 'прочитано', tone: 'ok'});
});

test('тема: авто следует системе', () => {
  expect(resolveTheme('auto', true).bg).toBe('#000000');
  expect(resolveTheme('auto', false).bg).toBe('#f4f4f2');
  expect(resolveTheme('light', true).dark).toBe(false);
  expect(resolveTheme('dark', false).dark).toBe(true);
});

test('график: ряд сжимается до 48 столбцов по максимуму', () => {
  const points = Array.from({length: 96}, (_, i) => ({ts: String(i), value: i}));
  const bars = downsample(points);
  expect(bars).toHaveLength(48);
  expect(bars[0]).toBe(1);
  expect(bars[47]).toBe(95);
  expect(downsample(points.slice(0, 5))).toEqual([0, 1, 2, 3, 4]);
});
