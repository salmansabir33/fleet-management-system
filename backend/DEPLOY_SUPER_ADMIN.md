# Deploy notes — Multi-admin tenancy + Super Admin

Order of operations (maintenance window). Rehearse on a **copy** of production DB first.

1. **Stop the app** (uvicorn / systemd / docker) so nothing writes during migrate.

2. **Backup**
   ```bash
   mysqldump -u <user> -p --single-transaction --routines --triggers fleet_tracker > fleet_tracker_backup_YYYYMMDD.sql
   ```

3. **Migrate** (from `backend/`, with `.env` so `ADMIN_*` backfill works on fresh DBs)
   ```bash
   alembic upgrade head
   ```

4. **Seed Super Admin** if needed (idempotent; set env vars in the shell — not required in Settings/.env unless optional fields are added)
   ```powershell
   $env:SUPER_ADMIN_USERNAME="..."
   $env:SUPER_ADMIN_PASSWORD="..."
   python -m tracker_backend.scripts.seed_super_admin
   ```

5. **Start new backend**, then **deploy frontend** together. Old JWTs without `admin_id` / `super_admin_id` are rejected.

6. **Verify**
   ```bash
   python -m pytest tests/test_tenancy_isolation.py tests/test_phase0_global_mode.py tests/test_auth_route_sweep.py -q
   ```
   Smoke: `/admin/login` as Super Admin → `/super-admin`; Admin 1 → `/admin`; manager/user `/login` unchanged.

7. **Cleanup**: remove `ADMIN_PASSWORD` from production env once DB admin login is confirmed.

**Known:** `/uploads` is served without login (static). OpenAPI `/docs` may be public in dev — disable in production if desired.

**Vehicle–user pairing:** Traccar ingest may create local `Device` rows with null `user_id` / `admin_id` (quarantine). Claim them via Super Admin → Unassigned (`POST /api/super-admin/devices/{id}/assign`) or fleet Edit vehicle claim (`POST /api/fleet/devices/{id}/claim`). To remove Phase-0 orphan test users (`orphan_%`):

```bash
python -m tracker_backend.scripts.cleanup_orphan_test_users --apply
```

Rollback: restore the mysqldump, redeploy previous backend/frontend.
