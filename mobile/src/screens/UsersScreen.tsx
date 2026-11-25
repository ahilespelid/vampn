import {useCallback, useEffect, useState} from 'react';
import {Alert, Pressable, View} from 'react-native';

import type {ManagedUser, Role, UserEvent} from '../api';
import {useAuth} from '../auth';
import {describeError, eventLabel, formatDate, roleLabel, sourceLabel, validEmail, validName} from '../format';
import {KeyActions} from '../KeyActions';
import {useTheme} from '../theme';
import {useReconnect} from '../useReconnect';
import {Body, Btn, Card, Empty, ErrorNote, Field, Label, Notice, Page, Pill, Segmented, Sheet} from '../ui';

function AddUser({onDone}: {onDone: () => void}) {
  const {api} = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('user');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const save = async () => {
    if (!validName(name)) {
      setError('Имя: латиница, цифры, точка, дефис, подчёркивание, до 32 знаков');
      return;
    }
    if (!validEmail(email)) {
      setError('Введите почту целиком');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const out = await api.createUser({name, email: email.trim().toLowerCase(), role});
      setNote(out.note);
      setName('');
      setEmail('');
      onDone();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{gap: 12}}>
      <Field testID="new-name" label="Имя ключа" value={name} onChangeText={setName} />
      <Field testID="new-email" label="Почта" value={email} onChangeText={setEmail} keyboardType="email-address" />
      <Segmented
        value={role}
        onChange={setRole}
        options={[
          {value: 'user', label: 'пользователь'},
          {value: 'admin', label: 'суперадмин'},
        ]}
      />
      {error ? <Notice kind="error" text={error} /> : null}
      {note ? <Notice kind="info" text={note} /> : null}
      <Btn testID="new-save" title="добавить" onPress={save} busy={busy} />
    </View>
  );
}

function UserDetail({user, onChanged}: {user: ManagedUser; onChanged: () => void}) {
  const {api} = useAuth();
  const [email, setEmail] = useState(user.email);
  const [events, setEvents] = useState<UserEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    api
      .adminEvents(user.name)
      .then(out => setEvents(out.events))
      .catch(() => undefined);
  }, [api, user.name]);

  const patch = async (body: {email?: string; role?: Role; active?: boolean}, done: string) => {
    setBusy(true);
    setError('');
    setNote('');
    try {
      await api.patchUser(user.name, body);
      setNote(done);
      onChanged();
      const out = await api.adminEvents(user.name);
      setEvents(out.events);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = () => {
    if (user.active) {
      Alert.alert(`Отозвать «${user.name}»?`, 'Доступ закроется, сессии завершатся. Запись и история останутся.', [
        {text: 'Отмена', style: 'cancel'},
        {text: 'Отозвать', style: 'destructive', onPress: () => patch({active: false}, 'Доступ отозван')},
      ]);
    } else {
      patch({active: true}, 'Доступ восстановлен');
    }
  };

  return (
    <View style={{gap: 14}}>
      <View style={{flexDirection: 'row', gap: 8, flexWrap: 'wrap'}}>
        <Pill text={roleLabel(user.role)} tone={user.role === 'admin' ? 'signal' : 'muted'} />
        <Pill text={user.active ? 'активен' : 'отозван'} tone={user.active ? 'ok' : 'muted'} />
      </View>
      {error ? <Notice kind="error" text={error} /> : null}
      {note ? <Notice kind="info" text={note} /> : null}
      <Field label="Почта" value={email} onChangeText={setEmail} keyboardType="email-address" />
      <Btn
        small
        kind="ghost"
        title="сохранить почту"
        onPress={() => (validEmail(email) ? patch({email: email.trim().toLowerCase()}, 'Почта изменена, ключ уйдёт на новый адрес') : setError('Введите почту целиком'))}
        disabled={busy || email.trim().toLowerCase() === user.email}
      />
      <Segmented
        value={user.role}
        onChange={role => (role !== user.role ? patch({role}, 'Роль изменена') : undefined)}
        options={[
          {value: 'user', label: 'пользователь'},
          {value: 'admin', label: 'суперадмин'},
        ]}
      />
      {user.active ? <KeyActions name={user.name} /> : null}
      <Btn kind={user.active ? 'signal' : 'primary'} title={user.active ? 'отозвать доступ' : 'восстановить доступ'} onPress={toggleActive} disabled={busy} />
      <Label style={{marginTop: 6}}>история</Label>
      {events.length === 0 ? <Body muted>Записей нет</Body> : null}
      {events.map(e => (
        <View key={e.id} style={{paddingVertical: 4}}>
          <Body mono>
            {eventLabel(e.event)} · {sourceLabel(e.source)}
          </Body>
          <Body muted mono>
            {formatDate(e.created_at)}
            {e.old_value || e.new_value ? ` · ${e.old_value ?? '—'} → ${e.new_value ?? '—'}` : ''}
          </Body>
        </View>
      ))}
    </View>
  );
}

/** Суперадмин: разослать ключ всем заново и посмотреть, кому и когда он ушёл. */
function MailAll({count}: {count: number}) {
  const {api} = useAuth();
  const [busy, setBusy] = useState<'' | 'send' | 'status'>('');
  const [result, setResult] = useState<{kind: 'error' | 'info'; text: string} | null>(null);
  const [report, setReport] = useState('');

  const send = () =>
    Alert.alert('Отправить ключ всем?', `Ключ получат все активные пользователи (${count}) на почту. Старые ключи продолжат работать. Это займёт до пары минут.`, [
      {text: 'Отмена', style: 'cancel'},
      {
        text: 'Отправить',
        onPress: async () => {
          setBusy('send');
          setResult(null);
          try {
            const out = await api.adminResendAll();
            setResult({kind: out.ok ? 'info' : 'error', text: out.summary || (out.ok ? 'Готово.' : 'Не всем ключ ушёл.')});
          } catch (err) {
            setResult({kind: 'error', text: describeError(err)});
          } finally {
            setBusy('');
          }
        },
      },
    ]);

  const status = async () => {
    setBusy('status');
    setResult(null);
    try {
      setReport((await api.adminMailStatus()).text);
    } catch (err) {
      setResult({kind: 'error', text: describeError(err)});
    } finally {
      setBusy('');
    }
  };

  return (
    <Card style={{gap: 10}}>
      <Label>рассылка ключей</Label>
      <View style={{flexDirection: 'row', gap: 8, flexWrap: 'wrap'}}>
        <Btn small title="ключ всем заново" onPress={send} busy={busy === 'send'} disabled={!!busy} testID="resendall" />
        <Btn small kind="ghost" title="кому ушло" onPress={status} busy={busy === 'status'} disabled={!!busy} testID="mail-status" />
      </View>
      {result ? <Notice kind={result.kind} text={result.text} /> : null}
      <Sheet visible={!!report} onClose={() => setReport('')} title="Кому ушёл ключ">
        <Card>
          <Body mono>{report}</Body>
        </Card>
      </Sheet>
    </Card>
  );
}

export function UsersScreen() {
  const t = useTheme();
  const {api} = useAuth();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setUsers((await api.adminUsers()).users);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  useReconnect(load);

  const activeTotal = users.filter(u => u.active).length;
  const needle = query.trim().toLowerCase();
  const shown = needle ? users.filter(u => u.name.toLowerCase().includes(needle) || u.email.toLowerCase().includes(needle)) : users;
  const active = shown.filter(u => u.active);
  const revoked = shown.filter(u => !u.active);
  const current = users.find(u => u.name === selected) ?? null;

  const renderUser = (u: ManagedUser) => (
    <Pressable key={u.id} onPress={() => setSelected(u.name)} accessibilityRole="button" testID={`user-${u.name}`}>
      <Card style={{flexDirection: 'row', alignItems: 'center', gap: 14, opacity: u.active ? 1 : 0.6}}>
        <View style={{width: 40, height: 40, borderRadius: 20, backgroundColor: t.surfaceAlt, alignItems: 'center', justifyContent: 'center'}}>
          <Body mono weight="700">
            {u.name.slice(0, 1).toUpperCase()}
          </Body>
        </View>
        <View style={{flex: 1, gap: 2}}>
          <Body mono weight="700">
            {u.name}
          </Body>
          <Body muted style={{fontSize: 12, lineHeight: 18}}>
            {roleLabel(u.role)} · {u.email}
          </Body>
          {!u.active ? (
            <Body muted mono style={{fontSize: 12}}>
              отозван {formatDate(u.revoked_at)}
            </Body>
          ) : null}
        </View>
        <View accessibilityLabel={u.active ? 'активен' : 'отозван'} style={{width: 8, height: 8, borderRadius: 4, backgroundColor: u.active ? t.ok : t.muted}} />
      </Card>
    </Pressable>
  );

  return (
    <Page
      title="Ваши люди."
      subtitle="Все, с кем вы делитесь доступом."
      refreshing={loading}
      onRefresh={load}
      right={<Btn small title="добавить" onPress={() => setAdding(true)} testID="add-user" />}>
      {error ? <ErrorNote text={error} /> : null}
      <Field testID="users-search" label="Найти пользователя" value={query} onChangeText={setQuery} placeholder="имя или почта" />
      <Label>
        активных · {activeTotal}
        {needle ? ` · найдено ${shown.length}` : ''}
      </Label>
      <MailAll count={activeTotal} />
      {active.map(renderUser)}
      {users.length === 0 && !loading && !error ? <Empty text="Список пуст" /> : null}
      {users.length > 0 && shown.length === 0 ? <Empty text="Никого не нашлось" /> : null}
      {revoked.length > 0 ? <Label>отозванные · {revoked.length}</Label> : null}
      {revoked.map(renderUser)}

      <Sheet visible={adding} onClose={() => setAdding(false)} title="Новый пользователь">
        <AddUser onDone={load} />
      </Sheet>
      <Sheet visible={!!current} onClose={() => setSelected(null)} title={current?.name ?? ''}>
        {current ? <UserDetail key={current.name + current.active} user={current} onChanged={load} /> : null}
      </Sheet>
    </Page>
  );
}
