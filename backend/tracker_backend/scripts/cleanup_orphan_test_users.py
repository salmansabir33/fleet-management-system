"""Delete Phase-0 test users whose username matches orphan_%.

Dry-run (default) lists matching IDs. Pass --apply to delete via the
same cascade as DELETE /api/users/{id} (owned vehicle + Traccar cleanup).

Usage (from backend/):
  python -m tracker_backend.scripts.cleanup_orphan_test_users
  python -m tracker_backend.scripts.cleanup_orphan_test_users --apply
"""
from __future__ import annotations

import argparse
import asyncio
import sys

from tracker_backend.db import SessionLocal
from tracker_backend.models import User
from tracker_backend.services import user_service

ORPHAN_PREFIX = "orphan_"


def list_orphan_users(db) -> list[User]:
    return (
        db.query(User)
        .filter(User.username.like(f"{ORPHAN_PREFIX}%"))
        .order_by(User.id.asc())
        .all()
    )


async def apply_deletes(users: list[User]) -> tuple[int, list[str]]:
    deleted = 0
    errors: list[str] = []
    for user in users:
        db = SessionLocal()
        try:
            row = db.query(User).filter(User.id == user.id).first()
            if row is None:
                continue
            await user_service.delete_user_row(db, row)
            deleted += 1
            print(f"  deleted id={user.id} username={user.username!r}")
        except Exception as exc:  # noqa: BLE001 — script continues on per-row failure
            errors.append(f"id={user.id} username={user.username!r}: {exc}")
            print(f"  FAILED id={user.id} username={user.username!r}: {exc}", file=sys.stderr)
        finally:
            db.close()
    return deleted, errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Clean up orphan_% Phase-0 test users")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually delete matching users (default is dry-run)",
    )
    args = parser.parse_args(argv)

    db = SessionLocal()
    try:
        users = list_orphan_users(db)
    finally:
        db.close()

    if not users:
        print("No users matching orphan_% — nothing to do.")
        return 0

    print(f"Found {len(users)} user(s) matching orphan_%:")
    for u in users:
        print(f"  id={u.id} username={u.username!r} admin_id={u.admin_id}")

    if not args.apply:
        print("Dry-run only. Re-run with --apply to delete.")
        return 0

    deleted, errors = asyncio.run(apply_deletes(users))
    print(f"Deleted {deleted} user(s); errors={len(errors)}")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
