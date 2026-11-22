import {useEffect, useState} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {loadConfig, saveConfig} from '../storage';
import type {AppTheme} from '../theme';
import {defaultConfig, type VampnConfig} from '../types';

type Props = {
  theme: AppTheme;
  onClose: () => void;
};

type FieldProps = {
  theme: AppTheme;
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  secure?: boolean;
  multiline?: boolean;
  keyboard?: 'default' | 'numeric';
};

function Field({
  theme,
  label,
  value,
  onChangeText,
  secure,
  multiline,
  keyboard,
}: FieldProps) {
  return (
    <View style={styles.field}>
      <Text style={[styles.label, {color: theme.muted}]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secure}
        multiline={multiline}
        keyboardType={keyboard ?? 'default'}
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor={theme.muted}
        style={[
          styles.input,
          {
            color: theme.text,
            backgroundColor: theme.surface,
            borderColor: theme.border,
          },
          multiline ? styles.inputMultiline : null,
        ]}
      />
    </View>
  );
}

export function SettingsScreen({theme, onClose}: Props) {
  const insets = useSafeAreaInsets();
  const [config, setConfig] = useState<VampnConfig>(defaultConfig);

  useEffect(() => {
    let active = true;
    loadConfig().then(value => {
      if (active) {
        setConfig(value);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const set =
    (key: keyof VampnConfig) =>
    (value: string) => {
      setConfig(current => ({...current, [key]: value}));
    };

  const onSave = async () => {
    await saveConfig(config);
    onClose();
  };

  return (
    <View
      style={[
        styles.screen,
        {backgroundColor: theme.background, paddingTop: insets.top + 12},
      ]}>
      <View style={styles.top}>
        <Pressable onPress={onClose} hitSlop={12}>
          <Text style={[styles.back, {color: theme.muted}]}>назад</Text>
        </Pressable>
        <Text style={[styles.title, {color: theme.text}]}>настройки</Text>
      </View>
      <ScrollView
        contentContainerStyle={{paddingBottom: insets.bottom + 28}}
        keyboardShouldPersistTaps="handled">
        <Field theme={theme} label="Хост" value={config.host} onChangeText={set('host')} />
        <Field theme={theme}
          label="Порт"
          value={config.port}
          onChangeText={set('port')}
          keyboard="numeric"
        />
        <Field theme={theme}
          label="Пользователь"
          value={config.username}
          onChangeText={set('username')}
        />
        <Field theme={theme}
          label="Пароль"
          value={config.password}
          onChangeText={set('password')}
          secure
        />
        <Field theme={theme}
          label="Приватный ключ"
          value={config.privateKey}
          onChangeText={set('privateKey')}
          multiline
        />
        <Field theme={theme}
          label="Пароль ключа"
          value={config.passphrase}
          onChangeText={set('passphrase')}
          secure
        />
        <Field theme={theme}
          label="Команды SSH"
          value={config.commands}
          onChangeText={set('commands')}
          multiline
        />
        <Field theme={theme}
          label="Команды сброса IP"
          value={config.resetCommands}
          onChangeText={set('resetCommands')}
          multiline
        />
        <Field theme={theme}
          label="Telegram bot token"
          value={config.telegramBotToken}
          onChangeText={set('telegramBotToken')}
          secure
        />
        <Field theme={theme}
          label="Telegram chat id"
          value={config.telegramChatId}
          onChangeText={set('telegramChatId')}
        />
        <Field theme={theme}
          label="Адрес агента"
          value={config.agentUrl}
          onChangeText={set('agentUrl')}
        />
        <Field theme={theme}
          label="Токен агента"
          value={config.agentToken}
          onChangeText={set('agentToken')}
          secure
        />
        <Pressable
          style={[styles.save, {backgroundColor: theme.button}]}
          onPress={onSave}>
          <Text style={[styles.saveText, {color: theme.buttonText}]}>Сохранить</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: 20,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  back: {
    fontSize: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
  },
  field: {
    marginBottom: 14,
  },
  label: {
    marginBottom: 6,
    fontSize: 13,
  },
  input: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  inputMultiline: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
  save: {
    marginTop: 8,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
