"""Seed the single Super Admin from env (idempotent).

Reads SUPER_ADMIN_USERNAME and SUPER_ADMIN_PASSWORD from the environment.
Does nothing if a super_admins row already exists. No default password.

Usage (from backend/):
  set SUPER_ADMIN_USERNAME=...
  set SUPER_ADMIN_PASSWORD=...
  python -m tracker_backend.scripts.seed_super_admin
"""
from __future__ import annotations

import os
import sys

from tracker_backend.db import SessionLocal
from tracker_backend.models import SuperAdmin
from tracker_backend.services.auth_service import hash_password


def main() -> int:
    username = (os.environ.get("SUPER_ADMIN_USERNAME") or "").strip()
    password = os.environ.get("SUPER_ADMIN_PASSWORD") or ""
    if not username or not password:
        print(
            "SUPER_ADMIN_USERNAME and SUPER_ADMIN_PASSWORD must both be set.",
            file=sys.stderr,
        )
        return 1

    db = SessionLocal()
    try:
        existing = db.query(SuperAdmin).first()
        if existing is not None:
            print(f"Super Admin already exists (id={existing.id}); nothing to do.")
            return 0

        row = SuperAdmin(
            username=username,
            password_hash=hash_password(password),
            full_name=os.environ.get("SUPER_ADMIN_FULL_NAME") or "Super Admin",
            phone=os.environ.get("SUPER_ADMIN_PHONE") or None,
            is_active=True,
            singleton_key=1,
        )
        db.add(row)
        db.commit()
        print(f"Created Super Admin id={row.id} username={row.username!r}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
