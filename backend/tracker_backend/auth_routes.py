"""Authentication endpoints — login for fleet users/managers and env-based admin."""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from tracker_backend.config import settings
from tracker_backend.deps import get_current_principal, get_db
from tracker_backend.models import Manager, User
from tracker_backend.rate_limit import check_rate_limit
from tracker_backend.services import auth_service

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


class AuthUserOut(BaseModel):
    role: str
    user_id: int | None = None
    manager_id: int | None = None
    username: str | None = None
    full_name: str | None = None
    pic_url: str | None = None


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    user_id: int | None = None
    manager_id: int | None = None
    username: str | None = None
    full_name: str | None = None
    pic_url: str | None = None


def _user_pic_url(user: User | None) -> str | None:
    if user is None or not user.pic_path:
        return None
    return f"/uploads/{user.pic_path}"


def _enforce_login_rate_limit(request: Request, key_prefix: str) -> None:
    check_rate_limit(
        request,
        key_prefix=key_prefix,
        max_calls=settings.LOGIN_RATE_LIMIT_CALLS,
        window_seconds=settings.LOGIN_RATE_LIMIT_WINDOW_SECONDS,
    )


def _login_fleet_user(db: Session, username: str, password: str) -> LoginResponse:
    user = db.query(User).filter(User.username == username).first()
    if user is None or not auth_service.verify_password(password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")

    manager = db.query(Manager).filter(Manager.user_id == user.id).first()
    role = "manager" if manager is not None else "user"

    token = auth_service.create_access_token({
        "sub": user.username,
        "role": role,
        "user_id": user.id,
        "manager_id": manager.id if manager else None,
    })

    return LoginResponse(
        access_token=token,
        role=role,
        user_id=user.id,
        manager_id=manager.id if manager else None,
        username=user.username,
        full_name=user.full_name,
        pic_url=_user_pic_url(user),
    )


@router.post("/login", response_model=LoginResponse)
def login(request: Request, payload: LoginRequest, db: Session = Depends(get_db)):
    _enforce_login_rate_limit(request, "auth:login")
    return _login_fleet_user(db, payload.username.strip(), payload.password)


@router.post("/admin/login", response_model=LoginResponse)
def admin_login(request: Request, payload: LoginRequest):
    _enforce_login_rate_limit(request, "auth:admin-login")
    username = payload.username.strip()
    if username != settings.ADMIN_USERNAME or payload.password != settings.ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail="Invalid admin credentials")

    token = auth_service.create_access_token({
        "sub": username,
        "role": "admin",
    })

    return LoginResponse(
        access_token=token,
        role="admin",
        username=username,
        full_name="Administrator",
    )


@router.get("/me", response_model=AuthUserOut)
def auth_me(principal: Annotated[dict, Depends(get_current_principal)]):
    return AuthUserOut(
        role=principal["role"],
        user_id=principal.get("user_id"),
        manager_id=principal.get("manager_id"),
        username=principal.get("sub"),
        full_name=principal.get("full_name"),
        pic_url=principal.get("pic_url"),
    )


@router.post("/refresh", response_model=LoginResponse)
def refresh_token(principal: Annotated[dict, Depends(get_current_principal)]):
    """Issue a fresh access token for a still-valid session (same claims, new expiry)."""
    role = principal["role"]
    if role == "admin":
        token = auth_service.create_access_token({
            "sub": principal.get("sub"),
            "role": "admin",
        })
        return LoginResponse(
            access_token=token,
            role="admin",
            username=principal.get("sub"),
            full_name=principal.get("full_name") or "Administrator",
            pic_url=principal.get("pic_url"),
        )

    token = auth_service.create_access_token({
        "sub": principal.get("sub"),
        "role": role,
        "user_id": principal.get("user_id"),
        "manager_id": principal.get("manager_id"),
    })
    return LoginResponse(
        access_token=token,
        role=role,
        user_id=principal.get("user_id"),
        manager_id=principal.get("manager_id"),
        username=principal.get("sub"),
        full_name=principal.get("full_name"),
        pic_url=principal.get("pic_url"),
    )
