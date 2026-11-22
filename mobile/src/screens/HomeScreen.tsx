import {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {
  buttonLabel,
  pressPlan,
  showsOfflineStatus,
  type NetState,
} from '../buttonState';
import {runSsh} from '../ssh';
import {loadConfig} from '../storage';
import {pingTelegram} from '../telegram';

type Props = {
  onOpenSettings: () => void;
};

export function HomeScreen({onOpenSettings}: Props) {
  const insets = useSafeAreaInsets();
  const [net, setNet] = useState<NetState>('unknown');
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState('');

  const refresh = useCallback(async (notify: boolean) => {
    const config = await loadConfig();
    const online = await pingTelegram(config, {notify});
    setNet(online ? 'online' : 'offline');
    return {config, online};
  }, []);

  useEffect(() => {
    let active = true;
    refresh(false).catch(() => {
      if (active) {
        setNet('offline');
      }
    });
    return () => {
      active = false;
    };
  }, [refresh]);

  const onPress = async () => {
    if (busy) {
      return;
    }
    const plan = pressPlan(net);
    setBusy(true);
    setDetail('');
    try {
      const config = await loadConfig();
      if (plan === 'reset-ip') {
        const output = await runSsh(config, 'reset');
        setDetail(output);
        const online = await pingTelegram(config, {notify: false});
        setNet(online ? 'online' : 'offline');
        return;
      }

      const online = await pingTelegram(config, {notify: true});
      setNet(online ? 'online' : 'offline');
      if (!online) {
        setDetail('нет интернет');
        return;
      }
      const output = await runSsh(config, 'normal');
      setDetail(output);
    } catch (error) {
      setDetail(error instanceof Error ? error.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  const label = buttonLabel(net, busy);
  const offline = showsOfflineStatus(net, busy);

  return (
    <View style={[styles.screen, {paddingTop: insets.top, paddingBottom: insets.bottom}]}>
      <Pressable
        style={[styles.settings, {top: insets.top + 16}]}
        onPress={onOpenSettings}
        hitSlop={12}>
        <Text style={styles.settingsText}>настройки</Text>
      </Pressable>
      <View style={styles.center}>
        <Text style={styles.wordmark}>vampn</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={offline ? 'нет интернет' : label}
          onPress={onPress}
          style={[styles.button, offline ? styles.buttonOffline : styles.buttonOnline]}>
          {busy ? <ActivityIndicator color="#f4efe8" /> : null}
          <Text style={styles.buttonText}>{label}</Text>
        </Pressable>
        {offline ? <Text style={styles.status}>нет интернет</Text> : null}
        {detail ? (
          <ScrollView style={styles.log} contentContainerStyle={styles.logContent}>
            <Text selectable style={styles.logText}>
              {detail}
            </Text>
          </ScrollView>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0e0d12',
  },
  settings: {
    position: 'absolute',
    right: 20,
    zIndex: 2,
  },
  settingsText: {
    color: '#d7c7b8',
    fontSize: 16,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  wordmark: {
    color: '#8d8794',
    letterSpacing: 4,
    marginBottom: 28,
    fontSize: 14,
  },
  button: {
    width: 280,
    height: 280,
    borderRadius: 140,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  buttonOnline: {
    backgroundColor: '#9d2b3a',
  },
  buttonOffline: {
    backgroundColor: '#c47b2b',
  },
  buttonText: {
    color: '#f4efe8',
    fontSize: 28,
    textAlign: 'center',
    marginTop: 8,
  },
  status: {
    color: '#f4efe8',
    marginTop: 22,
    fontSize: 18,
  },
  log: {
    maxHeight: 160,
    marginTop: 18,
    alignSelf: 'stretch',
  },
  logContent: {
    paddingBottom: 8,
  },
  logText: {
    color: '#d7c7b8',
    fontSize: 13,
    fontFamily: 'monospace',
  },
});
