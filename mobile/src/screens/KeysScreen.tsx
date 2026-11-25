import {useCallback, useEffect, useState} from 'react';
import {Pressable, View} from 'react-native';

import type {KeyRecord} from '../api';
import {useAuth} from '../auth';
import {describeError, formatDate, keyReasonLabel, notificationStatus} from '../format';
import {KeyActions} from '../KeyActions';
import {useTheme} from '../theme';
import type {NotificationsState} from '../useNotifications';
import {useReconnect} from '../useReconnect';
import {Body, Card, Empty, ErrorNote, Label, Page, Pill, Segmented} from '../ui';

export function KeysScreen({notes}: {notes: NotificationsState}) {
  const t = useTheme();
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

  useReconnect(load);

  const accounts = user?.accounts ?? [];

  return (
    <Page title="Ключи доступа." subtitle="Доступ к свободному интернету." refreshing={loading} onRefresh={load}>
      {error ? <ErrorNote text={error} /> : null}

      <View style={{gap: 12}}>
        <Label>мои ключи</Label>
        {accounts.map(account => (
          <Card key={account.name} style={{gap: 16}}>
            <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}}>
              <Body mono weight="700">
                {account.name}
              </Body>
              {account.role === 'admin' ? <Pill text="суперадмин" tone="signal" /> : null}
            </View>
            <KeyActions name={account.name} onChanged={load} />
          </Card>
        ))}
      </View>

      <View style={{gap: 12}}>
        <Label>уведомления{notes.unread > 0 ? ` · новых ${notes.unread}` : ''}</Label>
        {notes.items.length === 0 ? (
          <Card>
            <Empty text="Пока ничего нет" />
          </Card>
        ) : null}
        {notes.items.map(n => {
          const status = notificationStatus(n);
          return (
            <Pressable key={n.id} onPress={() => (n.read_at ? undefined : notes.markRead(n.id).catch(() => undefined))} accessibilityRole="button">
              <Card style={{gap: 12, borderColor: n.read_at ? t.border : t.signal}}>
                <View style={{flexDirection: 'row', justifyContent: 'space-between', gap: 8}}>
                  <Body weight="600" style={{flexShrink: 1}}>
                    {n.title}
                  </Body>
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
      </View>

      <View style={{gap: 12}}>
        <Label>история выдачи</Label>
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
        {keys.length === 0 && !error ? <Empty text="Выдач ещё не было" /> : null}
        {keys.map(k => (
          <Card key={k.id} style={{gap: 4}}>
            <View style={{flexDirection: 'row', justifyContent: 'space-between'}}>
              <Body mono weight="700">
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
      </View>
    </Page>
  );
}
