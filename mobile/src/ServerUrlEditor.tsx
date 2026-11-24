import {useState} from 'react';
import {View} from 'react-native';

import {ApiClient, DEFAULT_API_URL, normalizeBaseUrl} from './api';
import {useAuth} from './auth';
import {describeError} from './format';
import {Btn, Field, Notice} from './ui';

/** Адрес API необязателен: по умолчанию общий сервер, но его можно заменить своим. */
export function ServerUrlEditor({onSaved}: {onSaved?: () => void}) {
  const auth = useAuth();
  const [value, setValue] = useState(auth.apiUrl);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{kind: 'error' | 'info'; text: string} | null>(null);

  const check = async () => {
    const normalized = normalizeBaseUrl(value);
    if (!normalized) {
      setMessage({kind: 'error', text: 'Неверный адрес сервера'});
      return;
    }
    setBusy(true);
    try {
      await new ApiClient({baseUrl: normalized, getToken: () => null}).health();
      setMessage({kind: 'info', text: 'Сервер отвечает'});
    } catch (error) {
      setMessage({kind: 'error', text: describeError(error)});
    } finally {
      setBusy(false);
    }
  };

  const save = async (raw: string) => {
    setBusy(true);
    try {
      const normalized = await auth.setApiUrl(raw);
      setValue(normalized);
      setMessage({kind: 'info', text: 'Адрес сохранён'});
      onSaved?.();
    } catch (error) {
      setMessage({kind: 'error', text: describeError(error)});
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{gap: 12}}>
      <Field
        testID="api-url"
        label="Адрес сервера"
        value={value}
        onChangeText={setValue}
        keyboardType="url"
        placeholder={DEFAULT_API_URL}
      />
      {message ? <Notice kind={message.kind} text={message.text} /> : null}
      <View style={{flexDirection: 'row', gap: 10, flexWrap: 'wrap'}}>
        <Btn small kind="ghost" title="проверить" onPress={check} disabled={busy} />
        <Btn small title="сохранить" onPress={() => save(value)} disabled={busy} testID="api-url-save" />
        <Btn small kind="ghost" title="по умолчанию" onPress={() => save(DEFAULT_API_URL)} disabled={busy} />
      </View>
    </View>
  );
}
