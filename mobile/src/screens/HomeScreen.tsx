import {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {
  actionLabel,
  buttonLabel,
  showsOfflineStatus,
  type ActionMode,
  type NetState,
} from '../buttonState';
import {callAgent} from '../agent';
import {loadConfig, saveConfig} from '../storage';
import {pingTelegram} from '../telegram';

type Props = {
  onOpenSettings: () => void;
};

function commandOutput(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as {output?: unknown};
    if (typeof parsed.output === 'string' && parsed.output.length > 0) {
      return parsed.output;
    }
  } catch {
    // The agent can also return plain text.
  }
  return raw;
}

export function HomeScreen({onOpenSettings}: Props) {
  const insets = useSafeAreaInsets();
  const [net, setNet] = useState<NetState>('unknown');
  const [mode, setMode] = useState<ActionMode>('rotate');
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState('');
  const [resultOpen, setResultOpen] = useState(false);
  const [resultText, setResultText] = useState('');

  const refresh = useCallback(async (notify: boolean) => {
    const config = await loadConfig();
    const online = await pingTelegram(config, {notify});
    setNet(online ? 'online' : 'offline');
    return {config, online};
  }, []);

  useEffect(() => {
    let active = true;
    refresh(false)
      .then(result => {
        if (active && result) {
          setMode(result.config.actionMode === 'force' ? 'force' : 'rotate');
        }
      })
      .catch(() => {
        if (active) {
          setNet('offline');
        }
      });
    return () => {
      active = false;
    };
  }, [refresh]);

  const chooseMode = async (next: ActionMode) => {
    setMode(next);
    const config = await loadConfig();
    await saveConfig({...config, actionMode: next});
  };

  const onPress = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    setDetail('');
    try {
      const config = await loadConfig();
      const online = await pingTelegram(config, {notify: mode !== 'force'});
      setNet(online ? 'online' : 'offline');
      const output = await callAgent({...config, actionMode: mode}, mode);
      setDetail(output);
      setResultText(commandOutput(output));
      setResultOpen(true);
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
        <View style={styles.modes}>
          {(['rotate', 'force'] as ActionMode[]).map(item => {
            const selected = mode === item;
            return (
              <Pressable
                key={item}
                onPress={() => chooseMode(item)}
                style={[styles.mode, selected ? styles.modeSelected : null]}>
                <Text style={styles.modeText}>{actionLabel(item)}</Text>
              </Pressable>
            );
          })}
        </View>
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
      <Modal
        visible={resultOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setResultOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Результат</Text>
            <ScrollView style={styles.modalScroll}>
              <Text selectable style={styles.modalText}>
                {resultText}
              </Text>
            </ScrollView>
            <Pressable style={styles.modalClose} onPress={() => setResultOpen(false)}>
              <Text style={styles.modalCloseText}>Закрыть</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
    marginBottom: 18,
    fontSize: 14,
  },
  modes: {
    flexDirection: 'row',
    marginBottom: 22,
  },
  mode: {
    borderWidth: 1,
    borderColor: '#3a3440',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginHorizontal: 6,
  },
  modeSelected: {
    backgroundColor: '#9d2b3a',
    borderColor: '#9d2b3a',
  },
  modeText: {
    color: '#f4efe8',
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: '#1a1720',
    borderRadius: 16,
    padding: 16,
    maxHeight: '70%',
  },
  modalTitle: {
    color: '#f4efe8',
    fontSize: 18,
    marginBottom: 12,
  },
  modalScroll: {
    maxHeight: 280,
  },
  modalText: {
    color: '#d7c7b8',
    fontSize: 13,
    fontFamily: 'monospace',
  },
  modalClose: {
    marginTop: 14,
    backgroundColor: '#9d2b3a',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalCloseText: {
    color: '#f4efe8',
    fontSize: 16,
  },
});
