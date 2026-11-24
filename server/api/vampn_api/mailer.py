import logging
import smtplib
import ssl
from email.message import EmailMessage

log = logging.getLogger("vampn_api.mail")


class SmtpMailer:
    """Отправка кода входа. Ключи пользователям по-прежнему рассылает сам vampn."""

    def __init__(self, settings):
        self.s = settings

    def send_code(self, email: str, code: str, ttl_minutes: int) -> bool:
        s = self.s
        if not s.smtp_host or not s.mail_from:
            log.error("SMTP не настроен, код не отправлен")
            return False
        msg = EmailMessage()
        msg["Subject"] = "vampn: код входа"
        msg["From"] = s.mail_from
        msg["To"] = email
        msg.set_content(
            "Ваш код входа в приложение vampn: %s\n\n"
            "Код действует %d минут. Если вы не запрашивали вход, просто проигнорируйте это письмо.\n" % (code, ttl_minutes)
        )
        try:
            if s.smtp_tls == "ssl":
                srv = smtplib.SMTP_SSL(s.smtp_host, s.smtp_port, timeout=30, context=ssl.create_default_context())
            else:
                srv = smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=30)
                if s.smtp_tls == "starttls":
                    srv.starttls(context=ssl.create_default_context())
            with srv:
                if s.smtp_user:
                    srv.login(s.smtp_user, s.smtp_pass)
                srv.send_message(msg)
            return True
        except Exception as exc:  # письмо не должно ломать ответ API и раскрывать наличие адреса
            log.error("не удалось отправить код: %s", exc.__class__.__name__)
            return False


class NullPush:
    """Заглушка push до подключения Firebase (Android) и APNs (iOS)."""

    def send(self, devices, title: str, body: str = "") -> int:
        log.info("push (заглушка): устройств %d, %s", len(devices), title)
        return 0
