"""Run interactively: python -m app.reset_admin_password EMAIL (no password argument)."""
import argparse
import getpass
from datetime import datetime, timezone

from sqlalchemy import func, select, update

from app.core.security import hash_password
from app.db.models import AuthSession, User
from app.db.session import SessionLocal


def main():
    parser = argparse.ArgumentParser(description='Reset administrator password and revoke their sessions')
    parser.add_argument('email')
    args = parser.parse_args()
    with SessionLocal() as db:
        user = db.scalar(select(User).where(func.lower(User.email) == args.email.strip().lower(), User.is_admin.is_(True)))
        if user is None:
            parser.error('Administrator not found')
        password = getpass.getpass('New password (minimum 14 characters): ')
        if not 14 <= len(password) <= 128 or password != getpass.getpass('Repeat new password: '):
            parser.error('Password is too short or confirmation does not match')
        user.password_hash = hash_password(password)
        del password
        db.execute(update(AuthSession).where(AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None)).values(revoked_at=datetime.now(timezone.utc)))
        db.commit()
    print('Password updated; administrator sessions revoked.')


if __name__ == '__main__':
    main()
