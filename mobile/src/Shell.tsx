import {useState} from 'react';
import {Pressable, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {useAuth} from './auth';
import {OfflineBar} from './OfflineBar';
import {HomeScreen} from './screens/HomeScreen';
import {KeysScreen} from './screens/KeysScreen';
import {SettingsScreen} from './screens/SettingsScreen';
import {StatsScreen} from './screens/StatsScreen';
import {UsersScreen} from './screens/UsersScreen';
import {tabsFor, type TabId} from './tabs';
import {useTheme} from './theme';
import {useNotifications} from './useNotifications';

export function Shell() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const {api, user, link, checkLink} = useAuth();
  const tabs = tabsFor(user?.role ?? 'user');
  const [active, setActive] = useState<TabId>('service');
  const [checking, setChecking] = useState(false);
  const notes = useNotifications(api, true);
  const tab = tabs.some(item => item.id === active) ? active : 'service';

  // «Повторить»: запрос к серверу; если связь вернулась, экраны сами загрузят данные заново.
  const retry = async () => {
    setChecking(true);
    try {
      await checkLink();
    } finally {
      setChecking(false);
    }
  };

  return (
    <View style={{flex: 1, backgroundColor: t.bg}}>
      <View style={{flex: 1}}>
        {tab === 'service' ? <HomeScreen /> : null}
        {tab === 'keys' ? <KeysScreen notes={notes} /> : null}
        {tab === 'stats' ? <StatsScreen /> : null}
        {tab === 'users' ? <UsersScreen /> : null}
        {tab === 'settings' ? <SettingsScreen /> : null}
      </View>

      {link !== 'ok' ? <OfflineBar link={link} busy={checking} onRetry={retry} /> : null}

      {notes.banner ? (
        <Pressable
          testID="banner"
          accessibilityRole="button"
          onPress={() => {
            notes.dismissBanner();
            setActive('keys');
          }}
          style={{
            position: 'absolute',
            left: 16,
            right: 16,
            top: insets.top + 8,
            backgroundColor: t.button,
            borderRadius: t.radius.m,
            padding: 14,
            flexDirection: 'row',
            gap: 10,
            alignItems: 'center',
          }}>
          <View style={{width: 10, height: 10, borderRadius: 5, backgroundColor: t.signal}} />
          <View style={{flex: 1}}>
            <Text style={{color: t.buttonText, fontFamily: t.font.sans, fontSize: 15, fontWeight: '600'}}>{notes.banner.title}</Text>
            <Text style={{color: t.buttonText, opacity: 0.7, fontFamily: t.font.mono, fontSize: 12}}>нажмите, чтобы открыть</Text>
          </View>
        </Pressable>
      ) : null}

      <View
        style={{
          flexDirection: 'row',
          backgroundColor: t.surface,
          borderTopColor: t.border,
          borderTopWidth: 1,
          paddingBottom: insets.bottom,
        }}>
        {tabs.map(item => {
          const on = item.id === tab;
          const badge = item.id === 'keys' ? notes.unread : 0;
          return (
            <Pressable
              key={item.id}
              testID={`tab-${item.id}`}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              onPress={() => setActive(item.id)}
              style={{flex: 1, alignItems: 'center', paddingVertical: 12, gap: 5}}>
              <View style={{width: 6, height: 6, borderRadius: 3, backgroundColor: on ? t.signal : 'transparent'}} />
              <Text style={{color: on ? t.text : t.muted, fontFamily: t.font.mono, fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase'}}>
                {item.label}
                {badge > 0 ? ` ${badge}` : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
