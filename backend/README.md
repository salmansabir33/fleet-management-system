# Traccar Backend

FastAPI wrapper around a Traccar GPS tracking server.

## Setup
1. Copy `.env.example` to `.env` and fill in your real Traccar credentials.
2. Install dependencies: `poetry install --no-root`
3. Run: `poetry run uvicorn tracker_backend.main:app --reload`