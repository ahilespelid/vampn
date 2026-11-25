import {useEffect, useState} from 'react';
import {ActivityIndicator, Pressable, Text, View} from 'react-native';

import {formatClock, formatElapsed} from './format';
import {clearLog, dismissLatest, useServerLog, type LogEntry} from './serverLog';
import {fontStyle, useTheme} from './theme';
import {Body, Btn, Card, Sheet} from './ui';

/** Пока значение истинно, отдаёт текущее время раз в секунду: на нём живёт счётчик ожидания. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) {
      return undefined;
    }
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/** Смена IP и перезагрузка идут долго: сервер отвечает только когда команда закончилась. */
function isSlow(entry: LogEntry): boolean {
  return /\/control\/(rotate|reboot)$/.test(entry.path);
}

function statusText(entry: LogEntry, now: number): string {
  if (entry.state === 'pending') {
    return `ждём ответ · ${formatElapsed(Math.floor((now - entry.at) / 1000) * 1000)}`;
  }
  const head = entry.status ? `HTTP ${entry.status}` : 'нет ответа';
  return `${head} · ${formatElapsed(entry.ms ?? 0)}`;
}

function responseText(entry: LogEntry): string {
  if (entry.state === 'pending') {
    return isSlow(entry)
      ? 'Команда ушла на сервер. Он вернёт её вывод, когда она закончится (до 7 минут).'
      : 'Команда ушла на сервер, ждём вывод.';
  }
  const text = (entry.response ?? '').trim();
  if (text) {
    return text;
  }
  return entry.state === 'ok' ? 'Команда выполнена, сервер ничего не вывел.' : 'Пустой ответ.';
}

/**
 * Строка над нижней навигацией: какая команда ушла на сервер и что он ответил, дословно.
 * Нажатие открывает журнал всех обменов за сеанс.
 */
export function ServerLogBar() {
  const t = useTheme();
  const {entries, dismissed} = useServerLog();
  const [open, setOpen] = useState(false);
  const now = useNow(entries.some(entry => entry.state === 'pending'));
  const last = entries[0];

  const tone = (entry: LogEntry) => (entry.state === 'ok' ? t.ok : entry.state === 'error' ? t.signalSoft : t.muted);

  return (
    <>
      {last && last.id !== dismissed ? (
        <View testID="server-log" style={{flexDirection: 'row', backgroundColor: t.surface, borderTopColor: t.border, borderTopWidth: 1}}>
          <Pressable
            testID="server-log-open"
            accessibilityRole="button"
            accessibilityLabel="Открыть журнал обмена с сервером"
            onPress={() => setOpen(true)}
            style={{flex: 1, paddingVertical: 12, paddingLeft: 16, gap: 4}}>
            <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
              {last.state === 'pending' ? (
                <ActivityIndicator size="small" color={t.muted} />
              ) : (
                <View style={{width: 8, height: 8, borderRadius: 4, backgroundColor: tone(last)}} />
              )}
              <Text numberOfLines={1} style={{flex: 1, color: t.text, ...fontStyle(t, 'mono', '700'), fontSize: 12}}>
                {last.method} {last.path}
              </Text>
              <Text style={{color: tone(last), fontFamily: t.font.mono, fontSize: 12}}>{statusText(last, now)}</Text>
            </View>
            <Text numberOfLines={1} style={{color: t.muted, fontFamily: t.font.mono, fontSize: 12}}>
              $ {last.command}
            </Text>
            <Text numberOfLines={5} style={{color: t.text, fontFamily: t.font.mono, fontSize: 12, lineHeight: 17}}>
              {responseText(last)}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Скрыть строку"
            onPress={dismissLatest}
            hitSlop={8}
            style={{paddingHorizontal: 16, paddingVertical: 12}}>
            <Text style={{color: t.muted, fontFamily: t.font.mono, fontSize: 16}}>×</Text>
          </Pressable>
        </View>
      ) : null}

      <Sheet visible={open} onClose={() => setOpen(false)} title="Журнал обмена с сервером">
        {entries.length === 0 ? <Body muted>Пока пусто: команды на сервер ещё не отправлялись.</Body> : null}
        {entries.map(entry => (
          <Card key={entry.id} style={{gap: 8}}>
            <View style={{flexDirection: 'row', justifyContent: 'space-between', gap: 8}}>
              <Body mono muted>
                {formatClock(entry.at)}
              </Body>
              <Text style={{color: tone(entry), fontFamily: t.font.mono, fontSize: 12}}>{statusText(entry, now)}</Text>
            </View>
            <Body mono weight="700" selectable>
              {entry.method} {entry.path}
            </Body>
            {entry.body ? (
              <Body mono muted selectable>
                тело: {entry.body}
              </Body>
            ) : null}
            <Body mono muted selectable>
              $ {entry.command}
            </Body>
            <Body mono selectable>
              {responseText(entry)}
            </Body>
          </Card>
        ))}
        {entries.length > 0 ? <Btn kind="ghost" title="очистить журнал" onPress={clearLog} /> : null}
        <Btn title="закрыть" onPress={() => setOpen(false)} />
      </Sheet>
    </>
  );
}
