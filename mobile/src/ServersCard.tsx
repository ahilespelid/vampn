import {useCallback, useEffect, useRef, useState} from 'react';
import {Alert, Linking, Pressable, Text, View} from 'react-native';

import {ApiError} from './api';
import type {Cell, SpawnStatus, TimewebAccount} from './api';
import {useAuth} from './auth';
import {describeError} from './format';
import {cellFree, cellTone, spawnBusy, spawnTitle, SPAWN_POLL_MS, TIMEWEB_TOKENS_URL, validAccountName, validTimewebToken} from './servers';
import {fontStyle, useTheme} from './theme';
import {Body, Btn, Card, Field, IconBadge, Label, Notice, Pill, Sheet} from './ui';
import {useReconnect} from './useReconnect';

/** Текст ошибки для админских действий: причину, которую назвал сервер (vampn), показываем как есть, она без секретов. */
function adminError(err: unknown): string {
  if (err instanceof ApiError && err.code === 'command_failed' && err.message) {
    return err.message;
  }
  return describeError(err);
}

function AccountsSheet({visible, onClose, onChanged}: {visible: boolean; onClose: () => void; onChanged: () => void}) {
  const {api} = useAuth();
  const [accounts, setAccounts] = useState<TimewebAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setAccounts((await api.adminAccounts()).accounts);
    } catch (err) {
      setError(adminError(err));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (visible) {
      setError('');
      setNote('');
      load();
    } else {
      setToken(''); // токен не хранится дольше, чем открыт экран
    }
  }, [visible, load]);

  const run = async (id: string, job: () => Promise<{text: string}>, after?: () => void) => {
    setBusy(id);
    setError('');
    setNote('');
    try {
      const out = await job();
      setNote(out.text.trim());
      after?.();
      await load();
      onChanged();
    } catch (err) {
      setError(adminError(err));
    } finally {
      setBusy('');
    }
  };

  const add = () => {
    const cleanName = name.trim();
    if (!validAccountName(cleanName)) {
      setError('Имя кабинета: латиница в нижнем регистре, цифры, _ и -, до 24 знаков. main и spare заняты.');
      return;
    }
    if (!validTimewebToken(token)) {
      setError('Это не похоже на токен Timeweb: он длинный, из букв, цифр и точек. Скопируйте его целиком.');
      return;
    }
    run('add', () => api.adminAddAccount(cleanName, token.trim()), () => {
      setName('');
      setToken('');
    });
  };

  const remove = (a: TimewebAccount) =>
    Alert.alert(`Убрать кабинет «${a.name}»?`, 'Токен будет удалён с сервера. Серверы в Timeweb останутся. Если кабинетом пользуется ячейка, сервер откажет.', [
      {text: 'Отмена', style: 'cancel'},
      {text: 'Убрать', style: 'destructive', onPress: () => run('del-' + a.name, () => api.adminDeleteAccount(a.name))},
    ]);

  return (
    <Sheet visible={visible} onClose={onClose} title="Кабинеты Timeweb">
      <View style={{gap: 14}}>
        {error ? <Notice kind="error" text={error} /> : null}
        {note ? <Notice kind="info" text={note} /> : null}
        {accounts.length === 0 && !loading ? <Body muted>Кабинетов пока нет.</Body> : null}
        {accounts.map(a => (
          <Card key={a.name} style={{gap: 8}}>
            <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8}}>
              <Body mono weight="700">
                {a.name}
              </Body>
              <View style={{flexDirection: 'row', gap: 6}}>
                {a.default ? <Pill text="по умолчанию" tone="signal" /> : null}
                <Pill text={a.status === 'ok' ? 'токен принят' : a.status === 'denied' ? 'токен отклонён' : 'нет токена'} tone={a.status === 'ok' ? 'ok' : 'signal'} />
              </View>
            </View>
            {a.balance !== null ? (
              <Body muted mono>
                баланс {a.balance} {a.currency ?? ''}
              </Body>
            ) : null}
            {a.message ? <Body muted>{a.message}</Body> : null}
            <View style={{flexDirection: 'row', gap: 8, flexWrap: 'wrap'}}>
              {!a.default ? (
                <Btn small kind="ghost" title="по умолчанию" testID={`acct-default-${a.name}`} onPress={() => run('def-' + a.name, () => api.adminDefaultAccount(a.name))} busy={busy === 'def-' + a.name} disabled={!!busy} />
              ) : null}
              {a.name !== 'main' && a.name !== 'spare' ? (
                <Btn small kind="ghost" title="убрать" testID={`acct-del-${a.name}`} onPress={() => remove(a)} busy={busy === 'del-' + a.name} disabled={!!busy} />
              ) : null}
            </View>
          </Card>
        ))}

        <Label>добавить кабинет</Label>
        <Body muted>
          В Timeweb откройте «API и Terraform», создайте токен (права на серверы и ключи ssh; чтобы приложение могло и удалять серверы, отметьте право на удаление), скопируйте его и вставьте ниже. Логин и пароль Timeweb приложению не нужны: их оно не спрашивает и нигде не хранит.
        </Body>
        <Btn small kind="ghost" arrow title="открыть страницу токенов Timeweb" testID="open-timeweb" onPress={() => Linking.openURL(TIMEWEB_TOKENS_URL)} />
        <Field testID="acct-name" label="Имя кабинета (для себя)" value={name} onChangeText={setName} placeholder="например second" />
        <Field testID="acct-token" label="Токен API Timeweb" value={token} onChangeText={setToken} secureTextEntry placeholder="вставьте токен" />
        <Btn testID="acct-add" title="добавить кабинет" onPress={add} busy={busy === 'add'} disabled={!!busy} />
      </View>
    </Sheet>
  );
}

/** Суперадмин: серверы (ячейки), кнопка «развернуть новый сервер» и кабинеты Timeweb. */
export function ServersCard() {
  const t = useTheme();
  const {api} = useAuth();
  const [cells, setCells] = useState<Cell[]>([]);
  const [spawn, setSpawn] = useState<SpawnStatus | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [accountsOpen, setAccountsOpen] = useState(false);
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const [c, s] = await Promise.all([api.adminCells(), api.adminSpawnStatus()]);
      if (alive.current) {
        setCells(c.cells);
        setSpawn(s);
        setError('');
      }
    } catch (err) {
      if (alive.current) {
        setError(adminError(err));
      }
    }
  }, [api]);

  useEffect(() => {
    alive.current = true;
    load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  useReconnect(load);

  // Пока идёт развёртывание, обновляем ход каждые несколько секунд.
  const running = spawnBusy(spawn?.state);
  useEffect(() => {
    if (!running) {
      return undefined;
    }
    const timer = setInterval(load, SPAWN_POLL_MS);
    return () => clearInterval(timer);
  }, [running, load]);

  const deploy = () =>
    Alert.alert(
      'Развернуть новый сервер?',
      'В Timeweb будет арендован новый сервер (Амстердам, самый дешёвый тариф, Debian) с именем vampn_N, и на нём развернётся VPN. Это платно, ограничения по сумме нет. Займёт несколько минут. Ваши текущие ключи не меняются.',
      [
        {text: 'Отмена', style: 'cancel'},
        {
          text: 'Арендовать',
          style: 'destructive',
          onPress: async () => {
            setBusy('spawn');
            setError('');
            try {
              await api.adminSpawn();
              await load();
            } catch (err) {
              setError(adminError(err));
            } finally {
              setBusy('');
            }
          },
        },
      ],
    );

  const removeCell = (cell: Cell) =>
    Alert.alert(
      `Удалить ячейку «${cell.name}»?`,
      `Сервер ${cell.ip ?? ''} в Timeweb будет удалён вместе с ячейкой, это нельзя отменить. Пока в ячейке есть пользователи (сейчас ${cell.users}), сервер откажет.`,
      [
        {text: 'Отмена', style: 'cancel'},
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: async () => {
            setBusy('cell-' + cell.cell);
            setError('');
            try {
              await api.adminDeleteCell(cell.cell);
              await load();
            } catch (err) {
              setError(adminError(err));
            } finally {
              setBusy('');
            }
          },
        },
      ],
    );

  const title = spawnTitle(spawn);
  const failed = spawn?.state === 'failed';

  return (
    <Card style={{gap: 14}}>
      <View style={{flexDirection: 'row', alignItems: 'center', gap: 12}}>
        <IconBadge name="shield" tone="signal" />
        <View style={{flex: 1}}>
          <Text style={{color: t.text, ...fontStyle(t, 'sans', '600'), fontSize: 16, lineHeight: 22}}>Серверы</Text>
          <Label style={{marginTop: 2}}>ячейки · до 1000 человек на сервер</Label>
        </View>
      </View>

      {error ? <Notice kind="error" text={error} /> : null}

      {cells.map((c, index) => (
        <Pressable
          key={c.cell}
          testID={`cell-${c.cell}`}
          accessibilityRole="button"
          accessibilityLabel={`ячейка ${c.name}`}
          onPress={c.cell >= 2 ? () => removeCell(c) : undefined}
          style={{gap: 4, paddingTop: index ? 14 : 0, borderTopWidth: index ? 1 : 0, borderTopColor: t.border}}>
          <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8}}>
            <Body weight="700">{c.name}</Body>
            <Pill text={c.state} tone={cellTone(c.state)} />
          </View>
          <Body mono muted style={{fontSize: 13, lineHeight: 19}}>
            {c.ip ?? 'IP ещё нет'} · людей {c.users} из {c.limit}
            {c.handshake ? ` · связь ${c.handshake} назад` : ''}
          </Body>
          {cellFree(c) === 0 ? (
            <Body muted style={{fontSize: 12, lineHeight: 18}}>
              ячейка заполнена
            </Body>
          ) : null}
          {c.cell >= 2 ? (
            <Body muted style={{fontSize: 12, lineHeight: 18}}>
              нажмите, чтобы удалить ячейку
            </Body>
          ) : null}
        </Pressable>
      ))}

      {title ? (
        <View testID="spawn-status" style={{gap: 6, paddingTop: 14, borderTopWidth: 1, borderTopColor: t.border}}>
          <Notice kind={failed ? 'error' : 'info'} text={title} />
          {spawn && spawn.log.length > 0 ? (
            <Body mono muted selectable style={{fontSize: 12, lineHeight: 18}}>
              {spawn.log.slice(-6).join('\n')}
            </Body>
          ) : null}
        </View>
      ) : null}

      <Btn
        testID="spawn"
        kind="signal"
        icon="zap"
        arrow
        title={running ? 'Разворачиваю сервер…' : busy === 'spawn' ? 'Запускаю…' : 'Развернуть новый сервер'}
        onPress={deploy}
        busy={running || busy === 'spawn'}
        disabled={!!busy || running}
      />
      <Btn testID="accounts" kind="ghost" arrow title="кабинеты Timeweb" onPress={() => setAccountsOpen(true)} />
      <Body muted>Новому серверу нужен кабинет Timeweb с токеном. Сервер арендуется в Амстердаме по самому дешёвому тарифу.</Body>

      <AccountsSheet visible={accountsOpen} onClose={() => setAccountsOpen(false)} onChanged={load} />
    </Card>
  );
}
