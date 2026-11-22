import {TurboModuleRegistry} from 'react-native';

import type {Spec} from '../specs/NativeVampnSsh';
import {parseCommands, type VampnConfig} from './types';

type CommandSet = 'normal' | 'reset';

type SshResponse = {
  ok?: boolean;
  output?: string;
};

function nativeSsh(): Spec {
  const mod = TurboModuleRegistry.get<Spec>('NativeVampnSsh');
  if (!mod) {
    throw new Error('SSH-модуль не подключён');
  }
  return mod;
}

export async function runSsh(
  config: VampnConfig,
  which: CommandSet,
): Promise<string> {
  const commands = parseCommands(
    which === 'reset' ? config.resetCommands : config.commands,
  );
  if (commands.length === 0) {
    return which === 'reset'
      ? 'Добавьте команды сброса IP в настройках.'
      : 'Добавьте SSH-команды в настройках.';
  }
  if (!config.host.trim() || !config.username.trim()) {
    return 'Укажите хост и пользователя в настройках.';
  }

  const port = Number.parseInt(config.port, 10);
  const request = {
    host: config.host.trim(),
    port: Number.isFinite(port) && port > 0 ? port : 22,
    username: config.username.trim(),
    password: config.password,
    privateKey: config.privateKey.trim(),
    passphrase: config.passphrase,
    commands,
  };

  const raw = await nativeSsh().exec(JSON.stringify(request));
  let parsed: SshResponse = {};
  try {
    parsed = JSON.parse(raw) as SshResponse;
  } catch {
    return raw;
  }
  const output = (parsed.output || '').trim();
  if (parsed.ok === false) {
    return output || 'Команда завершилась с ошибкой';
  }
  return output || 'Готово';
}
