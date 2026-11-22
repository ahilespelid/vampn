import {
  actionLabel,
  actionPath,
  buttonLabel,
  pressPlan,
  showsOfflineStatus,
} from '../src/buttonState';
import {pingTelegram} from '../src/telegram';
import {defaultConfig, parseCommands} from '../src/types';

test('button shows internet when the telegram ping succeeds', () => {
  expect(buttonLabel('online', false)).toBe('есть интернет');
  expect(showsOfflineStatus('online', false)).toBe(false);
  expect(pressPlan('online')).toBe('check-and-run');
});

test('button asks to reset IP when there is no internet', () => {
  expect(buttonLabel('offline', false)).toBe('сбросить IP');
  expect(showsOfflineStatus('offline', false)).toBe(true);
  expect(pressPlan('offline')).toBe('reset-ip');
});

test('rotate is the default proxy action and force is explicit', () => {
  expect(actionPath('rotate')).toBe('/rotate');
  expect(actionPath('force')).toBe('/force');
  expect(actionLabel('rotate')).toBe('rotate');
  expect(actionLabel('force')).toBe('сбросить принудительно');
});

test('parseCommands keeps one command per line', () => {
  expect(parseCommands('uptime\n\n# comment\nwhoami\r\n')).toEqual([
    'uptime',
    'whoami',
  ]);
});

test('any HTTP response from Telegram counts as internet', async () => {
  (globalThis as {fetch: typeof fetch}).fetch = jest
    .fn()
    .mockResolvedValue({status: 401}) as unknown as typeof fetch;
  await expect(
    pingTelegram(
      {...defaultConfig, telegramBotToken: 'token'},
      {notify: false},
    ),
  ).resolves.toBe(true);
});

test('a failed Telegram request counts as no internet', async () => {
  (globalThis as {fetch: typeof fetch}).fetch = jest
    .fn()
    .mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
  await expect(pingTelegram(defaultConfig, {notify: false})).resolves.toBe(
    false,
  );
});
