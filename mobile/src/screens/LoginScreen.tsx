import {useEffect, useState} from 'react';
import {KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {useAuth} from '../auth';
import {cleanCode, describeError, validEmail} from '../format';
import {ServerUrlEditor} from '../ServerUrlEditor';
import {useTheme} from '../theme';
import {Body, Btn, Field, Label, Notice, Sheet} from '../ui';

const RESEND_COOLDOWN = 30;

function hostOf(url: string): string {
  return url.replace(/^https?:\/\//i, '');
}

export function LoginScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [serverOpen, setServerOpen] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) {
      return undefined;
    }
    const timer = setTimeout(() => setCooldown(value => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const sendCode = async () => {
    if (!validEmail(email)) {
      setError('Введите почту целиком, например name@example.com');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await auth.requestCode(email);
      setStep('code');
      setCode('');
      setCooldown(RESEND_COOLDOWN);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async () => {
    if (code.length !== 4) {
      setError('Код состоит из 4 цифр');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await auth.verifyCode(email, code);
    } catch (e) {
      setError(describeError(e));
      setCode('');
      setBusy(false);
    }
  };

  const back = () => {
    setStep('email');
    setCode('');
    setError('');
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{flex: 1, backgroundColor: t.bg}}>
      <ScrollView
        contentContainerStyle={{flexGrow: 1, padding: 24, paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24, gap: 24}}
        keyboardShouldPersistTaps="handled">
        <View style={{gap: 10}}>
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 10}}>
            <View style={{width: 12, height: 12, borderRadius: 6, backgroundColor: t.signal}} />
            <Text style={{color: t.text, fontFamily: t.font.display, fontSize: 44, fontWeight: '700', letterSpacing: 1}}>vampn</Text>
          </View>
          <Body muted>
            {step === 'email'
              ? 'Вход только для тех, кто есть в списке. Введите свою почту: на неё придёт код из 4 цифр.'
              : `Код отправлен на ${email.trim()}. Он действует 10 минут.`}
          </Body>
        </View>

        <View style={{gap: 14}}>
          {step === 'email' ? (
            <>
              <Field
                testID="login-email"
                label="Почта"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                textContentType="emailAddress"
                autoComplete="email"
                returnKeyType="go"
                onSubmitEditing={sendCode}
              />
              {error ? <Notice kind="error" text={error} /> : null}
              <Btn testID="login-send" title="получить код" onPress={sendCode} busy={busy} />
            </>
          ) : (
            <>
              <Field
                testID="login-code"
                label="Код из письма"
                value={code}
                onChangeText={value => setCode(cleanCode(value))}
                keyboardType="number-pad"
                maxLength={4}
                textContentType="oneTimeCode"
                autoComplete="sms-otp"
                style={{fontFamily: t.font.mono, fontSize: 28, letterSpacing: 10, textAlign: 'center'}}
              />
              {error ? <Notice kind="error" text={error} /> : null}
              <Btn testID="login-submit" title="войти" onPress={submitCode} busy={busy} disabled={code.length !== 4} />
              <View style={{flexDirection: 'row', gap: 10}}>
                <View style={{flex: 1}}>
                  <Btn kind="ghost" small title="другая почта" onPress={back} disabled={busy} />
                </View>
                <View style={{flex: 1}}>
                  <Btn
                    kind="ghost"
                    small
                    title={cooldown > 0 ? `код ещё раз · ${cooldown}` : 'код ещё раз'}
                    onPress={sendCode}
                    disabled={busy || cooldown > 0}
                  />
                </View>
              </View>
            </>
          )}
        </View>

        <View style={{flex: 1}} />

        <Pressable onPress={() => setServerOpen(true)} hitSlop={12} accessibilityRole="button" testID="login-server">
          <Label>сервер: {hostOf(auth.apiUrl)} · изменить</Label>
        </Pressable>
      </ScrollView>
      <Sheet visible={serverOpen} onClose={() => setServerOpen(false)} title="Сервер">
        <Body muted>Обычно менять ничего не нужно. Свой адрес нужен, если у вас отдельный сервер vampn.</Body>
        <ServerUrlEditor onSaved={() => setServerOpen(false)} />
      </Sheet>
    </KeyboardAvoidingView>
  );
}
