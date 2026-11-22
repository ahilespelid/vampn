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
import type {AppTheme} from '../theme';

type Props = {
  theme: AppTheme;
  onOpenSettings: () => void;
  onToggleTheme: () => void;
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

export function HomeScreen({theme, onOpenSettings, onToggleTheme}: Props) {
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
    <View
      style={[
        styles.screen,
        {backgroundColor: theme.background, paddingTop: insets.top, paddingBottom: insets.bottom},
      ]}>
      <View style={styles.topBar}>
        <Pressable
          onPress={onToggleTheme}
          style={[styles.invert, {backgroundColor: theme.button}]}
          hitSlop={8}>
          <Text style={[styles.invertText, {color: theme.buttonText}]}>инверсия</Text>
        </Pressable>
        <Pressable onPress={onOpenSettings} hitSlop={12}>
          <Text style={[styles.settingsText, {color: theme.muted}]}>настройки</Text>
        </Pressable>
      </View>
      <View style={styles.center}>
        <Text style={[styles.wordmark, {color: theme.text}]}>vampn</Text>
        <View style={[styles.modes, {backgroundColor: theme.surface, borderColor: theme.border}]}>
          {(['rotate', 'force'] as ActionMode[]).map(item => {
            const selected = mode === item;
            return (
              <Pressable
                key={item}
                onPress={() => chooseMode(item)}
                style={[
                  styles.mode,
                  {
                    backgroundColor: selected ? theme.button : 'transparent',
                  },
                ]}>
                <Text style={[styles.modeText, {color: selected ? theme.buttonText : theme.text}]}>
                  {actionLabel(item)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={offline ? 'нет интернет' : label}
          onPress={onPress}
          style={[
            styles.button,
            {backgroundColor: offline ? theme.accent : theme.button},
          ]}>
          {busy ? <ActivityIndicator color={theme.buttonText} /> : null}
          <Text style={[styles.buttonText, {color: theme.buttonText}]}>{label}</Text>
        </Pressable>
        {offline ? (
          <Text style={[styles.status, {color: theme.accent}]}>нет интернет</Text>
        ) : null}
        {detail ? (
          <ScrollView
            style={[styles.log, {backgroundColor: theme.surface, borderColor: theme.border}]}
            contentContainerStyle={styles.logContent}>
            <Text selectable style={[styles.logText, {color: theme.muted}]}>
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
        <View style={[styles.modalBackdrop, {backgroundColor: theme.backdrop}]}>
          <View style={[styles.modalCard, {backgroundColor: theme.surface}]}>
            <Text style={[styles.modalTitle, {color: theme.text}]}>Результат</Text>
            <ScrollView style={styles.modalScroll}>
              <Text selectable style={[styles.modalText, {color: theme.muted}]}>
                {resultText}
              </Text>
            </ScrollView>
            <Pressable
              style={[styles.modalClose, {backgroundColor: theme.button}]}
              onPress={() => setResultOpen(false)}>
              <Text style={[styles.modalCloseText, {color: theme.buttonText}]}>Закрыть</Text>
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
    paddingHorizontal: 20,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  invert: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  invertText: {
    fontSize: 14,
    fontWeight: '600',
  },
  settingsText: {
    fontSize: 15,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: {
    fontSize: 40,
    fontWeight: '700',
    marginBottom: 22,
  },
  modes: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: 999,
    padding: 4,
    marginBottom: 28,
  },
  mode: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  modeText: {
    fontSize: 14,
    fontWeight: '600',
  },
  button: {
    width: 280,
    minHeight: 92,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 22,
  },
  buttonText: {
    fontSize: 26,
    fontWeight: '700',
    textAlign: 'center',
  },
  status: {
    marginTop: 18,
    fontSize: 16,
    fontWeight: '600',
  },
  log: {
    maxHeight: 140,
    marginTop: 18,
    alignSelf: 'stretch',
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  logContent: {
    paddingBottom: 4,
  },
  logText: {
    fontSize: 13,
    fontFamily: 'monospace',
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    borderRadius: 20,
    padding: 16,
    maxHeight: '70%',
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 12,
  },
  modalScroll: {
    maxHeight: 280,
  },
  modalText: {
    fontSize: 13,
    fontFamily: 'monospace',
  },
  modalClose: {
    marginTop: 14,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalCloseText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
