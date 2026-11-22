export type ActionMode = 'rotate' | 'force';

export type VampnConfig = {
  host: string;
  port: string;
  username: string;
  password: string;
  privateKey: string;
  passphrase: string;
  commands: string;
  resetCommands: string;
  telegramBotToken: string;
  telegramChatId: string;
  agentUrl: string;
  agentToken: string;
  actionMode: ActionMode;
};

export const defaultConfig: VampnConfig = {
  host: '',
  port: '22',
  username: '',
  password: '',
  privateKey: '',
  passphrase: '',
  commands: '',
  resetCommands: '',
  telegramBotToken: '',
  telegramChatId: '',
  agentUrl: '',
  agentToken: '',
  actionMode: 'rotate',
};

export function parseCommands(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'));
}
