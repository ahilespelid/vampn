import {Alert, View} from 'react-native';

import {useAuth} from '../auth';
import {roleLabel} from '../format';
import {ServerUrlEditor} from '../ServerUrlEditor';
import type {ThemeMode} from '../theme';
import {Body, Btn, Card, KV, Label, Page, Pill, Segmented} from '../ui';

export function SettingsScreen() {
  const auth = useAuth();
  const user = auth.user;

  const logout = () =>
    Alert.alert('Выйти из аккаунта?', 'Чтобы войти снова, понадобится новый код на почту.', [
      {text: 'Отмена', style: 'cancel'},
      {text: 'Выйти', style: 'destructive', onPress: () => auth.signOut()},
    ]);

  return (
    <Page title="На вашей стороне." subtitle="Аккаунт, оформление и подключение.">
      <Card style={{gap: 10}}>
        <Label>аккаунт</Label>
        <Body mono>{user?.email}</Body>
        <View style={{flexDirection: 'row'}}>
          <Pill text={roleLabel(user?.role ?? 'user')} tone={user?.role === 'admin' ? 'signal' : 'muted'} />
        </View>
        {user && user.accounts.length > 0 ? (
          <View style={{marginTop: 4}}>
            {user.accounts.map(a => (
              <KV key={a.name} k="ключ" v={a.name} mono />
            ))}
          </View>
        ) : null}
      </Card>

      <Card style={{gap: 12}}>
        <Label>оформление</Label>
        <Segmented<ThemeMode>
          value={auth.themeMode}
          onChange={auth.setThemeMode}
          options={[
            {value: 'auto', label: 'как в системе'},
            {value: 'light', label: 'светлая'},
            {value: 'dark', label: 'тёмная'},
          ]}
        />
      </Card>

      <Card style={{gap: 12}}>
        <Label>сервер</Label>
        <Body muted>При смене адреса вы выйдете из аккаунта: вход выполняется на выбранном сервере.</Body>
        <ServerUrlEditor />
      </Card>

      <Btn testID="logout" kind="ghost" title="выйти" onPress={logout} />
    </Page>
  );
}
