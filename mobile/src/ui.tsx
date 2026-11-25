import {type ReactNode} from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {NETWORK_MESSAGE, TIMEOUT_MESSAGE} from './api';
import {useAuth} from './auth';
import {Icon, type IconName} from './icons';
import {useNav} from './nav';
import {fontStyle, useTheme, type FontWeight} from './theme';
import type {Tone} from './format';

export function Label({children, style}: {children: ReactNode; style?: StyleProp<ViewStyle>}) {
  const t = useTheme();
  return (
    <Text style={[{color: t.muted, fontFamily: t.font.mono, fontSize: 12, letterSpacing: 1.5, textTransform: 'uppercase'}, style as object]}>
      {children}
    </Text>
  );
}

/** Крупный заголовок страницы (34) или шторки (меньше): гротеск semibold с тугим трекингом, как в макете. */
export function Heading({children, size = 34}: {children: ReactNode; size?: number}) {
  const t = useTheme();
  return (
    <Text
      accessibilityRole="header"
      style={{
        color: t.text,
        ...fontStyle(t, 'sans', '600'),
        fontSize: size,
        lineHeight: Math.round(size * 1.2),
        letterSpacing: size >= 30 ? -1.2 : -0.3,
      }}>
      {children}
    </Text>
  );
}

export function Body({
  children,
  muted,
  mono,
  weight,
  style,
  selectable,
}: {
  children: ReactNode;
  muted?: boolean;
  mono?: boolean;
  /** Жирность: 600 или 700. Задаётся здесь, а не через fontWeight в style (см. fontStyle в theme.ts). */
  weight?: Exclude<FontWeight, '400'>;
  style?: object;
  selectable?: boolean;
}) {
  const t = useTheme();
  return (
    <Text
      selectable={selectable}
      style={[{color: muted ? t.muted : t.text, ...fontStyle(t, mono ? 'mono' : 'sans', weight), fontSize: mono ? 13 : 14, lineHeight: mono ? 19 : 22}, style]}>
      {children}
    </Text>
  );
}

export function Card({children, style, hero}: {children: ReactNode; style?: StyleProp<ViewStyle>; hero?: boolean}) {
  const t = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: t.surface,
          borderColor: t.border,
          borderWidth: 1,
          borderRadius: hero ? t.radius.hero : t.radius.card,
          padding: hero ? 24 : 20,
        },
        style,
      ]}>
      {children}
    </View>
  );
}

/** Квадрат 40×40 со значком: красноватый для главного действия, нейтральный для остальных. */
export function IconBadge({name, tone = 'alt'}: {name: IconName; tone?: 'alt' | 'signal'}) {
  const t = useTheme();
  const signal = tone === 'signal';
  return (
    <View
      style={{
        width: 40,
        height: 40,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: signal ? 'rgba(215, 25, 33, 0.1)' : t.surfaceAlt,
      }}>
      <Icon name={name} size={20} color={signal ? t.signalSoft : t.text} />
    </View>
  );
}

/** Знак VAMPN: красный квадрат со щитом и название. */
export function Logo() {
  const t = useTheme();
  return (
    <View accessibilityRole="header" accessibilityLabel="VAMPN" style={{flexDirection: 'row', alignItems: 'center', gap: 10}}>
      <View style={{width: 36, height: 36, borderRadius: 12, backgroundColor: t.signal, alignItems: 'center', justifyContent: 'center'}}>
        <Icon name="shield" size={24} color="#ffffff" />
      </View>
      <Text style={{color: t.text, ...fontStyle(t, 'sans', '700'), fontSize: 20, letterSpacing: 2}}>VAMPN</Text>
    </View>
  );
}

type BtnKind = 'primary' | 'ghost' | 'signal';

export function Btn({
  title,
  onPress,
  kind = 'primary',
  busy,
  disabled,
  testID,
  small,
  icon,
  arrow,
}: {
  title: string;
  onPress: () => void;
  kind?: BtnKind;
  busy?: boolean;
  disabled?: boolean;
  testID?: string;
  small?: boolean;
  /** Значок слева от названия. */
  icon?: IconName;
  /** Стрелка у правого края. */
  arrow?: boolean;
}) {
  const t = useTheme();
  const bg = kind === 'primary' ? t.button : kind === 'signal' ? t.signal : 'transparent';
  const fg = kind === 'primary' ? t.buttonText : kind === 'signal' ? t.signalText : t.text;
  const off = disabled || busy;
  const shown = title.charAt(0).toUpperCase() + title.slice(1);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{disabled: !!off, busy: !!busy}}
      onPress={off ? undefined : onPress}
      style={({pressed}) => ({
        backgroundColor: bg,
        borderColor: kind === 'ghost' ? t.border : bg,
        borderWidth: 1,
        borderRadius: t.radius.button,
        minHeight: small ? 44 : 48,
        paddingHorizontal: small ? 16 : 20,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 8,
        // Занятая кнопка почти не гаснет: на ней виден счётчик и название действия, а не тёмный прямоугольник.
        opacity: busy ? 0.9 : disabled ? 0.45 : pressed ? 0.8 : 1,
      })}>
      {busy ? <ActivityIndicator color={fg} /> : icon ? <Icon name={icon} size={16} color={fg} /> : null}
      <Text style={{color: fg, ...fontStyle(t, 'sans', '600'), fontSize: small ? 13 : 14}}>{shown}</Text>
      {arrow ? (
        <View style={{marginLeft: 'auto'}}>
          <Icon name="arrow" size={16} color={fg} />
        </View>
      ) : null}
    </Pressable>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  testID,
  ...rest
}: {label: string; value: string; onChangeText: (v: string) => void; testID?: string} & Omit<TextInputProps, 'value' | 'onChangeText'>) {
  const t = useTheme();
  return (
    <View style={{gap: 6}}>
      <Label>{label}</Label>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor={t.muted}
        {...rest}
        style={[
          {
            color: t.text,
            backgroundColor: t.surface,
            borderColor: t.border,
            borderWidth: 1,
            borderRadius: t.radius.m,
            paddingHorizontal: 14,
            paddingVertical: 12,
            minHeight: 48,
            fontSize: 16,
            fontFamily: t.font.sans,
          },
          rest.style,
        ]}
      />
    </View>
  );
}

export function Pill({text, tone = 'muted'}: {text: string; tone?: Tone}) {
  const t = useTheme();
  const color = tone === 'ok' ? t.ok : tone === 'signal' ? t.signalSoft : t.muted;
  return (
    <View style={{borderColor: color, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4, alignSelf: 'flex-start'}}>
      <Text style={{color, fontFamily: t.font.mono, fontSize: 12}}>{text}</Text>
    </View>
  );
}

export function Notice({kind, text}: {kind: 'error' | 'info'; text: string}) {
  const t = useTheme();
  const color = kind === 'error' ? t.signal : t.muted;
  return (
    <View style={{borderColor: color, borderWidth: 1, borderRadius: t.radius.m, padding: 12, flexDirection: 'row', gap: 10}}>
      <View style={{width: 8, height: 8, borderRadius: 4, backgroundColor: color, marginTop: 6}} />
      <Text style={{color: t.text, fontFamily: t.font.sans, fontSize: 14, lineHeight: 20, flex: 1}}>{text}</Text>
    </View>
  );
}

/**
 * Ошибка загрузки на экране. О пропавшей связи уже говорит плашка «нет сети»,
 * поэтому такое же сообщение второй раз не показывается.
 */
export function ErrorNote({text}: {text: string}) {
  const {link} = useAuth();
  if (link !== 'ok' && (text === NETWORK_MESSAGE || text === TIMEOUT_MESSAGE)) {
    return null;
  }
  return <Notice kind="error" text={text} />;
}

/** Переключатель-«таблетка»: выбранный вариант закрашен цветом текста. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: {value: T; label: string}[];
  value: T;
  onChange: (v: T) => void;
}) {
  const t = useTheme();
  return (
    <View accessibilityRole="tablist" style={{flexDirection: 'row', backgroundColor: t.surfaceAlt, borderRadius: 999, padding: 4, gap: 4}}>
      {options.map(o => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{selected: on}}
            onPress={() => onChange(o.value)}
            style={{flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8, borderRadius: 999, backgroundColor: on ? t.text : 'transparent'}}>
            <Text numberOfLines={1} style={{color: on ? t.bg : t.text, fontFamily: t.font.mono, fontSize: 12}}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Выключатель: выключен серым, включён красным. */
export function Toggle({
  value,
  onValueChange,
  label,
  disabled,
  testID,
}: {
  value: boolean;
  onValueChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  testID?: string;
}) {
  const t = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{checked: value, disabled: !!disabled}}
      onPress={disabled ? undefined : () => onValueChange(!value)}
      style={{minHeight: 44, minWidth: 48, justifyContent: 'center', opacity: disabled ? 0.45 : 1}}>
      <View
        style={{
          width: 48,
          height: 28,
          borderRadius: 14,
          padding: 4,
          justifyContent: 'center',
          alignItems: value ? 'flex-end' : 'flex-start',
          backgroundColor: value ? t.signal : t.border,
        }}>
        <View style={{width: 20, height: 20, borderRadius: 10, backgroundColor: '#ffffff'}} />
      </View>
    </Pressable>
  );
}

export function Empty({text}: {text: string}) {
  return (
    <View style={{paddingVertical: 20, alignItems: 'center'}}>
      <Body muted>{text}</Body>
    </View>
  );
}

export function KV({k, v, mono}: {k: string; v: string; mono?: boolean}) {
  return (
    <View style={{flexDirection: 'row', justifyContent: 'space-between', gap: 16, paddingVertical: 4}}>
      <Body muted>{k}</Body>
      <Body mono={mono} style={{flexShrink: 1, textAlign: 'right'}}>
        {v}
      </Body>
    </View>
  );
}

/** Две буквы для круга аккаунта: имя первого ключа, а без него почта. */
export function initialsOf(user: {email: string; accounts: {name: string}[]} | null): string {
  const base = user?.accounts[0]?.name || user?.email || '';
  return base.slice(0, 2).toUpperCase() || '··';
}

function TopBar({right}: {right?: ReactNode}) {
  const t = useTheme();
  const {user} = useAuth();
  const {openSettings} = useNav();
  return (
    <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, paddingTop: 12, paddingBottom: 24}}>
      <Logo />
      <View style={{flexDirection: 'row', alignItems: 'center', gap: 10}}>
        {right}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Открыть настройки аккаунта"
          onPress={openSettings}
          style={{width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: t.border, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center'}}>
          <Text style={{color: t.text, ...fontStyle(t, 'sans', '600'), fontSize: 14}}>{initialsOf(user)}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Экран со своей прокруткой, отступом под вырез и вытягиванием для обновления.
 * Сверху знак VAMPN и круг аккаунта, ниже красная метка, заголовок и подпись, как в макете.
 */
export function Page({
  title,
  subtitle,
  right,
  children,
  refreshing,
  onRefresh,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{flex: 1, backgroundColor: t.bg, paddingTop: insets.top}}>
      <ScrollView
        contentContainerStyle={styles.pageBody}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={t.muted} /> : undefined}>
        <TopBar right={right} />
        <View style={{marginBottom: 24}}>
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8}}>
            <View style={{width: 16, height: 4, borderRadius: 2, backgroundColor: t.signal}} />
            <Label>ваш личный контроль</Label>
          </View>
          <Heading>{title}</Heading>
          {subtitle ? (
            <Body muted style={{marginTop: 8}}>
              {subtitle}
            </Body>
          ) : null}
        </View>
        <View style={{gap: 20}}>{children}</View>
        <Text style={{color: t.muted, fontFamily: t.font.mono, fontSize: 12, letterSpacing: 2, textAlign: 'center', textTransform: 'uppercase', marginTop: 32}}>
          your network. your rules.
        </Text>
      </ScrollView>
    </View>
  );
}

export function Sheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{flex: 1}}>
        <Pressable style={{flex: 1, backgroundColor: t.backdrop}} onPress={onClose} />
        <View
          style={{
            backgroundColor: t.bg,
            borderTopLeftRadius: t.radius.l,
            borderTopRightRadius: t.radius.l,
            maxHeight: '88%',
            paddingBottom: insets.bottom + 12,
          }}>
          <View style={styles.sheetHead}>
            <Heading size={22}>{title}</Heading>
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="закрыть">
              <Label>закрыть</Label>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  pageBody: {
    paddingHorizontal: 20,
    paddingBottom: 32,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    paddingBottom: 8,
  },
  sheetBody: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 14,
  },
});
