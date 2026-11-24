import {View} from 'react-native';

import {NETWORK_MESSAGE, TIMEOUT_MESSAGE, type LinkState} from './api';
import {useTheme} from './theme';
import {Body, Btn} from './ui';

type Props = {
  link: Exclude<LinkState, 'ok'>;
  busy: boolean;
  onRetry: () => void;
};

/** Плашка над вкладками, пока сервер недоступен: что случилось и кнопка «повторить». */
export function OfflineBar({link, busy, onRetry}: Props) {
  const t = useTheme();
  const title = link === 'network' ? NETWORK_MESSAGE : TIMEOUT_MESSAGE;
  const hint =
    link === 'network'
      ? 'Проверьте интернет. Данные на экране могут быть устаревшими.'
      : 'Попробуйте чуть позже. Данные на экране могут быть устаревшими.';

  return (
    <View
      testID="offline-bar"
      accessibilityRole="alert"
      style={{
        backgroundColor: t.surface,
        borderTopColor: t.signal,
        borderTopWidth: 2,
        paddingHorizontal: 16,
        paddingVertical: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
      }}>
      <View style={{width: 10, height: 10, borderRadius: 5, backgroundColor: t.signal}} />
      <View style={{flex: 1, gap: 2}}>
        <Body style={{fontWeight: '600'}}>{title}</Body>
        <Body muted style={{fontSize: 13, lineHeight: 18}}>
          {hint}
        </Body>
      </View>
      <Btn testID="offline-retry" small kind="ghost" title="повторить" onPress={onRetry} busy={busy} />
    </View>
  );
}
