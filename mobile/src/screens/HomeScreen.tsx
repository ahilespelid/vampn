import {useCallback, useEffect, useMemo, useState} from 'react';
import {Alert, Text, View} from 'react-native';
import Svg, {Circle, Path} from 'react-native-svg';

import {useAuth} from '../auth';
import {describeError} from '../format';
import {cabinetState, parseCabinets, parseEmergency, parseStatus, type Cabinet, type ServiceState} from '../serviceStatus';
import {fontStyle, useTheme} from '../theme';
import {ServersCard} from '../ServersCard';
import {useReconnect} from '../useReconnect';
import {Body, Btn, Card, ErrorNote, IconBadge, Label, Page, Pill, Segmented, Toggle} from '../ui';

const RADAR_RINGS = [45, 70, 95, 120, 145];

/** Круги-«радар» в углу главной карточки. */
function Radar({color}: {color: string}) {
  return (
    <Svg width={288} height={288} viewBox="0 0 430 240" pointerEvents="none" style={{position: 'absolute', right: -70, top: -40}}>
      {RADAR_RINGS.map(r => (
        <Circle key={r} cx={215} cy={120} r={r} fill="none" stroke={color} strokeWidth={1} />
      ))}
      <Path d="M215 0v240M0 120h430" stroke={color} strokeWidth={1} fill="none" />
    </Svg>
  );
}

function StatusPill({state, loaded}: {state: ServiceState; loaded: boolean}) {
  const t = useTheme();
  const tone = state === 'ok' ? t.ok : state === 'down' ? t.signalSoft : t.muted;
  const text = !loaded ? 'Загрузка…' : state === 'ok' ? 'Сервер работает' : state === 'down' ? 'Сервер не отвечает' : 'Статус получен';
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: `${tone}66`,
        backgroundColor: `${tone}14`,
        paddingHorizontal: 12,
        paddingVertical: 6,
      }}>
      <View style={{width: 6, height: 6, borderRadius: 3, backgroundColor: tone}} />
      <Text style={{color: tone, fontFamily: t.font.sans, fontSize: 12}}>{text}</Text>
    </View>
  );
}

export function HomeScreen() {
  const t = useTheme();
  const {api, user} = useAuth();
  const isAdmin = user?.role === 'admin';
  const [status, setStatus] = useState('');
  const [emergency, setEmergency] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [mode, setMode] = useState<'rotate' | 'force'>('rotate');
  // На каком кабинете Timeweb действовать: на активном (как раньше), на основном или на запасном. Выбор только у суперадмина.
  const [target, setTarget] = useState<'auto' | '1' | '2'>('auto');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [s, e] = await Promise.all([api.status(), isAdmin ? api.emergency('status') : Promise.resolve(null)]);
      setStatus(s.text.trim());
      setEmergency(e ? e.text.trim() : '');
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, [api, isAdmin]);

  useEffect(() => {
    load();
  }, [load]);

  useReconnect(load);

  const info = useMemo(() => parseStatus(status), [status]);
  const cabinets = useMemo(() => parseCabinets(status), [status]);
  const multi = isAdmin && cabinets.length > 1;
  const chosen = multi && target !== 'auto' ? cabinets.find(c => String(c.server) === target) : undefined;
  const emergencyState = useMemo(() => parseEmergency(emergency), [emergency]);

  // Что ушло на сервер и что он ответил, показывает строка журнала внизу экрана (ServerLogBar).
  const act = async (id: string, job: () => Promise<unknown>) => {
    setBusy(id);
    setError('');
    try {
      await job();
      load();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy('');
    }
  };

  const rotate = () => {
    const force = mode === 'force';
    const other = chosen && !chosen.active ? chosen : undefined; // выбран не тот кабинет, на котором сейчас туннель
    const go = () => act('rotate', () => api.rotate(force, chosen?.server));
    if (other) {
      Alert.alert(
        `Сменить IP на кабинете «${other.label}»?`,
        `Если туннель поднимется, этот кабинет станет активным, и все подключённые получат новые ключи.${force ? ' Смена пойдёт принудительно, даже если адрес не заблокирован.' : ''}`,
        [
          {text: 'Отмена', style: 'cancel'},
          {text: 'Сменить', style: 'destructive', onPress: go},
        ],
      );
    } else if (force) {
      Alert.alert('Сменить IP принудительно?', 'Адрес сервера сменится сразу, даже если он не заблокирован. Все подключённые получат новые ключи.', [
        {text: 'Отмена', style: 'cancel'},
        {text: 'Сменить', style: 'destructive', onPress: go},
      ]);
    } else {
      go();
    }
  };

  const switchCabinet = (cabinet: Cabinet) => {
    Alert.alert(
      `Перейти на кабинет «${cabinet.label}»?`,
      'Туннель переключится на адрес этого кабинета, IP не меняется. Ключи не рассылаются: у кого в ключе прежний адрес, подключение заработает, только пока тот адрес доступен.',
      [
        {text: 'Отмена', style: 'cancel'},
        {text: 'Перейти', style: 'destructive', onPress: () => act('use', () => api.useServer(cabinet.server))},
      ],
    );
  };

  const reboot = () => {
    const go = (hard: boolean) => act('reboot', () => api.reboot(hard));
    Alert.alert('Перезагрузить VPN-сервер?', 'Подключение пропадёт на пару минут.', [
      {text: 'Отмена', style: 'cancel'},
      {text: 'Перезагрузить', style: 'destructive', onPress: () => go(false)},
      ...(isAdmin ? [{text: 'Жёстко', style: 'destructive' as const, onPress: () => go(true)}] : []),
    ]);
  };

  const showServer = () => act('server', () => api.server());

  const setEmergencyMode = (value: 'on' | 'off') => {
    Alert.alert(value === 'on' ? 'Включить аварийный канал?' : 'Выключить аварийный канал?', '', [
      {text: 'Отмена', style: 'cancel'},
      {text: 'Да', onPress: () => act('emergency', () => api.emergency(value))},
    ]);
  };

  const emergencyLabel = emergencyState === 'on' ? 'включён' : emergencyState === 'off' ? 'выключен' : loading ? 'загрузка…' : 'нет данных';

  return (
    <Page title="Всё под контролем." subtitle="Управляйте сервером. Без лишних движений." refreshing={loading} onRefresh={load}>
      {error ? <ErrorNote text={error} /> : null}

      <Card hero style={{overflow: 'hidden'}}>
        <Radar color={t.border} />
        <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28}}>
          <StatusPill state={info.state} loaded={!!status} />
        </View>
        <Body muted>Текущий IP-адрес</Body>
        <Text selectable style={{color: t.text, ...fontStyle(t, 'mono'), fontSize: 27, letterSpacing: -1, marginTop: 4}}>
          {info.ip || '—'}
        </Text>
        <View style={{flexDirection: 'row', marginTop: 24, paddingTop: 16, borderTopWidth: 1, borderTopColor: t.border}}>
          <View style={{flex: 1}}>
            <Label>туннель</Label>
            <Body weight="600" style={{marginTop: 6}}>
              {info.tunnel || '—'}
            </Body>
          </View>
          <View style={{flex: 1, borderLeftWidth: 1, borderLeftColor: t.border, paddingLeft: 20}}>
            <Label>без связи</Label>
            <Body weight="600" style={{marginTop: 6}}>
              {info.fails || '—'}
            </Body>
          </View>
        </View>
      </Card>

      {multi ? (
        <Card style={{gap: 14}}>
          <Label>кабинеты Timeweb</Label>
          {cabinets.map((c, index) => {
            const st = cabinetState(c.state);
            return (
              <View
                key={c.server}
                testID={`cabinet-${c.server}`}
                style={{gap: 4, paddingTop: index ? 14 : 0, borderTopWidth: index ? 1 : 0, borderTopColor: t.border}}>
                <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8}}>
                  <Body weight="700">{c.label}</Body>
                  <View style={{flexDirection: 'row', gap: 6}}>
                    {c.active ? <Pill text="активный" tone="signal" /> : null}
                    <Pill text={st.text} tone={st.tone} />
                  </View>
                </View>
                <Body mono muted style={{fontSize: 13, lineHeight: 19}}>
                  {c.ips.join(' · ') || 'IPv4 нет'}
                </Body>
                <Body muted style={{fontSize: 12, lineHeight: 18}}>
                  новых IP за сутки {c.used} из {c.limit}
                  {c.note ? ` · ${c.note}` : ''}
                </Body>
              </View>
            );
          })}
          <Body muted>Где действовать: смена IP ниже и переход туннеля идут на выбранный кабинет. «Активный» - как обычно.</Body>
          <Segmented
            value={target}
            onChange={setTarget}
            options={[
              {value: 'auto', label: 'активный'},
              {value: '1', label: 'основной'},
              {value: '2', label: 'запасной'},
            ]}
          />
          {chosen && !chosen.active ? (
            <Btn
              testID="use-cabinet"
              kind="ghost"
              arrow
              title={busy === 'use' ? 'Переключаю…' : `Перейти на «${chosen.label}»`}
              onPress={() => switchCabinet(chosen)}
              busy={busy === 'use'}
              disabled={!!busy}
            />
          ) : null}
        </Card>
      ) : null}

      <Card style={{gap: 16}}>
        <View style={{flexDirection: 'row', alignItems: 'center', gap: 12}}>
          <IconBadge name="refresh" tone="signal" />
          <View style={{flex: 1}}>
            <Text style={{color: t.text, ...fontStyle(t, 'sans', '600'), fontSize: 18, lineHeight: 24}}>Новый адрес. Тот же доступ.</Text>
            <Label style={{marginTop: 2}}>смена IP-адреса</Label>
          </View>
        </View>
        <Body muted>VPN перестал работать? Смените IP вручную или доверьтесь автоматическому сторожу: обычно он делает это сам.</Body>
        {isAdmin ? (
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              {value: 'rotate', label: 'если заблокирован'},
              {value: 'force', label: 'принудительно'},
            ]}
          />
        ) : null}
        <Btn
          testID="rotate"
          kind="signal"
          icon="refresh"
          arrow
          title={busy === 'rotate' ? 'Меняю IP, ждём сервер…' : chosen ? `Сменить IP: ${chosen.label}` : 'Сменить IP-адрес'}
          onPress={rotate}
          busy={busy === 'rotate'}
          disabled={!!busy}
        />
        <View style={{flexDirection: 'row', gap: 8}}>
          <View style={{flex: 1}}>
            <Btn kind="ghost" title="Перезагрузить" onPress={reboot} busy={busy === 'reboot'} disabled={!!busy} />
          </View>
          <View style={{flex: 1}}>
            <Btn kind="ghost" arrow title="О сервере" onPress={showServer} busy={busy === 'server'} disabled={!!busy} />
          </View>
        </View>
      </Card>

      {isAdmin ? (
        <Card style={{gap: 16}}>
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 12}}>
            <IconBadge name="zap" />
            <View style={{flex: 1}}>
              <Text style={{color: t.text, ...fontStyle(t, 'sans', '600'), fontSize: 16, lineHeight: 22}}>План Б — всегда рядом</Text>
              <Body muted style={{fontSize: 12, lineHeight: 18, marginTop: 2}}>
                Аварийный канал · {emergencyLabel}
              </Body>
            </View>
            <Toggle
              testID="emergency-toggle"
              label="Аварийный канал"
              value={emergencyState === 'on'}
              disabled={!!busy}
              onValueChange={next => setEmergencyMode(next ? 'on' : 'off')}
            />
          </View>
          <Body muted>Резервное соединение, когда основной канал недоступен.</Body>
          {emergency ? (
            <Body mono muted selectable>
              {emergency}
            </Body>
          ) : null}
        </Card>
      ) : null}

      {isAdmin ? <ServersCard /> : null}

      <Card style={{gap: 8}}>
        <Label>состояние</Label>
        {status ? (
          <Body mono selectable>
            {status}
          </Body>
        ) : (
          <Body muted>{loading ? 'Загрузка…' : 'Нет данных'}</Body>
        )}
      </Card>
    </Page>
  );
}
