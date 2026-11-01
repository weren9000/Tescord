"""Durable encrypted mail outbox. No addresses, credentials or codes in logs."""
import asyncio
from datetime import timedelta
from email.message import EmailMessage
import json
import logging
import smtplib
import ssl

from fastapi import HTTPException
from sqlalchemy import delete, select

from app.core.config import get_settings
from app.db.models import AuthMail, AuthChallenge
from app.db.session import SessionLocal
from app.services.auth_security import decrypt, encrypt, now

logger = logging.getLogger(__name__)


def require_mail():
    if not get_settings().email_enabled:
        raise HTTPException(503, 'Отправка писем ещё не настроена. Попробуйте позже.')


def queue_mail(db, email, subject, body, *, expires_at=None):
    require_mail()
    db.add(AuthMail(payload=encrypt(json.dumps({'to': email, 'subject': subject, 'body': body})),
                   expires_at=expires_at or now() + timedelta(days=1)))


def security_notice(db, user, action):
    queue_mail(db, user.email, 'Квачат: настройки безопасности изменены',
               f'{action}\nВремя (UTC): {now():%Y-%m-%d %H:%M}.\n'
               'Если это сделали не вы, проверьте доступ к вашему аккаунту.')


def send_mail(payload):
    settings = get_settings()
    message = EmailMessage()
    message['From'] = settings.smtp_from
    message['To'] = payload['to']
    message['Subject'] = payload['subject']
    message.set_content(payload['body'])
    context = ssl.create_default_context()
    if settings.smtp_security == 'ssl':
        connection = smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=10, context=context)
    else:
        connection = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10)
    with connection as smtp:
        if settings.smtp_security == 'starttls':
            smtp.starttls(context=context)
        if settings.smtp_username:
            smtp.login(settings.smtp_username, settings.smtp_password.get_secret_value() if settings.smtp_password else '')
        smtp.send_message(message)


def dispatch_mail():
    if not get_settings().email_enabled:
        return
    with SessionLocal() as db:
        db.execute(delete(AuthMail).where(AuthMail.expires_at <= now()))
        db.execute(delete(AuthChallenge).where(AuthChallenge.expires_at < now() - timedelta(days=1)))
        mail = db.scalar(select(AuthMail).where(AuthMail.delivered_at.is_(None),
            AuthMail.available_at <= now(), AuthMail.attempts < 6).order_by(AuthMail.available_at)
            .with_for_update(skip_locked=True).limit(1))
        if mail:
            try:
                send_mail(json.loads(decrypt(mail.payload)))
            except Exception:
                mail.attempts += 1
                mail.available_at = now() + timedelta(seconds=min(300, 10 * 2 ** mail.attempts))
                logger.warning('Authentication email delivery deferred')
            else:
                mail.delivered_at = now()
                mail.payload = ''  # Erase secrets as soon as delivery succeeds.
        db.commit()


async def run_auth_mail():
    while True:
        try:
            await asyncio.to_thread(dispatch_mail)
        except Exception:
            logger.warning('Authentication email queue temporarily unavailable')
        await asyncio.sleep(2)
