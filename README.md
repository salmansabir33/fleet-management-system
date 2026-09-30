# Fleet Tracker

GPS fleet tracking web app: FastAPI backend wrapping a Traccar server, plus a React/Vite frontend for admin, manager, and driver views.

## Stack

- **Backend:** Python 3.12+, FastAPI, SQLAlchemy, Alembic, MySQL, Poetry
- **Frontend:** React, Vite
- **External:** Traccar GPS server, OpenRouteService, MapTiler / Mapbox maps

## Backend setup

```bash
cd backend
poetry install --no-root
copy .env.example .env   # or: cp .env.example .env
```

Edit `.env` with your real values. Generate `PASSWORD_ENC_KEY`:

```bash
poetry run python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Apply migrations and start the API:

```bash
poetry run alembic upgrade head
poetry run uvicorn tracker_backend.main:app --reload
```

## Frontend setup

```bash
cd frontend
npm install
copy .env.example .env   # or: cp .env.example .env
```

Set `VITE_MAPTILER_KEY` (and optionally `VITE_MAPBOX_TOKEN`), then:

```bash
npm run dev
```

Leave `VITE_API_BASE_URL` empty for local dev and for same-origin deploys (DigitalOcean serving UI + API together).

## Hostinger frontend → DigitalOcean API

When the static UI is on Hostinger and the API is on DigitalOcean:

1. In `frontend`, copy `.env.production.example` to `.env.production` and set:
   - `VITE_API_BASE_URL` to the DigitalOcean origin (e.g. `http://168.144.183.130`)
   - real MapTiler / Mapbox keys
2. Build and upload **only** `dist/` to Hostinger:

```bash
cd frontend
npm run build
```

3. On the DigitalOcean backend `.env`, set CORS to your Hostinger origin (comma-separated if you also keep the DO UI origin):

```env
FRONTEND_URL=https://your-hostinger-domain.com,http://168.144.183.130
```

Restart the API after changing `FRONTEND_URL`. Do not replace the DigitalOcean-served frontend unless you intend to.

## Local-only files (not in git)

- `backend/uploads/` — user-uploaded photos and license scans (directory is kept via `.gitkeep`)
- `*.sql` DB dumps — intentionally ignored

**Never commit `.env` files.** Use `.env.example` as the template only.
