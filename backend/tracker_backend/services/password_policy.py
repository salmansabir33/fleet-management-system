"""Password rules for newly created fleet users only."""
import re

NEW_USER_PASSWORD_MIN_LENGTH = 8


def validate_new_user_password(password: str) -> str:
    if len(password) < NEW_USER_PASSWORD_MIN_LENGTH:
        raise ValueError(f"Password must be at least {NEW_USER_PASSWORD_MIN_LENGTH} characters")
    if not re.search(r"[A-Z]", password):
        raise ValueError("Password must contain at least one uppercase letter")
    if not re.search(r"[a-z]", password):
        raise ValueError("Password must contain at least one lowercase letter")
    if not re.search(r"\d", password):
        raise ValueError("Password must contain at least one number")
    return password


def new_user_password_checks(password: str) -> dict[str, bool]:
    return {
        "min_length": len(password) >= NEW_USER_PASSWORD_MIN_LENGTH,
        "uppercase": bool(re.search(r"[A-Z]", password)),
        "lowercase": bool(re.search(r"[a-z]", password)),
        "number": bool(re.search(r"\d", password)),
    }


def is_new_user_password_valid(password: str) -> bool:
    return all(new_user_password_checks(password).values())
