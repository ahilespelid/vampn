import type {VampnConfig} from './types';

const PING_TIMEOUT_MS = 8000;

type PingOptions = {
  notify: boolean;
};

function endpoint(config: VampnConfig, notify: boolean): {url: string; init: RequestInit} {
  const token = config.telegramBotToken.trim();
  const chatId = config.telegramChatId.trim();

  if (token && chatId && notify) {
    return {
      url: `https://api.telegram.org/bot${token}/sendMessage`,
      init: {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          chat_id: chatId,
          text: 'vampn',
          disable_notification: true,
        }),
      },
    };
  }

  if (token) {
    return {
      url: `https://api.telegram.org/bot${token}/getMe`,
      init: {method: 'GET'},
    };
  }

  return {
    url: 'https://api.telegram.org',
    init: {method: 'GET'},
  };
}

export async function pingTelegram(
  config: VampnConfig,
  options: PingOptions,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
  const {url, init} = endpoint(config, options.notify);

  try {
    const response = await fetch(url, {...init, signal: controller.signal});
    return response.status > 0;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
