import {useCallback, useEffect, useState} from 'react';
import {Alert, View} from 'react-native';

import {useAuth} from '../auth';
import {describeError} from '../format';
import {Body, Btn, Card, Label, Notice, Page, Segmented, Sheet} from '../ui';

type Result = {title: string; text: string} | null;

export function HomeScreen() {
  const {api, user} = useAuth();
  const isAdmin = user?.role === 'admin';
  const [status, setStatus] = useState('');
  const [emergency, setEmergency] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [mode, setMode] = useState<'rotate' | 'force'>('rotate');
  const [result, setResult] = useState<Result>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [s, e] = await Promise.all([api.status(), isAdmin ? api.emergency('status') : Promise.resolve(null)]);
      setStatus(s.text.trim());
      setEmergency(e ? e.text.trim() : '');
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, [api, isAdmin]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (id: string, title: string, job: () => Promise<{text: string}>) => {
    setBusy(id);
    setError('');
    try {
      const out = await job();
      setResult({title, text: out.text.trim() || 'Готово'});
      load();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy('');
    }
  };

  const rotate = () => {
    const force = mode === 'force';
    const go = () => act('rotate', force ? 'Смена IP (принудительно)' : 'Смена IP', () => api.rotate(force));
    if (force) {
      Alert.alert('Сменить IP принудительно?', 'Адрес сервера сменится сразу, даже если он не заблокирован. Все подключённые получат новые ключи.', [
        {text: 'Отмена', style: 'cancel'},
        {text: 'Сменить', style: 'destructive', onPress: go},
      ]);
    } else {
      go();
    }
  };

  const reboot = () => {
    const go = (hard: boolean) => act('reboot', hard ? 'Жёсткая перезагрузка' : 'Перезагрузка', () => api.reboot(hard));
    Alert.alert('Перезагрузить VPN-сервер?', 'Подключение пропадёт на пару минут.', [
      {text: 'Отмена', style: 'cancel'},
      {text: 'Перезагрузить', style: 'destructive', onPress: () => go(false)},
      ...(isAdmin ? [{text: 'Жёстко', style: 'destructive' as const, onPress: () => go(true)}] : []),
    ]);
  };

  const showServer = () => act('server', 'Сервер', () => api.server());

  const setEmergencyMode = (value: 'on' | 'off') => {
    Alert.alert(value === 'on' ? 'Включить аварийный канал?' : 'Выключить аварийный канал?', '', [
      {text: 'Отмена', style: 'cancel'},
      {text: 'Да', onPress: () => act('emergency', 'Аварийный канал', () => api.emergency(value))},
    ]);
  };

  return (
    <Page title="сервис" refreshing={loading} onRefresh={load}>
      {error ? <Notice kind="error" text={error} /> : null}

      <Card style={{gap: 14}}>
        <Label>смена адреса</Label>
        <Body muted>Если VPN перестал работать, смените IP сервера. Обычно сторож делает это сам, кнопка нужна для ручного запуска.</Body>
        {isAdmin ? (
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              {value: 'rotate', label: 'если заблокирован'},
              {value: 'force', label: 'принудительно'},
            ]}
          />
        ) : null}
        <Btn testID="rotate" kind="signal" title="сменить IP" onPress={rotate} busy={busy === 'rotate'} disabled={!!busy} />
        <View style={{flexDirection: 'row', gap: 10}}>
          <View style={{flex: 1}}>
            <Btn small kind="ghost" title="перезагрузить" onPress={reboot} busy={busy === 'reboot'} disabled={!!busy} />
          </View>
          <View style={{flex: 1}}>
            <Btn small kind="ghost" title="о сервере" onPress={showServer} busy={busy === 'server'} disabled={!!busy} />
          </View>
        </View>
      </Card>

      <Card style={{gap: 8}}>
        <Label>состояние</Label>
        {status ? (
          <Body mono selectable>
            {status}
          </Body>
        ) : (
          <Body muted>{loading ? 'Загрузка…' : 'Нет данных'}</Body>
        )}
      </Card>

      {isAdmin ? (
        <Card style={{gap: 12}}>
          <Label>аварийный канал</Label>
          <Body mono>{emergency || (loading ? 'Загрузка…' : 'Нет данных')}</Body>
          <View style={{flexDirection: 'row', gap: 10}}>
            <Btn small kind="ghost" title="включить" onPress={() => setEmergencyMode('on')} disabled={!!busy} />
            <Btn small kind="ghost" title="выключить" onPress={() => setEmergencyMode('off')} disabled={!!busy} />
          </View>
        </Card>
      ) : null}

      <Sheet visible={!!result} onClose={() => setResult(null)} title={result?.title ?? ''}>
        <Card>
          <Body mono selectable>
            {result?.text ?? ''}
          </Body>
        </Card>
        <Btn title="закрыть" onPress={() => setResult(null)} />
      </Sheet>
    </Page>
  );
}
