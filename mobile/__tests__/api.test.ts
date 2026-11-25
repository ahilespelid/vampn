import {ApiClient, ApiError, DEFAULT_API_URL, NETWORK_MESSAGE, normalizeBaseUrl, TIMEOUT_MESSAGE} from '../src/api';

type Reply = {status?: number; body?: unknown; headers?: Record<string, string>; text?: string};

function fakeFetch(handler: (url: string, init: RequestInit) => Reply | Promise<Reply>) {
  const calls: {url: string; init: RequestInit}[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({url, init});
    const reply = await handler(url, init);
    const status = reply.status ?? 200;
    const text = reply.text ?? (reply.body === undefined ? '' : JSON.stringify(reply.body));
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => text,
      headers: {get: (name: string) => reply.headers?.[name] ?? null},
    };
  }) as unknown as typeof fetch;
  return {impl, calls};
}

function client(handler: Parameters<typeof fakeFetch>[0], token: string | null = 'tok', onUnauthorized?: () => void) {
  const f = fakeFetch(handler);
  return {
    api: new ApiClient({baseUrl: 'https://api.example.com/', getToken: () => token, onUnauthorized, fetchImpl: f.impl}),
    calls: f.calls,
  };
}

describe('normalizeBaseUrl', () => {
  test('добавляет https и убирает хвостовые слэши', () => {
    expect(normalizeBaseUrl('vamp.new.litewms.ru')).toBe('https://vamp.new.litewms.ru');
    expect(normalizeBaseUrl('  https://a.example.com/// ')).toBe('https://a.example.com');
    expect(normalizeBaseUrl('http://10.0.0.5:8741')).toBe('http://10.0.0.5:8741');
    expect(normalizeBaseUrl('https://a.example.com/api')).toBe('https://a.example.com/api');
  });

  test('отвергает мусор', () => {
    expect(normalizeBaseUrl('')).toBeNull();
    expect(normalizeBaseUrl('   ')).toBeNull();
    expect(normalizeBaseUrl('https://')).toBeNull();
    expect(normalizeBaseUrl('ftp://a.example.com')).toBeNull();
    expect(normalizeBaseUrl('a b.com')).toBeNull();
    expect(normalizeBaseUrl('https://user@evil.com')).toBeNull();
  });

  test('адрес по умолчанию корректен', () => {
    expect(normalizeBaseUrl(DEFAULT_API_URL)).toBe(DEFAULT_API_URL);
  });
});

describe('ApiClient', () => {
  test('добавляет токен и тело, обрезает слэш в адресе', async () => {
    const {api, calls} = client(() => ({body: {text: 'ok'}}));
    await api.rotate(true);
    expect(calls[0].url).toBe('https://api.example.com/v1/control/rotate');
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(calls[0].init.body).toBe(JSON.stringify({force: true}));
  });

  test('вход не отправляет токен', async () => {
    const {api, calls} = client(() => ({body: {ok: true}}));
    await api.requestCode('a@example.com');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  test('имя ключа кодируется в адресе', async () => {
    const {api, calls} = client(() => ({body: {name: 'a', link: 'vpn://x'}}));
    await api.keyLink('a b', 7);
    expect(calls[0].url).toBe('https://api.example.com/v1/keys/a%20b/link?notification_id=7');
  });

  test('ключ приходит вместе с .conf для QR', async () => {
    const {api} = client(() => ({body: {name: 'a', link: 'vpn://x', conf: '[Interface]\nAddress = 1'}}));
    const key = await api.keyLink('a');
    expect(key.link).toBe('vpn://x');
    expect(key.conf).toContain('[Interface]');
  });

  test('рассылка ключей всем: POST с долгим таймаутом, статус рассылки: GET', async () => {
    const a = client(() => ({body: {ok: false, summary: 'ИТОГ: принято 2 из 3, не ушло: b'}}));
    const out = await a.api.adminResendAll();
    expect(a.calls[0].url).toBe('https://api.example.com/v1/admin/keys/resendall');
    expect(a.calls[0].init.method).toBe('POST');
    expect(out).toEqual({ok: false, summary: 'ИТОГ: принято 2 из 3, не ушло: b'});
    const b = client(() => ({body: {ok: true, text: 'ИМЯ ПОЧТА'}}));
    expect((await b.api.adminMailStatus()).text).toBe('ИМЯ ПОЧТА');
    expect(b.calls[0].url).toBe('https://api.example.com/v1/admin/mail-status');
    expect(b.calls[0].init.method).toBe('GET');
  });

  test('неверный код отдаёт число оставшихся попыток', async () => {
    const {api} = client(() => ({status: 401, body: {error: 'invalid_code', message: 'неверный код', attempts_left: 3}}), null);
    const error = await api.verify('a@example.com', '0000').catch(e => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('invalid_code');
    expect(error.attemptsLeft).toBe(3);
  });

  test('блокировка: 429 и Retry-After из тела или заголовка', async () => {
    const a = client(() => ({status: 429, body: {error: 'locked', message: 'x', retry_after: 3600}}));
    expect(((await a.api.status().catch(e => e)) as ApiError).retryAfter).toBe(3600);
    const b = client(() => ({status: 429, body: {error: 'locked', message: 'x'}, headers: {'Retry-After': '120'}}));
    expect(((await b.api.status().catch(e => e)) as ApiError).retryAfter).toBe(120);
  });

  test('401 на защищённом запросе сбрасывает сессию', async () => {
    const onUnauthorized = jest.fn();
    const {api} = client(() => ({status: 401, body: {error: 'unauthorized', message: 'x'}}), 'tok', onUnauthorized);
    await api.me().catch(() => undefined);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  test('401 при вводе кода сессию не трогает', async () => {
    const onUnauthorized = jest.fn();
    const {api} = client(() => ({status: 401, body: {error: 'invalid_code', message: 'x'}}), null, onUnauthorized);
    await api.verify('a@example.com', '1').catch(() => undefined);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  test('нет связи и ошибка проверки данных', async () => {
    const f = new ApiClient({
      baseUrl: 'https://x.example.com',
      getToken: () => null,
      fetchImpl: (async () => {
        throw new TypeError('Network request failed');
      }) as unknown as typeof fetch,
    });
    const error = (await f.health().catch(e => e)) as ApiError;
    expect(error.code).toBe('network');

    const v = client(() => ({status: 422, body: {detail: [{msg: 'bad'}]}}));
    const bad = (await v.api.createUser({name: 'x', email: 'y', role: 'user'}).catch(e => e)) as ApiError;
    expect(bad.code).toBe('validation');
  });

  test('не-JSON ответ считается ошибкой сервера', async () => {
    const {api} = client(() => ({text: '<html>oops</html>'}));
    const error = (await api.status().catch(e => e)) as ApiError;
    expect(error.code).toBe('bad_response');
  });
});

describe('связь с сервером', () => {
  const answer = (status: number, text = '{}') =>
    (async () => ({
      ok: status < 300,
      status,
      text: async () => text,
      headers: {get: () => null},
    })) as unknown as typeof fetch;

  const failing = (error: Error) =>
    (async () => {
      throw error;
    }) as unknown as typeof fetch;

  function probe(impl: typeof fetch) {
    const states: string[] = [];
    const api = new ApiClient({
      baseUrl: 'https://x.example.com',
      getToken: () => 'tok',
      onLink: state => states.push(state),
      fetchImpl: impl,
    });
    return {api, states};
  }

  test('любой ответ сервера, даже с ошибкой, значит, что связь есть', async () => {
    const fine = probe(answer(200));
    await fine.api.status();
    const denied = probe(answer(401, JSON.stringify({error: 'invalid_code', message: 'x'})));
    await denied.api.me().catch(() => undefined);
    expect(fine.states).toEqual(['ok']);
    expect(denied.states).toEqual(['ok']);
  });

  test('обрыв сети и таймаут сообщаются с понятным текстом', async () => {
    const offline = probe(failing(new TypeError('Network request failed')));
    const noNet = (await offline.api.status().catch(e => e)) as ApiError;
    expect(offline.states).toEqual(['network']);
    expect(noNet.code).toBe('network');
    expect(noNet.message).toBe(NETWORK_MESSAGE);

    const aborted = new Error('aborted');
    aborted.name = 'AbortError';
    const slow = probe(failing(aborted));
    const noAnswer = (await slow.api.status().catch(e => e)) as ApiError;
    expect(slow.states).toEqual(['timeout']);
    expect(noAnswer.code).toBe('timeout');
    expect(noAnswer.message).toBe(TIMEOUT_MESSAGE);
  });

  test('502–504 от шлюза: сервер не отвечает, а не «ошибка 502»', async () => {
    const gateway = probe(answer(502, '<html>Bad gateway</html>'));
    const error = (await gateway.api.status().catch(e => e)) as ApiError;
    expect(gateway.states).toEqual(['timeout']);
    expect(error.status).toBe(502);
    expect(error.message).toBe(TIMEOUT_MESSAGE);
  });
});
