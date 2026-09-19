"""add user password fields

Revision ID: b1e4f7a2c903
Revises: a9c4e7f2b681
Create Date: 2026-09-02 11:15:00.000000

"""
import os
from typing import Sequence, Union

import bcrypt
from alembic import op
import sqlalchemy as sa
from cryptography.fernet import Fernet
from dotenv import load_dotenv
from sqlalchemy.orm import Session

from tracker_backend.config import settings

revision: str = 'b1e4f7a2c903'
down_revision: Union[str, Sequence[str], None] = 'a9c4e7f2b681'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _default_user_password() -> str:
    """Password used to backfill existing users. Must come from the environment."""
    load_dotenv()
    password = os.getenv("DEFAULT_USER_PASSWORD")
    if not password:
        raise RuntimeError(
            "DEFAULT_USER_PASSWORD is required to run this migration. "
            "Set it in backend/.env or export it before running alembic upgrade."
        )
    return password


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {col['name'] for col in inspector.get_columns('users')}

    if 'password_hash' not in columns:
        op.add_column('users', sa.Column('password_hash', sa.String(length=255), nullable=True))
    if 'password_enc' not in columns:
        op.add_column('users', sa.Column('password_enc', sa.String(length=512), nullable=True))

    default_password = _default_user_password()
    fernet = Fernet(settings.PASSWORD_ENC_KEY.encode())
    password_hash = bcrypt.hashpw(default_password.encode(), bcrypt.gensalt()).decode()
    password_enc = fernet.encrypt(default_password.encode()).decode()

    session = Session(bind=bind)
    try:
        session.execute(
            sa.text(
                'UPDATE users SET password_hash = :hash, password_enc = :enc '
                'WHERE password_hash IS NULL OR password_hash = ""'
            ),
            {'hash': password_hash, 'enc': password_enc},
        )
        session.commit()
    finally:
        session.close()


def downgrade() -> None:
    op.drop_column('users', 'password_enc')
    op.drop_column('users', 'password_hash')
