import {useMemo, useState} from 'react';
import {Alert, Linking, Share, View} from 'react-native';

import {useAuth} from './auth';
import {describeError} from './format';
import {QrCode} from './QrCode';
import {tryQrMatrix} from './qr';
import {useTheme} from './theme';
import {Body, Btn, Card, Label, Notice, Sheet} from './ui';

type Props = {
  name: string;
  /** Уведомление, из которого открыт ключ: при получении ключа оно отметится доставленным. */
  notificationId?: number;
  onChanged?: () => void;
  only?: 'link';
};

/** Показать ключ (токен vpn://) и QR-код, выслать ключ на почту или перевыпустить его. */
export function KeyActions({name, notificationId, onChanged, only}: Props) {
  const t = useTheme();
  const {api} = useAuth();
  const [busy, setBusy] = useState<'' | 'link' | 'resend' | 'reissue'>('');
  const [link, setLink] = useState('');
  const [conf, setConf] = useState('');
  const qrRows = useMemo(() => (conf ? tryQrMatrix(conf) : null), [conf]);
  const [message, setMessage] = useState<{kind: 'error' | 'info'; text: string} | null>(null);

  const run = async (kind: 'link' | 'resend' | 'reissue', job: () => Promise<void>) => {
    setBusy(kind);
    setMessage(null);
    try {
      await job();
    } catch (error) {
      setMessage({kind: 'error', text: describeError(error)});
    } finally {
      setBusy('');
    }
  };

  const getLink = () =>
    run('link', async () => {
      const result = await api.keyLink(name, notificationId);
      setLink(result.link);
      setConf(result.conf ?? '');
      onChanged?.();
    });

  const resend = () =>
    run('resend', async () => {
      await api.keyResend(name);
      setMessage({kind: 'info', text: 'Ключ отправлен на почту.'});
    });

  const reissue = () =>
    Alert.alert('Перевыпустить ключ?', `Старый ключ «${name}» перестанет работать, новый придёт на почту и в приложение.`, [
      {text: 'Отмена', style: 'cancel'},
      {
        text: 'Перевыпустить',
        style: 'destructive',
        onPress: () =>
          run('reissue', async () => {
            await api.keyReissue(name);
            setMessage({kind: 'info', text: 'Новый ключ выпущен, он придёт на почту и в уведомления.'});
            onChanged?.();
          }),
      },
    ]);

  const openInClient = async () => {
    try {
      await Linking.openURL(link);
    } catch {
      setMessage({kind: 'error', text: 'Не нашлось приложения, которое открывает такие ключи. Используйте «поделиться ключом».'});
    }
  };

  return (
    <View style={{gap: 10}}>
      <View style={{flexDirection: 'row', gap: 8, flexWrap: 'wrap'}}>
        <Btn small title="показать ключ" onPress={getLink} busy={busy === 'link'} disabled={!!busy} testID={`key-link-${name}`} />
        {only === 'link' ? null : (
          <>
            <Btn small kind="ghost" title="на почту" onPress={resend} busy={busy === 'resend'} disabled={!!busy} />
            <Btn small kind="ghost" title="перевыпустить" onPress={reissue} busy={busy === 'reissue'} disabled={!!busy} />
          </>
        )}
      </View>
      {message ? <Notice kind={message.kind} text={message.text} /> : null}
      <Sheet
        visible={!!link}
        onClose={() => {
          setLink('');
          setConf('');
        }}
        title={`Ключ ${name}`}>
        <Notice kind="info" text="Это ваш ключ (токен) для VPN. Он даёт доступ к серверу, никому его не показывайте." />
        <Label>ключ (токен)</Label>
        <Card>
          <Body mono style={{color: t.text}}>
            {link}
          </Body>
        </Card>
        <Btn title="поделиться ключом" onPress={() => Share.share({message: link}).catch(() => undefined)} />
        <Btn kind="ghost" title="открыть в VPN-клиенте" onPress={openInClient} />
        {conf ? (
          <View style={{gap: 10, marginTop: 6}}>
            <Label>QR-код</Label>
            <Body muted>
              Для другого телефона: в приложении AmneziaVPN или AmneziaWG нажмите «Добавить» и «Сканировать QR-код». Он строится на этом устройстве.
            </Body>
            {qrRows ? <QrCode rows={qrRows} /> : <Notice kind="error" text="QR-код построить не удалось: ключ не помещается. Используйте ключ (токен) выше." />}
          </View>
        ) : null}
      </Sheet>
    </View>
  );
}
