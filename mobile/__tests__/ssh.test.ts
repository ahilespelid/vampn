jest.mock('react-native', () => ({
  TurboModuleRegistry: {
    get: jest.fn(() => null),
  },
}));

import {runSsh} from '../src/ssh';
import {defaultConfig} from '../src/types';

test('ssh stays usable when Expo Go has no native module', async () => {
  await expect(
    runSsh(
      {...defaultConfig, host: '10.0.0.2', username: 'root', commands: 'uptime'},
      'normal',
    ),
  ).resolves.toContain('Expo Go');
});
