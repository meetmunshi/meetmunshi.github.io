"""Iter18 tests — Per-line disabled_activities (line -> [row_names]).

KEY assertion: disabling an activity on ONE line does NOT affect the SAME activity on another line.
"""
import os
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
DATE = "2026-08-19"
SHIFT = "day"


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _baseline(api):
    payload = {
        "date": DATE,
        "shift": SHIFT,
        "line_configs": [
            {"line": "X-Smart", "priority": 1, "run_count": 1},
            {"line": "E2", "priority": 2, "run_count": 1},
        ],
        "absent_person_ids": [],
        "disabled_activities": {},
    }
    r = api.post(f"{BASE_URL}/api/schedule", json=payload)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def baseline(api):
    return _baseline(api)


def _cells_for(sched, line, row_name):
    return [a for a in sched["assignments"] if a["line"] == line and a["row_name"] == row_name]


def _pick_shared_row(baseline):
    """Find a row_name that exists in BOTH X-Smart and E2 with required>0."""
    xs = {a["row_name"] for a in baseline["assignments"]
          if a["line"] == "X-Smart" and a["required"] > 0}
    e2 = {a["row_name"] for a in baseline["assignments"]
          if a["line"] == "E2" and a["required"] > 0}
    return sorted(xs & e2)


# ---------- POST /api/schedule with per-line disabled_activities ----------
def test_schedule_per_line_disabled_isolation(api, baseline):
    shared = _pick_shared_row(baseline)
    assert shared, f"need at least one shared row between lines: {shared}"
    row = shared[0]

    pre_xsmart_required = sum(a["required"] for a in _cells_for(baseline, "X-Smart", row))
    assert pre_xsmart_required > 0

    payload = {
        "date": DATE,
        "shift": SHIFT,
        "line_configs": [
            {"line": "X-Smart", "priority": 1, "run_count": 1},
            {"line": "E2", "priority": 2, "run_count": 1},
        ],
        "absent_person_ids": [],
        "disabled_activities": {"E2": [row]},
    }
    r = api.post(f"{BASE_URL}/api/schedule", json=payload)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["disabled_activities"].get("E2") == [row]

    # E2 row zeroed
    for a in _cells_for(data, "E2", row):
        assert a["required"] == 0
        assert a["shortage"] == 0
        assert a["assigned_person_ids"] == []

    # X-Smart same row UNCHANGED
    xsmart_cells = _cells_for(data, "X-Smart", row)
    assert xsmart_cells, "X-Smart cells for row should still exist"
    xsmart_required_after = sum(a["required"] for a in xsmart_cells)
    assert xsmart_required_after == pre_xsmart_required, (
        f"X-Smart {row} required changed: {pre_xsmart_required} -> {xsmart_required_after}"
    )


# ---------- Legacy field 'disabled_row_names' must be silently ignored ----------
def test_legacy_disabled_row_names_ignored(api):
    payload = {
        "date": DATE, "shift": SHIFT,
        "line_configs": [
            {"line": "X-Smart", "priority": 1, "run_count": 1},
            {"line": "E2", "priority": 2, "run_count": 1},
        ],
        "absent_person_ids": [],
        "disabled_row_names": ["testing"],   # legacy — should NOT globally disable
        "disabled_activities": {},
    }
    r = api.post(f"{BASE_URL}/api/schedule", json=payload)
    assert r.status_code == 200, r.text
    data = r.json()
    # Nothing should be disabled globally
    assert data.get("disabled_activities") in ({}, None)
    # No 'disabled_row_names' field on schedule (or empty)
    assert not data.get("disabled_row_names")
    # Testing row still has required>0 on at least one line
    testing_required = sum(a["required"] for a in data["assignments"]
                           if a["row_name"].lower() == "testing")
    assert testing_required > 0, "legacy field should not zero out cells"


# ---------- POST /schedule/{date}/set-disabled-activities ----------
def test_set_disabled_activities_per_line(api):
    # Fresh baseline
    _baseline(api)
    base = api.get(f"{BASE_URL}/api/schedule/{DATE}", params={"shift": SHIFT}).json()
    shared = _pick_shared_row(base)
    assert shared
    row = shared[0]

    pre_xsmart = _cells_for(base, "X-Smart", row)
    pre_xsmart_required = sum(a["required"] for a in pre_xsmart)
    pre_xsmart_assigned = [list(a["assigned_person_ids"]) for a in pre_xsmart]

    # Disable on E2 only
    r = api.post(f"{BASE_URL}/api/schedule/{DATE}/set-disabled-activities",
                 json={"shift": SHIFT, "disabled_activities": {"E2": [row]}})
    assert r.status_code == 200, r.text
    dis = r.json()
    assert dis["disabled_activities"].get("E2") == [row]

    # E2 cells zeroed & locked
    e2_cells = _cells_for(dis, "E2", row)
    assert e2_cells
    for a in e2_cells:
        assert a["required"] == 0
        assert a["shortage"] == 0
        assert a["assigned_person_ids"] == []
        key = f"{a['row_name']}||{a['line_key']}||{a['detail']}"
        assert key in dis.get("unassigned_keys", [])

    # X-Smart cells for same row UNCHANGED
    xsmart_after = _cells_for(dis, "X-Smart", row)
    assert sum(a["required"] for a in xsmart_after) == pre_xsmart_required
    assert [list(a["assigned_person_ids"]) for a in xsmart_after] == pre_xsmart_assigned

    # Re-enable E2 (empty list)
    r2 = api.post(f"{BASE_URL}/api/schedule/{DATE}/set-disabled-activities",
                  json={"shift": SHIFT, "disabled_activities": {}})
    assert r2.status_code == 200
    re = r2.json()
    assert not re.get("disabled_activities")
    e2_reen = _cells_for(re, "E2", row)
    for a in e2_reen:
        assert a["required"] > 0, "required should be restored from persons_required"
        key = f"{a['row_name']}||{a['line_key']}||{a['detail']}"
        assert key not in re.get("unassigned_keys", [])


def test_set_disabled_activities_404(api):
    r = api.post(f"{BASE_URL}/api/schedule/1999-01-01/set-disabled-activities",
                 json={"shift": "day", "disabled_activities": {}})
    assert r.status_code == 404


# ---------- Regression ----------
def test_regression_fill_shortages_preview(api, baseline):
    r = api.post(f"{BASE_URL}/api/schedule/{DATE}/fill-shortages",
                 params={"shift": SHIFT, "preview": True})
    assert r.status_code == 200
    assert r.json().get("preview") is True


def test_regression_suggest_line(api, baseline):
    r = api.get(f"{BASE_URL}/api/schedule/{DATE}/suggest-line", params={"shift": SHIFT})
    assert r.status_code == 200
    d = r.json()
    assert "suggestions" in d and "unassigned_pool_size" in d


def test_regression_areas_endpoint(api):
    r = api.get(f"{BASE_URL}/api/areas")
    assert r.status_code == 200
    assert isinstance(r.json().get("areas"), list)
