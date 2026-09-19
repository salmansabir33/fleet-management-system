"""Password hashing, encryption for admin reveal, and JWT helpers."""
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
from cryptography.fernet import Fernet, InvalidToken
from jose import JWTError, jwt

from tracker_backend.config import settings

ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain_password: str, password_hash: str | None) -> bool:
    if not password_hash:
        return False
    try:
        return bcrypt.checkpw(plain_password.encode(), password_hash.encode())
    except ValueError:
        return False


def _fernet() -> Fernet:
    return Fernet(settings.PASSWORD_ENC_KEY.encode())


def encrypt_password(plain_password: str) -> str:
    return _fernet().encrypt(plain_password.encode()).decode()


def decrypt_password(password_enc: str | None) -> str | None:
    if not password_enc:
        return None
    try:
        return _fernet().decrypt(password_enc.encode()).decode()
    except InvalidToken:
        return None


def set_user_password(user, plain_password: str) -> None:
    user.password_hash = hash_password(plain_password)
    user.password_enc = encrypt_password(plain_password)


def create_access_token(data: dict[str, Any], expires_delta: timedelta | None = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.JWT_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.JWT_SECRET, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any] | None:
    try:
        return jwt.decode(token, settings.JWT_SECRET, algorithms=[ALGORITHM])
    except JWTError:
        return None
