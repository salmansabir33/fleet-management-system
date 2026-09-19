"""File upload helper for driver photos/license scans.

Saves under UPLOAD_ROOT (backend/uploads/) and returns a path relative
to it, e.g. "drivers/photo/<uuid>.jpg" — that relative path is what
gets stored on the Driver row, and is served back at
"/uploads/<that path>" once main.py mounts UPLOAD_ROOT as static files.
"""
import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile

# backend/tracker_backend/services/uploads.py -> backend/uploads
UPLOAD_ROOT = Path(__file__).resolve().parent.parent.parent / "uploads"

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
MAX_UPLOAD_BYTES = 5 * 1024 * 1024  # 5 MB


async def save_upload(file: UploadFile, subfolder: str) -> str:
    """Validates and saves an uploaded image under uploads/<subfolder>/.

    Returns the path relative to UPLOAD_ROOT (forward slashes), suitable
    for storing in the DB and for building a /uploads/<path> URL.
    """
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported image type '{ext or '(none)'}'. Use jpg, jpeg, png, or webp.",
        )

    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    if len(contents) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="Image too large (max 5MB)")

    target_dir = UPLOAD_ROOT / subfolder
    target_dir.mkdir(parents=True, exist_ok=True)

    filename = f"{uuid.uuid4().hex}{ext}"
    target_path = target_dir / filename
    with open(target_path, "wb") as f:
        f.write(contents)

    return f"{subfolder}/{filename}"


def delete_upload(relative_path: str | None) -> None:
    """Best-effort delete of a previously-saved upload (e.g. when a
    driver's picture is replaced or the driver is deleted). Never
    raises — a missing file on disk shouldn't block the DB operation.
    """
    if not relative_path:
        return
    full_path = UPLOAD_ROOT / relative_path
    try:
        if full_path.exists() and full_path.is_file():
            full_path.unlink()
    except OSError:
        pass