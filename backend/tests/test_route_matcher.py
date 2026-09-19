"""
Unit tests for route corridor distance and slice-scan performance in
route_matcher.py.

Covers the long-straight-segment case where a GPS fix sits mid-span between
two far-apart route vertices: vertex-only distance would be kilometers off,
but point-to-segment distance should be near zero.

Also verifies that the deferred-deviation optimization in
_scan_route_slice_candidates produces an identical selected match to the
previous per-candidate deviation-building algorithm, and finishes quickly
on mostly on-route trips with 1000+ points.

Run with: python -m pytest tests/test_route_matcher.py
(from the `backend` folder)
"""

from __future__ import annotations

import time
from types import SimpleNamespace

from tracker_backend.services.position_writer import haversine_meters
from tracker_backend.services.route_matcher import (
    LENGTH_PREFERENCE_MARGIN_PERCENT,
    ROUTE_MATCH_THRESHOLD_PERCENT,
    RouteSliceMatch,
    _build_deviation_segments,
    _build_route_status_segments,
    _point_within_flags,
    _route_segment_distance_meters,
    _scan_route_slice_candidates,
    _select_best_slice_from_candidates,
    classify_trip_route_status,
)


def _point(lat: float, lon: float) -> SimpleNamespace:
    return SimpleNamespace(lat=lat, lon=lon)


def _route(path: list[dict], tolerance_meters: float = 100.0) -> SimpleNamespace:
    return SimpleNamespace(path=path, tolerance_meters=tolerance_meters)


def test_mid_segment_point_within_tolerance():
    """GPS on a long straight highway stretch must count as on-route.

    Two vertices ~9.5 km apart at the same latitude; the midpoint is ~0 m
    from the polyline but ~4.7 km from the nearest vertex.
    """
    route_path = [
        {"lat": 31.0, "lon": 74.0},
        {"lat": 31.0, "lon": 74.1},
    ]
    mid = _point(31.0, 74.05)
    tolerance_m = 100.0

    vertex_only = min(
        haversine_meters(mid.lat, mid.lon, v["lat"], v["lon"]) for v in route_path
    )
    assert vertex_only > tolerance_m, (
        "precondition: vertex-only distance must exceed tolerance "
        f"(got {vertex_only:.1f} m)"
    )

    segment_dist = _route_segment_distance_meters(mid, route_path)
    assert segment_dist <= tolerance_m, (
        f"mid-segment point should be within tolerance; got {segment_dist:.1f} m"
    )
    assert segment_dist < 5.0, (
        f"mid-segment distance should be near zero; got {segment_dist:.1f} m"
    )


def test_point_far_off_route_exceeds_tolerance():
    route_path = [
        {"lat": 31.0, "lon": 74.0},
        {"lat": 31.0, "lon": 74.1},
    ]
    # ~1 km north of the east-west segment midpoint
    off = _point(31.009, 74.05)
    dist = _route_segment_distance_meters(off, route_path)
    assert dist > 100.0


def test_single_vertex_falls_back_to_point_distance():
    route_path = [{"lat": 31.0, "lon": 74.0}]
    point = _point(31.001, 74.0)
    expected = haversine_meters(point.lat, point.lon, 31.0, 74.0)
    assert abs(_route_segment_distance_meters(point, route_path) - expected) < 1.0


def test_empty_path_is_infinite():
    assert _route_segment_distance_meters(_point(31.0, 74.0), []) == float("inf")


# ─── Deferred deviation build: equivalence + speedup ──────────────────────────


def _scan_all_candidates_naive(
    trip_positions: list,
    route,
) -> list[RouteSliceMatch]:
    """Pre-optimization reference: builds deviation_segments for every window."""
    if len(trip_positions) < 2:
        return []

    route_path = route.path or []
    within_flags = [
        _route_segment_distance_meters(position, route_path) <= route.tolerance_meters
        for position in trip_positions
    ]

    candidates: list[RouteSliceMatch] = []
    last_index = len(trip_positions) - 1

    for start_index in range(last_index):
        for end_index in range(start_index + 1, len(trip_positions)):
            window_flags = within_flags[start_index:end_index + 1]
            within_count = sum(1 for flag in window_flags if flag)
            match_percent = round((within_count / len(window_flags)) * 100, 2)
            if match_percent < ROUTE_MATCH_THRESHOLD_PERCENT:
                continue
            candidates.append(RouteSliceMatch(
                start_index=start_index,
                end_index=end_index,
                match_percent=match_percent,
                deviation_segments=_build_deviation_segments(window_flags, start_index),
            ))

    return candidates


def _select_best_match_naive(trip_positions: list, route) -> RouteSliceMatch | None:
    """Old two-step path: materialize all candidates, then pick the winner."""
    candidates = _scan_all_candidates_naive(trip_positions, route)
    if not candidates:
        return None

    best_score = max(c.match_percent for c in candidates)
    close_enough = [
        c for c in candidates
        if best_score - c.match_percent <= LENGTH_PREFERENCE_MARGIN_PERCENT
    ]
    best_match = max(close_enough, key=lambda c: c.end_index - c.start_index)
    if best_match.match_percent < ROUTE_MATCH_THRESHOLD_PERCENT:
        return None
    return best_match


def _match_tuple(c: RouteSliceMatch | None) -> tuple | None:
    if c is None:
        return None
    return (
        c.start_index,
        c.end_index,
        c.match_percent,
        tuple(
            (seg["start_index"], seg["end_index"])
            for seg in c.deviation_segments
        ),
    )


def _eastbound_positions(n: int, *, off_every: int | None = None) -> list:
    """n GPS fixes along lon 74.0→74.1 at lat=31.0 (on a straight highway).

    If off_every is set, every Nth point is nudged ~1 km north (off-route)
    so the candidate set includes partial matches and deviation segments.
    """
    positions = []
    for i in range(n):
        lon = 74.0 + (0.1 * i / max(n - 1, 1))
        lat = 31.009 if (off_every and i % off_every == 0) else 31.0
        positions.append(_point(lat, lon))
    return positions


HIGHWAY_ROUTE = _route(
    [{"lat": 31.0, "lon": 74.0}, {"lat": 31.0, "lon": 74.1}],
    tolerance_meters=100.0,
)


def test_selected_match_identical_fully_on_route():
    """Fully on-route trip: selected window must match the old algorithm."""
    positions = _eastbound_positions(30)
    optimized = _scan_route_slice_candidates(positions, HIGHWAY_ROUTE)
    naive = _select_best_match_naive(positions, HIGHWAY_ROUTE)

    assert optimized is not None, "precondition: fully on-route must match"
    assert _match_tuple(optimized) == _match_tuple(naive)
    assert optimized.deviation_segments == []
    assert optimized.start_index == 0
    assert optimized.end_index == len(positions) - 1


def test_selected_match_identical_one_deviation_gap():
    """One contiguous off-route gap: selected match + segments must match."""
    # Indices 10–14 off-route; rest on-route.
    positions = []
    for i in range(40):
        lon = 74.0 + (0.1 * i / 39)
        lat = 31.009 if 10 <= i <= 14 else 31.0
        positions.append(_point(lat, lon))

    optimized = _scan_route_slice_candidates(positions, HIGHWAY_ROUTE)
    naive = _select_best_match_naive(positions, HIGHWAY_ROUTE)

    assert optimized is not None
    assert _match_tuple(optimized) == _match_tuple(naive)
    assert len(optimized.deviation_segments) >= 1


def test_selected_match_identical_multiple_deviation_gaps():
    """Multiple deviation gaps: selected match + segments must match.

    Two single-point gaps (~95% on-route overall) so the longest
    near-best window still covers both gaps — otherwise length
    preference can pick a short perfect slice with only one gap.
    """
    positions = []
    for i in range(40):
        lon = 74.0 + (0.1 * i / 39)
        lat = 31.009 if i in (10, 25) else 31.0
        positions.append(_point(lat, lon))

    optimized = _scan_route_slice_candidates(positions, HIGHWAY_ROUTE)
    naive = _select_best_match_naive(positions, HIGHWAY_ROUTE)

    assert optimized is not None, "precondition: fixture must produce a match"
    assert _match_tuple(optimized) == _match_tuple(naive)
    assert len(optimized.deviation_segments) >= 2


def test_select_best_slice_helper_matches_legacy_rule():
    """Lightweight tuple selection mirrors the old RouteSliceMatch selection."""
    candidates = [
        (0, 5, 95.0),
        (0, 10, 93.0),  # longer, within 8% of best (100) → should win
        (2, 4, 100.0),  # best score but short
    ]
    best = _select_best_slice_from_candidates(candidates)
    assert best == (0, 10, 93.0)


def test_scan_returns_none_when_nothing_clears_threshold():
    """All points far off-route → no match."""
    positions = [_point(32.0, 75.0 + 0.01 * i) for i in range(10)]
    assert _scan_route_slice_candidates(positions, HIGHWAY_ROUTE) is None
    assert _select_best_match_naive(positions, HIGHWAY_ROUTE) is None


def test_scan_mostly_on_route_speedup():
    """Mostly on-route 1000+ point trip must finish in a few seconds.

    This is the realistic case the prior prefix-sum-only fix missed: ~80%+
    of points within tolerance so nearly all O(n²) windows clear the 60%
    threshold. Building deviation_segments for each accepted window made
    the cost near-O(n³); deferring that work to the single winner keeps
    total cost at O(n²) + one O(n) build.
    """
    n = 1200
    # Every 5th point off-route → 80% on-route (majority clear threshold).
    positions = _eastbound_positions(n, off_every=5)

    t0 = time.perf_counter()
    optimized = _scan_route_slice_candidates(positions, HIGHWAY_ROUTE)
    t_opt = time.perf_counter() - t0

    assert t_opt < 5.0, (
        f"mostly-on-route scan on n={n} took {t_opt:.3f}s; expected <5s "
        f"(possible per-candidate deviation-build regression)"
    )
    assert optimized is not None
    assert isinstance(optimized, RouteSliceMatch)
    assert optimized.end_index >= optimized.start_index

    # Parity on a smaller cut of the same pattern (full naive @ n=1200 is
    # intentionally not timed here — that is the bug we fixed).
    sample = positions[:60]
    assert _match_tuple(_scan_route_slice_candidates(sample, HIGHWAY_ROUTE)) == (
        _match_tuple(_select_best_match_naive(sample, HIGHWAY_ROUTE))
    ), "speedup path must not change the selected match"


def test_scan_prefix_sum_still_fast_on_sparse_on_route():
    """Alternate on/off (~50%): few windows clear threshold; still fast."""
    n = 1200
    positions = []
    for i in range(n):
        lon = 74.0 + (0.1 * i / (n - 1))
        lat = 31.0 if i % 2 == 0 else 31.009
        positions.append(_point(lat, lon))

    t0 = time.perf_counter()
    optimized = _scan_route_slice_candidates(positions, HIGHWAY_ROUTE)
    t_opt = time.perf_counter() - t0

    assert t_opt < 5.0, (
        f"sparse on-route scan on n={n} took {t_opt:.3f}s; expected <5s"
    )
    # Result may be None or a short high-scoring slice; just ensure it runs.
    assert optimized is None or isinstance(optimized, RouteSliceMatch)


# ─── Full-trip route_status_segments (rendering only) ─────────────────────────


def _clip_off_route_to_window(
    status_segments: list[dict],
    start_index: int,
    end_index: int,
) -> list[dict]:
    """Off-route status runs clipped to a matched-leg window (may split a straddle)."""
    clipped: list[dict] = []
    for seg in status_segments:
        if seg["on_route"]:
            continue
        lo = max(seg["start_index"], start_index)
        hi = min(seg["end_index"], end_index)
        if lo <= hi:
            clipped.append({"start_index": lo, "end_index": hi})
    return clipped


def test_build_route_status_segments_empty():
    assert _build_route_status_segments([]) == []


def test_build_route_status_segments_contiguous_runs():
    flags = [True, True, False, False, False, True]
    assert _build_route_status_segments(flags) == [
        {"start_index": 0, "end_index": 1, "on_route": True},
        {"start_index": 2, "end_index": 4, "on_route": False},
        {"start_index": 5, "end_index": 5, "on_route": True},
    ]


def test_status_off_route_runs_inside_window_match_deviation_segments():
    """Inside the winning window, on_route:false runs == stored deviation_segments.

    Same flags and same tolerance; only the window vs full-trip span differs.
    """
    positions = []
    for i in range(40):
        lon = 74.0 + (0.1 * i / 39)
        lat = 31.009 if 10 <= i <= 14 else 31.0
        positions.append(_point(lat, lon))

    match = _scan_route_slice_candidates(positions, HIGHWAY_ROUTE)
    assert match is not None

    status = classify_trip_route_status(positions, HIGHWAY_ROUTE)
    assert _clip_off_route_to_window(
        status, match.start_index, match.end_index,
    ) == match.deviation_segments
    # Full-trip classification keeps the whole off-route run even if length
    # preference starts the winning window partway through it.
    assert {"start_index": 10, "end_index": 14, "on_route": False} in status
    assert match.deviation_segments


def test_status_segments_cover_points_outside_winning_window():
    """Prefix off-route points are classified even when the matched leg starts later.

    First 15 points ~1 km off the highway, remaining 40 on-route. Length
    preference may pull a few prefix points into the window; status
    segments must still cover the excluded prefix as on_route:false.
    """
    positions = []
    for i in range(55):
        lon = 74.0 + (0.1 * i / 54)
        lat = 31.009 if i < 15 else 31.0
        positions.append(_point(lat, lon))

    match = _scan_route_slice_candidates(positions, HIGHWAY_ROUTE)
    assert match is not None
    assert match.start_index > 0, "expected winning window to skip some off-route prefix"

    status = classify_trip_route_status(positions, HIGHWAY_ROUTE)
    assert status[0] == {"start_index": 0, "end_index": 14, "on_route": False}
    assert status[0]["end_index"] >= match.start_index - 1
    assert status[-1]["on_route"] is True
    assert status[-1]["end_index"] == len(positions) - 1
    assert _clip_off_route_to_window(
        status, match.start_index, match.end_index,
    ) == match.deviation_segments


def test_classify_reuses_same_within_flags_as_matcher():
    positions = _eastbound_positions(20, off_every=4)
    flags = _point_within_flags(positions, HIGHWAY_ROUTE)
    assert classify_trip_route_status(positions, HIGHWAY_ROUTE) == (
        _build_route_status_segments(flags)
    )


def test_point_within_flags_bbox_matches_naive_dense_path():
    """Bbox culling must match a full segment scan on a dense ORS-like path."""
    # Dense eastbound polyline (~800 segments over 0.1° lon).
    route_path = [
        {"lat": 31.0, "lon": 74.0 + (0.1 * i / 800)}
        for i in range(801)
    ]
    route = _route(route_path, tolerance_meters=100.0)
    positions = []
    for i in range(120):
        lon = 74.0 + (0.1 * i / 119)
        # Mix on-route, mid-corridor, and clearly off-route points.
        if i % 7 == 0:
            lat = 31.009
        elif i % 5 == 0:
            lat = 31.0004
        else:
            lat = 31.0
        positions.append(_point(lat, lon))

    naive = [
        _route_segment_distance_meters(p, route_path) <= route.tolerance_meters
        for p in positions
    ]
    fast = _point_within_flags(positions, route)
    assert fast == naive

    started = time.perf_counter()
    _point_within_flags(positions, route)
    elapsed = time.perf_counter() - started
    assert elapsed < 1.0, f"bbox corridor check too slow: {elapsed:.3f}s"
