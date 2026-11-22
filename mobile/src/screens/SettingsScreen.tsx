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
import {defaultConfig, type VampnConfig} from '../types';

type Props = {
  onClose: () => void;
};

type FieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  secure?: boolean;
  multiline?: boolean;
  keyboard?: 'default' | 'numeric';
};

function Field({
  label,
  value,
  onChangeText,
  secure,
  multiline,
  keyboard,
}: FieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secure}
        multiline={multiline}
        keyboardType={keyboard ?? 'default'}
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor="#8d8794"
        style={[styles.input, multiline ? styles.inputMultiline : null]}
      />
    </View>
  );
}

export function SettingsScreen({onClose}: Props) {
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
    <View style={[styles.screen, {paddingTop: insets.top + 12}]}>
      <View style={styles.top}>
        <Pressable onPress={onClose} hitSlop={12}>
          <Text style={styles.back}>назад</Text>
        </Pressable>
        <Text style={styles.title}>настройки</Text>
      </View>
      <ScrollView
        contentContainerStyle={{paddingBottom: insets.bottom + 28}}
        keyboardShouldPersistTaps="handled">
        <Field label="Хост" value={config.host} onChangeText={set('host')} />
        <Field
          label="Порт"
          value={config.port}
          onChangeText={set('port')}
          keyboard="numeric"
        />
        <Field
          label="Пользователь"
          value={config.username}
          onChangeText={set('username')}
        />
        <Field
          label="Пароль"
          value={config.password}
          onChangeText={set('password')}
          secure
        />
        <Field
          label="Приватный ключ"
          value={config.privateKey}
          onChangeText={set('privateKey')}
          multiline
        />
        <Field
          label="Пароль ключа"
          value={config.passphrase}
          onChangeText={set('passphrase')}
          secure
        />
        <Field
          label="Команды SSH"
          value={config.commands}
          onChangeText={set('commands')}
          multiline
        />
        <Field
          label="Команды сброса IP"
          value={config.resetCommands}
          onChangeText={set('resetCommands')}
          multiline
        />
        <Field
          label="Telegram bot token"
          value={config.telegramBotToken}
          onChangeText={set('telegramBotToken')}
          secure
        />
        <Field
          label="Telegram chat id"
          value={config.telegramChatId}
          onChangeText={set('telegramChatId')}
        />
        <Pressable style={styles.save} onPress={onSave}>
          <Text style={styles.saveText}>Сохранить</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0e0d12',
    paddingHorizontal: 20,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  back: {
    color: '#d7c7b8',
    fontSize: 16,
  },
  title: {
    color: '#f4efe8',
    fontSize: 18,
  },
  field: {
    marginBottom: 14,
  },
  label: {
    color: '#b7a99b',
    marginBottom: 6,
    fontSize: 13,
  },
  input: {
    color: '#f4efe8',
    borderWidth: 1,
    borderColor: '#3a3440',
    borderRadius: 12,
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
    backgroundColor: '#9d2b3a',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveText: {
    color: '#f4efe8',
    fontSize: 16,
  },
});
