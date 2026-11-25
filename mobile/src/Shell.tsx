import {useMemo, useState} from 'react';
import {Pressable, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {useAuth} from './auth';
import {Icon} from './icons';
import {NavContext} from './nav';
import {OfflineBar} from './OfflineBar';
import {HomeScreen} from './screens/HomeScreen';
import {KeysScreen} from './screens/KeysScreen';
import {SettingsScreen} from './screens/SettingsScreen';
import {StatsScreen} from './screens/StatsScreen';
import {UsersScreen} from './screens/UsersScreen';
import {ServerLogBar} from './ServerLogBar';
import {tabsFor, type TabId} from './tabs';
import {fontStyle, useTheme} from './theme';
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
  const nav = useMemo(() => ({openSettings: () => setActive('settings')}), []);

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
    <NavContext.Provider value={nav}>
      <View style={{flex: 1, backgroundColor: t.bg}}>
        <View style={{flex: 1}}>
          {tab === 'service' ? <HomeScreen /> : null}
          {tab === 'keys' ? <KeysScreen notes={notes} /> : null}
          {tab === 'stats' ? <StatsScreen /> : null}
          {tab === 'users' ? <UsersScreen /> : null}
          {tab === 'settings' ? <SettingsScreen /> : null}
        </View>

        {link !== 'ok' ? <OfflineBar link={link} busy={checking} onRetry={retry} /> : null}

        <ServerLogBar />

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
              borderRadius: t.radius.button,
              padding: 14,
              flexDirection: 'row',
              gap: 10,
              alignItems: 'center',
            }}>
            <View style={{width: 10, height: 10, borderRadius: 5, backgroundColor: t.signal}} />
            <View style={{flex: 1}}>
              <Text style={{color: t.buttonText, ...fontStyle(t, 'sans', '600'), fontSize: 15}}>{notes.banner.title}</Text>
              <Text style={{color: t.buttonText, opacity: 0.7, fontFamily: t.font.mono, fontSize: 12}}>нажмите, чтобы открыть</Text>
            </View>
          </Pressable>
        ) : null}

        <View
          accessibilityRole="tablist"
          style={{
            flexDirection: 'row',
            backgroundColor: t.surface,
            borderTopColor: t.border,
            borderTopWidth: 1,
            paddingHorizontal: 8,
            paddingBottom: insets.bottom,
          }}>
          {tabs.map(item => {
            const on = item.id === tab;
            const badge = item.id === 'keys' ? notes.unread : 0;
            const color = on ? t.signalSoft : t.muted;
            return (
              <Pressable
                key={item.id}
                testID={`tab-${item.id}`}
                accessibilityRole="button"
                accessibilityLabel={item.label}
                accessibilityState={{selected: on}}
                onPress={() => setActive(item.id)}
                style={{flex: 1, minHeight: 76, alignItems: 'center', justifyContent: 'center', gap: 6}}>
                {on ? (
                  <View
                    style={{position: 'absolute', top: 0, width: 28, height: 2, borderBottomLeftRadius: 2, borderBottomRightRadius: 2, backgroundColor: t.signal}}
                  />
                ) : null}
                <View
                  style={{
                    width: 48,
                    height: 32,
                    borderRadius: 12,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: on ? 'rgba(215, 25, 33, 0.1)' : 'transparent',
                  }}>
                  <Icon name={item.icon} size={20} color={color} knob={t.surface} />
                  {badge > 0 ? (
                    <View
                      style={{
                        position: 'absolute',
                        top: -2,
                        right: 2,
                        minWidth: 16,
                        height: 16,
                        borderRadius: 8,
                        paddingHorizontal: 4,
                        backgroundColor: t.signal,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}>
                      <Text style={{color: t.signalText, fontFamily: t.font.mono, fontSize: 10, lineHeight: 12}}>{badge}</Text>
                    </View>
                  ) : null}
                </View>
                <Text numberOfLines={1} style={{color, fontFamily: t.font.sans, fontSize: 12}}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </NavContext.Provider>
  );
}
