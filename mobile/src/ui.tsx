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

import {useTheme} from './theme';
import type {Tone} from './format';

export function Label({children, style}: {children: ReactNode; style?: StyleProp<ViewStyle>}) {
  const t = useTheme();
  return (
    <Text style={[{color: t.muted, fontFamily: t.font.mono, fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase'}, style as object]}>
      {children}
    </Text>
  );
}

export function Heading({children}: {children: ReactNode}) {
  const t = useTheme();
  return (
    <Text style={{color: t.text, fontFamily: t.font.display, fontSize: 26, fontWeight: '700', letterSpacing: 0.5}}>
      {children}
    </Text>
  );
}

export function Body({
  children,
  muted,
  mono,
  style,
  selectable,
}: {
  children: ReactNode;
  muted?: boolean;
  mono?: boolean;
  style?: object;
  selectable?: boolean;
}) {
  const t = useTheme();
  return (
    <Text selectable={selectable} style={[{color: muted ? t.muted : t.text, fontFamily: mono ? t.font.mono : t.font.sans, fontSize: mono ? 13 : 15, lineHeight: mono ? 19 : 21}, style]}>
      {children}
    </Text>
  );
}

export function Card({children, style}: {children: ReactNode; style?: StyleProp<ViewStyle>}) {
  const t = useTheme();
  return (
    <View style={[{backgroundColor: t.surface, borderColor: t.border, borderWidth: 1, borderRadius: t.radius.m, padding: 16}, style]}>
      {children}
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
}: {
  title: string;
  onPress: () => void;
  kind?: BtnKind;
  busy?: boolean;
  disabled?: boolean;
  testID?: string;
  small?: boolean;
}) {
  const t = useTheme();
  const bg = kind === 'primary' ? t.button : kind === 'signal' ? t.signal : 'transparent';
  const fg = kind === 'primary' ? t.buttonText : kind === 'signal' ? t.signalText : t.text;
  const off = disabled || busy;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={off ? undefined : onPress}
      style={({pressed}) => ({
        backgroundColor: bg,
        borderColor: kind === 'ghost' ? t.border : bg,
        borderWidth: 1,
        borderRadius: t.radius.l,
        minHeight: small ? 40 : 52,
        paddingHorizontal: small ? 16 : 22,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 8,
        opacity: off ? 0.45 : pressed ? 0.8 : 1,
      })}>
      {busy ? <ActivityIndicator color={fg} /> : null}
      <Text style={{color: fg, fontFamily: t.font.mono, fontSize: small ? 12 : 14, letterSpacing: 1, textTransform: 'uppercase', fontWeight: '600'}}>
        {title}
      </Text>
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
  const color = tone === 'ok' ? t.ok : tone === 'signal' ? t.signal : t.muted;
  return (
    <View style={{borderColor: color, borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, alignSelf: 'flex-start'}}>
      <Text style={{color, fontFamily: t.font.mono, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase'}}>{text}</Text>
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
    <View style={{flexDirection: 'row', backgroundColor: t.surfaceAlt, borderRadius: t.radius.l, padding: 4, gap: 4}}>
      {options.map(o => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="button"
            onPress={() => onChange(o.value)}
            style={{flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: t.radius.l - 4, backgroundColor: on ? t.button : 'transparent'}}>
            <Text style={{color: on ? t.buttonText : t.text, fontFamily: t.font.mono, fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase'}}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Empty({text}: {text: string}) {
  return (
    <View style={{paddingVertical: 28, alignItems: 'center'}}>
      <Body muted>{text}</Body>
    </View>
  );
}

export function KV({k, v, mono}: {k: string; v: string; mono?: boolean}) {
  return (
    <View style={{flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 4}}>
      <Label>{k}</Label>
      <Body mono={mono} style={{flexShrink: 1, textAlign: 'right'}}>
        {v}
      </Body>
    </View>
  );
}

/** Экран со своей прокруткой, отступом под вырез и вытягиванием для обновления. */
export function Page({
  title,
  right,
  children,
  refreshing,
  onRefresh,
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{flex: 1, backgroundColor: t.bg, paddingTop: insets.top + 8}}>
      <View style={styles.pageHead}>
        <Heading>{title}</Heading>
        {right}
      </View>
      <ScrollView
        contentContainerStyle={styles.pageBody}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={t.muted} /> : undefined}>
        {children}
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
            <Heading>{title}</Heading>
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
  pageHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  pageBody: {
    paddingHorizontal: 20,
    paddingBottom: 32,
    gap: 14,
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
