import {useCallback, useEffect, useState} from 'react';
import {Pressable, View} from 'react-native';

import type {KeyRecord} from '../api';
import {useAuth} from '../auth';
import {describeError, formatDate, keyReasonLabel, notificationStatus} from '../format';
import {KeyActions} from '../KeyActions';
import type {NotificationsState} from '../useNotifications';
import {Body, Card, Empty, Label, Notice, Page, Pill, Segmented} from '../ui';

export function KeysScreen({notes}: {notes: NotificationsState}) {
  const {api, user} = useAuth();
  const isAdmin = user?.role === 'admin';
  const [keys, setKeys] = useState<KeyRecord[]>([]);
  const [scope, setScope] = useState<'own' | 'all'>('own');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [list] = await Promise.all([api.keys(isAdmin && scope === 'all'), notes.refresh()]);
      setKeys(list.keys);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
    // notes.refresh стабилен, пока не меняется клиент API
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, isAdmin, scope]);

  useEffect(() => {
    load();
  }, [load]);

  const accounts = user?.accounts ?? [];

  return (
    <Page title="ключи" refreshing={loading} onRefresh={load}>
      {error ? <Notice kind="error" text={error} /> : null}

      <Label>мои ключи</Label>
      {accounts.map(account => (
        <Card key={account.name} style={{gap: 12}}>
          <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}}>
            <Body mono style={{fontWeight: '700'}}>
              {account.name}
            </Body>
            {account.role === 'admin' ? <Pill text="суперадмин" tone="signal" /> : null}
          </View>
          <KeyActions name={account.name} onChanged={load} />
        </Card>
      ))}

      <Label style={{marginTop: 8}}>уведомления{notes.unread > 0 ? ` · новых ${notes.unread}` : ''}</Label>
      {notes.items.length === 0 ? <Empty text="Пока ничего нет" /> : null}
      {notes.items.map(n => {
        const status = notificationStatus(n);
        return (
          <Pressable key={n.id} onPress={() => (n.read_at ? undefined : notes.markRead(n.id).catch(() => undefined))} accessibilityRole="button">
            <Card style={{gap: 10, borderColor: n.read_at ? undefined : '#d71921'}}>
              <View style={{flexDirection: 'row', justifyContent: 'space-between', gap: 8}}>
                <Body style={{fontWeight: '600', flexShrink: 1}}>{n.title}</Body>
                <Pill text={status.label} tone={status.tone} />
              </View>
              <Body muted mono>
                {n.user_name} · {formatDate(n.created_at)}
              </Body>
              {n.kind === 'key' ? (
                <KeyActions
                  name={n.user_name}
                  notificationId={n.id}
                  only="link"
                  onChanged={() => {
                    notes.markRead(n.id).catch(() => undefined);
                  }}
                />
              ) : null}
            </Card>
          </Pressable>
        );
      })}

      <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8}}>
        <Label>история выдачи</Label>
      </View>
      {isAdmin ? (
        <Segmented
          value={scope}
          onChange={setScope}
          options={[
            {value: 'own', label: 'мои'},
            {value: 'all', label: 'все'},
          ]}
        />
      ) : null}
      {keys.length === 0 ? <Empty text="Выдач ещё не было" /> : null}
      {keys.map(k => (
        <Card key={k.id} style={{gap: 4}}>
          <View style={{flexDirection: 'row', justifyContent: 'space-between'}}>
            <Body mono style={{fontWeight: '700'}}>
              {k.user_name}
            </Body>
            <Body muted mono>
              {keyReasonLabel(k.reason)}
            </Body>
          </View>
          <Body muted mono>
            {formatDate(k.issued_at)}
            {k.issued_by ? ` · ${k.issued_by}` : ''}
          </Body>
        </Card>
      ))}
    </Page>
  );
}
