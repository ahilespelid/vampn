#!/usr/bin/env python3
"""Проверки хука «письмо с ключом -> уведомление в приложении» в почтовой части vampn (MAIL_PY).

Запуск: python3 test_mail_hook.py [путь к vampn]   (нужен только python3, база и почта не нужны)
Код MAIL_PY достаётся из самого скрипта, поэтому проверяется то, что реально уйдёт на сервер.
"""
import io, os, re, subprocess, sys, tempfile, unittest
from email.message import EmailMessage
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = sys.argv.pop(1) if len(sys.argv) > 1 and not sys.argv[1].startswith('-') else os.path.join(HERE, 'vampn')


def load_mail_py():
    text = open(SCRIPT, encoding='utf-8').read()
    code = re.search(r"read -r -d '' MAIL_PY <<'PY' \|\| true\n(.*?)\nPY\n", text, re.S).group(1)
    code = code.replace('sys.exit(main(sys.argv[1:]))', '')
    ns = {'__name__': 'mailpy'}
    env = {'VAMPN_SELF': '/bin/false', 'VAMPN_BASE': tempfile.mkdtemp()}
    with mock.patch.dict(os.environ, env):
        exec(compile(code, 'MAIL_PY', 'exec'), ns)
    return ns


NS = load_mail_py()


def msg(user='ann', rotation=False, subject='Ваш VPN: ключ «ann»'):
    m = EmailMessage()
    m['To'] = 'ann@example.com'
    m['Subject'] = subject
    if user is not None:
        m['X-Vampn-User'] = user
    m['X-Vampn-Endpoint'] = '203.0.113.7'
    if rotation:
        m['X-Vampn-Rotation'] = '1'
    m.set_content('текст')
    return m


class Recorder:
    """Подменяет subprocess.run: запоминает вызовы, ничего не запускает."""

    def __init__(self, result=None, error=None):
        self.calls, self.result, self.error = [], result, error

    def __call__(self, cmd, **kw):
        self.calls.append((cmd, kw))
        if self.error:
            raise self.error
        return self.result or mock.Mock(returncode=0, stdout=b'', stderr=b'')

    def db(self):
        return [c for c in self.calls if c[0] == NS['APP_DB']]


def sql_of(call):
    return call[1]['input'].decode('utf-8')


class Notify(unittest.TestCase):
    def run_notify(self, m, **env):
        rec = Recorder()
        with mock.patch.object(subprocess, 'run', rec), mock.patch.dict(NS, env):
            NS['notify_app'](m)
        return rec

    def test_rotation_mail_makes_key_and_notification(self):
        rec = self.run_notify(msg(rotation=True, subject='Ваш VPN: новый ключ «ann»'))
        self.assertEqual(len(rec.db()), 1)
        sql = sql_of(rec.db()[0])
        self.assertIn("u.name = 'ann'", sql)
        self.assertIn("'reissued'", sql)
        self.assertIn('Новый ключ VPN: сменился адрес сервера', sql)
        self.assertIn("'key'", sql)
        self.assertIn('LAST_INSERT_ID()', sql)
        self.assertTrue(sql.startswith("SET time_zone = '+00:00';\nSTART TRANSACTION;") and sql.rstrip().endswith('COMMIT;'))
        self.assertEqual(rec.db()[0][1]['timeout'], 10)

    def test_reissue_mail(self):
        sql = sql_of(self.run_notify(msg(subject='Ваш VPN: новый ключ «ann»')).db()[0])
        self.assertIn('Новый ключ VPN', sql)
        self.assertNotIn('сменился адрес', sql)
        self.assertIn("'reissued'", sql)

    def test_plain_mail_is_created_or_resent(self):
        sql = sql_of(self.run_notify(msg()).db()[0])
        self.assertIn('Ключ VPN отправлен на почту', sql)
        self.assertIn('@first', sql)
        self.assertIn("IF(@first, 'created', 'resent')", sql)

    def test_emergency_by_kind_and_by_subject(self):
        for rec in (self.run_notify(msg(), KIND='emergency'),
                    self.run_notify(msg(subject='Ваш VPN: аварийный ключ «ann»'))):
            self.assertIn('Аварийный ключ VPN', sql_of(rec.db()[0]))

    def test_mail_without_user_header_is_ignored(self):
        self.assertEqual(self.run_notify(msg(user=None)).calls, [])

    def test_bad_names_never_reach_sql(self):
        for bad in ("a'; DROP TABLE users;--", '', 'x' * 33, 'имя', 'a b', "a'b"):
            self.assertEqual(self.run_notify(msg(user=bad)).calls, [], bad)

    def test_failures_are_swallowed(self):
        for err in (FileNotFoundError('docker'), subprocess.TimeoutExpired('docker', 10), RuntimeError('boom')):
            rec = Recorder(error=err)
            with mock.patch.object(subprocess, 'run', rec):
                NS['notify_app'](msg())
            self.assertEqual(len(rec.calls), 1)

    def test_sql_is_valid_looking_for_every_kind(self):
        for kind in NS['APP_TITLES']:
            sql = NS['app_sql']('ann.b-2_c', kind)
            self.assertEqual(sql.count('INSERT INTO'), 2)
            # имя стоит только в условиях выбора пользователя: в первой вставке и (для plain) в SET
            self.assertEqual(sql.count("'ann.b-2_c'"), 1 if kind != 'plain' else 2)
            self.assertNotIn('{', sql)
            self.assertNotIn('}', sql)


class Delivery(unittest.TestCase):
    def deliver(self, m, method='smtp', already=False, ssh_out=b'sent', ssh_rc=0):
        rec = Recorder(result=mock.Mock(returncode=ssh_rc, stdout=ssh_out, stderr=b''))
        order = []
        smtp = lambda mm: order.append('smtp')
        with mock.patch.object(subprocess, 'run', rec), \
                mock.patch.dict(NS, {'S': {'MAIL_METHOD': method}, 'smtp_send': smtp,
                                     'mark_sent': lambda mm: order.append('mark'),
                                     'already_sent': lambda mm: already}):
            real = NS['notify_app']
            with mock.patch.dict(NS, {'notify_app': lambda mm: (order.append('notify'), real(mm))[1]}):
                result = NS['deliver'](m)
        return result, order, rec

    def test_smtp_send_notifies_after_the_mail_went(self):
        result, order, rec = self.deliver(msg())
        self.assertEqual((result, order), ('sent', ['smtp', 'mark', 'notify']))
        self.assertEqual(len(rec.db()), 1)

    def test_duplicate_is_not_notified_twice(self):
        result, order, rec = self.deliver(msg(rotation=True), already=True)
        self.assertEqual((result, order, rec.calls), ('dup', [], []))

    def test_relay_from_vpn_server_leaves_notification_to_homeserv(self):
        result, order, rec = self.deliver(msg(), method='relay')
        self.assertEqual(result, 'sent')
        self.assertEqual(order, [])
        self.assertEqual(rec.db(), [])
        self.assertEqual(rec.calls[0][0][0], 'ssh')

    def test_relay_dup_is_dup(self):
        self.assertEqual(self.deliver(msg(), method='relay', ssh_out=b'dup')[0], 'dup')


class RelayEntry(unittest.TestCase):
    """homeserv принимает письмо от VPN-сервера: vampn mail -> mailpy --relay."""

    def relay(self, m, already=False):
        rec = Recorder()
        order = []
        stdin = mock.Mock(buffer=io.BytesIO(m.as_bytes()))
        with mock.patch.object(subprocess, 'run', rec), mock.patch.object(sys, 'stdin', stdin), \
                mock.patch('builtins.print') as out, \
                mock.patch.dict(NS, {'S': {}, 'smtp_send': lambda mm: order.append('smtp'),
                                     'mark_sent': lambda mm: order.append('mark'),
                                     'already_sent': lambda mm: already}):
            code = NS['main'](['--relay'])
        return code, order, rec, out

    def test_new_key_mail_creates_notification_once(self):
        code, order, rec, out = self.relay(msg(rotation=True, subject='Ваш VPN: новый ключ «ann»'))
        self.assertEqual((code, order), (0, ['smtp', 'mark']))
        self.assertEqual(len(rec.db()), 1)
        out.assert_called_with('sent')

    def test_duplicate_rotation_mail_makes_no_second_notification(self):
        code, order, rec, out = self.relay(msg(rotation=True), already=True)
        self.assertEqual((code, order, rec.calls), (0, [], []))
        out.assert_called_with('dup')


if __name__ == '__main__':
    unittest.main(verbosity=2)
