"""Iter17 tests — Areas selection (disabled_row_names) + set-disabled-areas endpoint."""
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


@pytest.fixture(scope="module")
def baseline(api):
    """Regenerate a clean baseline schedule (no disabled areas)."""
    payload = {
        "date": DATE,
        "shift": SHIFT,
        "line_configs": [
            {"line": "X-Smart", "priority": 1, "run_count": 1},
            {"line": "E2", "priority": 2, "run_count": 1},
        ],
        "absent_person_ids": [],
        "disabled_row_names": [],
    }
    r = api.post(f"{BASE_URL}/api/schedule", json=payload)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- GET /api/areas ----------
def test_areas_endpoint(api):
    r = api.get(f"{BASE_URL}/api/areas")
    assert r.status_code == 200
    data = r.json()
    assert "areas" in data
    areas = data["areas"]
    assert isinstance(areas, list)
    assert len(areas) >= 10, f"expected many areas, got {len(areas)}"
    lowered = [a.lower() for a in areas]
    # Expect common areas mentioned in the request
    assert any("frame" in a for a in lowered), areas
    assert any("assembly" in a for a in lowered), areas
    assert any("testing" in a for a in lowered), areas


# ---------- POST /api/schedule with disabled_row_names ----------
def test_schedule_disabled_row_names_zero_required(api, baseline):
    areas_resp = api.get(f"{BASE_URL}/api/areas").json()
    all_areas = areas_resp["areas"]
    # Pick a row name that actually exists in baseline assignments
    row_names_in = {a["row_name"] for a in baseline["assignments"]}
    disable = next((r for r in all_areas if r in row_names_in), None)
    assert disable, f"no overlap between areas and schedule rows: {row_names_in}"

    payload = {
        "date": DATE,
        "shift": SHIFT,
        "line_configs": [
            {"line": "X-Smart", "priority": 1, "run_count": 1},
            {"line": "E2", "priority": 2, "run_count": 1},
        ],
        "absent_person_ids": [],
        "disabled_row_names": [disable],
    }
    r = api.post(f"{BASE_URL}/api/schedule", json=payload)
    assert r.status_code == 200
    data = r.json()
    assert disable in data["disabled_row_names"]
    for a in data["assignments"]:
        if a["row_name"] == disable:
            assert a["required"] == 0
            assert a["shortage"] == 0
            assert a["assigned_person_ids"] == []


# ---------- POST /api/schedule/{date}/set-disabled-areas — disable then re-enable ----------
def test_set_disabled_areas_toggle(api, baseline):
    # 1. Start clean baseline again
    api.post(f"{BASE_URL}/api/schedule", json={
        "date": DATE, "shift": SHIFT,
        "line_configs": [
            {"line": "X-Smart", "priority": 1, "run_count": 1},
            {"line": "E2", "priority": 2, "run_count": 1},
        ],
        "absent_person_ids": [], "disabled_row_names": [],
    })

    base = api.get(f"{BASE_URL}/api/schedule/{DATE}", params={"shift": SHIFT}).json()
    row_names_in = list({a["row_name"] for a in base["assignments"]
                         if a["required"] > 0 and a["assigned_person_ids"]})
    assert row_names_in, "no assigned rows in baseline"
    disable = row_names_in[0]

    # capture pre-disable state for target row
    pre_row_cells = [a for a in base["assignments"] if a["row_name"] == disable]
    pre_assigned_ids = {pid for a in pre_row_cells for pid in a["assigned_person_ids"]}
    pre_total_required = base["total_required"]

    # 2. Disable it
    r = api.post(f"{BASE_URL}/api/schedule/{DATE}/set-disabled-areas",
                 json={"shift": SHIFT, "disabled_row_names": [disable]})
    assert r.status_code == 200, r.text
    dis = r.json()
    assert disable in dis["disabled_row_names"]
    # Cells zeroed
    disabled_cells = [a for a in dis["assignments"] if a["row_name"] == disable]
    assert len(disabled_cells) == len(pre_row_cells)
    for a in disabled_cells:
        assert a["required"] == 0
        assert a["shortage"] == 0
        assert a["assigned_person_ids"] == []
    # totals recomputed
    assert dis["total_required"] < pre_total_required
    assert dis["total_assigned"] == sum(len(a["assigned_person_ids"]) for a in dis["assignments"])
    assert dis["total_shortage"] == sum(a["shortage"] for a in dis["assignments"])
    # Freed associates land in unassigned pool: they should not appear in any cell
    all_assigned = {pid for a in dis["assignments"] for pid in a["assigned_person_ids"]}
    freed = pre_assigned_ids - all_assigned
    assert len(freed) > 0, "expected some associates freed"
    # And they're not absent either
    absent_set = set(dis.get("absent_person_ids", []))
    assert freed.isdisjoint(absent_set)

    # 3. Re-enable — required restored, cell unlocked
    r2 = api.post(f"{BASE_URL}/api/schedule/{DATE}/set-disabled-areas",
                  json={"shift": SHIFT, "disabled_row_names": []})
    assert r2.status_code == 200
    re = r2.json()
    assert disable not in re["disabled_row_names"]
    reen_cells = [a for a in re["assignments"] if a["row_name"] == disable]
    # Required restored to base (>0)
    for a in reen_cells:
        assert a["required"] > 0
    # And keys removed from unassigned_keys so cell is unlocked
    for a in reen_cells:
        key = f"{a['row_name']}||{a['line_key']}||{a['detail']}"
        assert key not in re.get("unassigned_keys", [])


def test_set_disabled_areas_404(api):
    r = api.post(f"{BASE_URL}/api/schedule/1999-01-01/set-disabled-areas",
                 json={"shift": "day", "disabled_row_names": []})
    assert r.status_code == 404


# ---------- Regression: existing endpoints still work ----------
def test_regression_suggest_line_still_works(api, baseline):
    r = api.get(f"{BASE_URL}/api/schedule/{DATE}/suggest-line", params={"shift": SHIFT})
    assert r.status_code == 200
    d = r.json()
    assert "suggestions" in d and "unassigned_pool_size" in d


def test_regression_fill_shortages_preview(api, baseline):
    r = api.post(f"{BASE_URL}/api/schedule/{DATE}/fill-shortages",
                 params={"shift": SHIFT, "preview": True})
    assert r.status_code == 200
    d = r.json()
    assert d.get("preview") is True
    assert "changes" in d
