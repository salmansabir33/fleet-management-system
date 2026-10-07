from datetime import date, datetime, timedelta

from sqlalchemy import or_
from sqlalchemy.orm import Session

from tracker_backend.models import FuelPrice


def _as_date(value) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


def _tenant_lane_filter(admin_id: int | None):
    """Restrict queries to one price lane (global or one fleet)."""
    if admin_id is None:
        return FuelPrice.admin_id.is_(None)
    return FuelPrice.admin_id == admin_id


def upsert_fuel_price_with_reflow(
    db: Session,
    fuel_type_id: int,
    price_per_liter: float,
    start_date: date,
    admin_id: int | None = None,
) -> FuelPrice:
    """Implements the RULE FOR ADDING/UPDATING A PRICE.

    - If a row already exists with that exact (fuel_type_id, start_date):
      just update its price_per_liter. Do NOT touch its start/end dates or
      any other row — a price correction on an existing date doesn't change
      the shape of the timeline.
    - Otherwise (this is a new date not seen before for this fuel_type_id):
      1. Find prev_row: the row with the largest effective_date_start that
         is STILL LESS THAN start_date (or None if none exists).
      2. Find next_row: the row with the smallest effective_date_start that
         is GREATER THAN start_date (or None if none exists).
      3. Create the new row with:
         - effective_date_start = start_date
         - effective_date_end = (next_row.effective_date_start - 1 day) if
           next_row exists, else None
      4. If prev_row exists, update prev_row.effective_date_end =
         start_date - 1 day (closes the previous row's range right before
         the new one begins — NO shared boundary day, no overlap).

    Returns the resulting row (the existing updated row, or the newly
    created row). Commits the session before returning.
    """
    start_date = _as_date(start_date)
    lane = _tenant_lane_filter(admin_id)

    # 1. Exact (fuel_type_id, start_date) match → price correction only.
    existing = (
        db.query(FuelPrice)
        .filter(
            FuelPrice.fuel_type_id == fuel_type_id,
            FuelPrice.effective_date_start == start_date,
            lane,
        )
        .first()
    )
    if existing:
        existing.price_per_liter = price_per_liter
        db.commit()
        db.refresh(existing)
        return existing

    # 2. New date — find the neighbouring rows that bracket start_date.
    prev_row = (
        db.query(FuelPrice)
        .filter(
            FuelPrice.fuel_type_id == fuel_type_id,
            FuelPrice.effective_date_start < start_date,
            lane,
        )
        .order_by(FuelPrice.effective_date_start.desc())
        .first()
    )

    next_row = (
        db.query(FuelPrice)
        .filter(
            FuelPrice.fuel_type_id == fuel_type_id,
            FuelPrice.effective_date_start > start_date,
            lane,
        )
        .order_by(FuelPrice.effective_date_start.asc())
        .first()
    )

    # 3. Create the new row. Its end is the day before next_row starts
    #    (so the two ranges are contiguous with no overlap), or NULL when
    #    there is no newer price yet.
    new_end = next_row.effective_date_start - timedelta(days=1) if next_row else None
    new_row = FuelPrice(
        fuel_type_id=fuel_type_id,
        price_per_liter=price_per_liter,
        effective_date_start=start_date,
        effective_date_end=new_end,
        admin_id=admin_id,
    )
    db.add(new_row)

    # 4. Close the previous row's range right before the new one begins.
    if prev_row:
        prev_row.effective_date_end = start_date - timedelta(days=1)

    db.commit()
    db.refresh(new_row)
    return new_row


def delete_fuel_price_with_reflow(db: Session, price_id: int) -> bool:
    """Implements the RULE FOR DELETING.

    1. Find prev_row and next_row around the row being deleted (based on
       the deleted row's effective_date_start).
    2. If prev_row exists: set prev_row.effective_date_end = the DELETED
       row's effective_date_end (prev_row absorbs the gap left behind — it
       now covers what the deleted row used to cover, right up to wherever
       next_row begins, or NULL/open if there was no next_row).
    3. If prev_row does NOT exist (deleted row was the earliest for this
       fuel type), no absorption happens — next_row (if any) simply becomes
       the new earliest row, its own start/end untouched.
    4. Delete the row.

    Returns True if a row was found and deleted, False if price_id didn't
    exist. Commits the session.
    """
    row = db.query(FuelPrice).filter(FuelPrice.id == price_id).first()
    if not row:
        return False

    lane = _tenant_lane_filter(row.admin_id)

    # 1. Find the neighbours of the row being deleted.
    prev_row = (
        db.query(FuelPrice)
        .filter(
            FuelPrice.fuel_type_id == row.fuel_type_id,
            FuelPrice.effective_date_start < row.effective_date_start,
            lane,
        )
        .order_by(FuelPrice.effective_date_start.desc())
        .first()
    )

    next_row = (
        db.query(FuelPrice)
        .filter(
            FuelPrice.fuel_type_id == row.fuel_type_id,
            FuelPrice.effective_date_start > row.effective_date_start,
            lane,
        )
        .order_by(FuelPrice.effective_date_start.asc())
        .first()
    )

    # 2. prev_row absorbs the deleted row's range. (next_row is left
    #    untouched in all cases — its own start/end stay as they were.)
    if prev_row:
        prev_row.effective_date_end = row.effective_date_end

    # 3. & 4. Remove the row.
    db.delete(row)
    db.commit()
    return True


def _price_row_for_lane(
    db: Session, fuel_type_id: int, on_date: date, admin_id: int | None
):
    return (
        db.query(FuelPrice)
        .filter(
            FuelPrice.fuel_type_id == fuel_type_id,
            FuelPrice.effective_date_start <= on_date,
            (FuelPrice.effective_date_end.is_(None))
            | (FuelPrice.effective_date_end >= on_date),
            _tenant_lane_filter(admin_id),
        )
        .order_by(FuelPrice.effective_date_start.desc())
        .first()
    )


def get_applicable_fuel_price(
    db: Session, fuel_type_id: int, on_date: date, admin_id: int | None = None
) -> float | None:
    """Returns the price_per_liter whose [effective_date_start,
    effective_date_end] range covers on_date for the given fuel type
    (NULL end means "currently active, no newer price yet"). Returns
    None if no price exists at all yet for this fuel type."""
    if fuel_type_id is None:
        return None
    if admin_id is not None:
        price_row = _price_row_for_lane(db, fuel_type_id, on_date, admin_id)
        if price_row is not None:
            return price_row.price_per_liter
    price_row = _price_row_for_lane(db, fuel_type_id, on_date, None)
    return price_row.price_per_liter if price_row else None


def get_applicable_fuel_price_row(
    db: Session, fuel_type_id: int, on_date: date, admin_id: int | None = None
):
    """Same lookup as get_applicable_fuel_price but returns the full row
    (or None), used where the effective_date_start of the price actually
    used needs to be reported back, not just the number."""
    if fuel_type_id is None:
        return None
    if admin_id is not None:
        row = _price_row_for_lane(db, fuel_type_id, on_date, admin_id)
        if row is not None:
            return row
    return _price_row_for_lane(db, fuel_type_id, on_date, None)
