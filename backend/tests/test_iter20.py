"""Iter20 backend tests:
 - GET /api/schedule/{date}/suggest-lines (plural) removed → 404
 - GET /api/schedule/{date}/suggest-line (singular) still works
 - Multi-step undo: history grows, capped at 5, undo pops correctly
 - Undo pop restores prior state (close-line + adjust preserves closures)
"""
import os
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
DATE = "2026-10-15"
SHIFT = "day"


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    yield s
    # cleanup
    s.delete(f"{BASE_URL}/api/schedule/{DATE}", params={"shift": SHIFT})


def _baseline(api):
    # delete first so closures/history from prior tests don't bleed in (iter20 preserves them across regenerate)
    api.delete(f"{BASE_URL}/api/schedule/{DATE}", params={"shift": SHIFT})
    r = api.post(f"{BASE_URL}/api/schedule", json={
        "date": DATE, "shift": SHIFT,
        "line_configs": [
            {"line": "X-Smart", "priority": 1, "run_count": 1},
            {"line": "E2", "priority": 2, "run_count": 1},
        ],
        "absent_person_ids": [],
        "disabled_activities": {},
    })
    assert r.status_code == 200, r.text
    return r.json()


def _get(api):
    return api.get(f"{BASE_URL}/api/schedule/{DATE}", params={"shift": SHIFT}).json()


# ---------- suggest-lines endpoint removed ----------
def test_suggest_lines_plural_removed(api):
    _baseline(api)
    r = api.get(f"{BASE_URL}/api/schedule/{DATE}/suggest-lines", params={"shift": SHIFT})
    assert r.status_code == 404, f"suggest-lines (plural) must be removed, got {r.status_code}"


def test_suggest_line_singular_works(api):
    r = api.get(f"{BASE_URL}/api/schedule/{DATE}/suggest-line", params={"shift": SHIFT})
    assert r.status_code == 200, r.text


# ---------- history growth + cap ----------
def _mark_absent(api, sched):
    pid = None
    for a in sched["assignments"]:
        if a["assigned_person_ids"]:
            pid = a["assigned_person_ids"][0]
            break
    assert pid
    r = api.post(f"{BASE_URL}/api/schedule/{DATE}/mark-absent",
                 json={"shift": SHIFT, "person_id": pid})
    assert r.status_code == 200, r.text
    return pid


def _fill_shortages(api):
    r = api.post(f"{BASE_URL}/api/schedule/{DATE}/fill-shortages", params={"shift": SHIFT})
    assert r.status_code == 200


def _close_line(api, line_key):
    r = api.post(f"{BASE_URL}/api/schedule/{DATE}/close-line",
                 json={"shift": SHIFT, "line_key": line_key})
    assert r.status_code == 200, r.text
    return r.json()


def _set_disabled(api, line, rows):
    r = api.post(f"{BASE_URL}/api/schedule/{DATE}/set-disabled-activities",
                 json={"shift": SHIFT, "disabled_activities": {line: rows}})
    assert r.status_code == 200, r.text
    return r.json()


def _adjust(api, sched, line="E2"):
    cell = next(a for a in sched["assignments"] if a["line"] == line and a["required"] > 0)
    key = f"{cell['row_name']}||{cell['line_key']}||{cell['detail']}"
    r = api.post(f"{BASE_URL}/api/schedule/{DATE}/adjust",
                 json={"shift": SHIFT, "cell_key": key, "action": "set",
                       "person_ids": list(cell["assigned_person_ids"])})
    assert r.status_code == 200, r.text
    return r.json()


def test_history_grows_and_snapshot_shape(api):
    sched = _baseline(api)
    assert len(sched.get("history") or []) == 0

    _mark_absent(api, sched)
    d = _get(api); assert len(d["history"]) == 1
    _fill_shortages(api)
    d = _get(api); assert len(d["history"]) == 2

    # non-support ops line for set-disabled
    e2_row = next(a["row_name"] for a in d["assignments"] if a["line"] == "E2" and a["required"] > 0)
    _set_disabled(api, "E2", [e2_row])
    d = _get(api); assert len(d["history"]) == 3

    _close_line(api, "X-Smart")
    d = _get(api); assert len(d["history"]) == 4

    _adjust(api, d)
    d = _get(api); assert len(d["history"]) == 5

    # snapshot shape
    entry = d["history"][-1]
    for k in ("action", "snapshot_at", "line_configs", "absent_person_ids", "overrides",
              "unassigned_keys", "required_overrides", "assignments", "closures",
              "closed_line_keys", "disabled_activities"):
        assert k in entry, f"snapshot missing {k}"


def test_history_cap_at_5(api):
    _baseline(api)
    d = _get(api)
    for i in range(7):
        # cycle through mutations
        if i % 3 == 0:
            _fill_shortages(api)
        elif i % 3 == 1:
            row = next(a["row_name"] for a in _get(api)["assignments"]
                       if a["line"] == "E2" and a["required"] > 0)
            _set_disabled(api, "E2", [row] if i % 2 == 0 else [])
        else:
            _adjust(api, _get(api))
    d = _get(api)
    assert len(d["history"]) == 5, f"expected cap 5, got {len(d['history'])}"


# ---------- undo pop drains ----------
def test_undo_pops_and_drains(api):
    _baseline(api)
    # do 3 mutations
    _fill_shortages(api)
    _adjust(api, _get(api))
    _close_line(api, "X-Smart")
    d = _get(api)
    initial_hist = len(d["history"])
    assert initial_hist == 3
    assert "X-Smart" in d.get("closed_line_keys", [])

    # undo the close-line
    r = api.post(f"{BASE_URL}/api/schedule/{DATE}/undo", params={"shift": SHIFT})
    assert r.status_code == 200, r.text
    d2 = r.json()
    assert len(d2["history"]) == initial_hist - 1
    assert "X-Smart" not in d2.get("closed_line_keys", []), "close-line was not undone"

    # drain
    api.post(f"{BASE_URL}/api/schedule/{DATE}/undo", params={"shift": SHIFT})
    api.post(f"{BASE_URL}/api/schedule/{DATE}/undo", params={"shift": SHIFT})
    d3 = _get(api)
    assert len(d3["history"]) == 0
    # next undo -> 400
    r4 = api.post(f"{BASE_URL}/api/schedule/{DATE}/undo", params={"shift": SHIFT})
    assert r4.status_code == 400
    assert "nothing" in r4.text.lower()


# ---------- close-line + adjust preserves closure ----------
def test_close_line_preserved_across_adjust(api):
    _baseline(api)
    _close_line(api, "X-Smart")
    d = _get(api)
    assert "X-Smart" in d.get("closed_line_keys", [])
    # adjust some E2 cell
    _adjust(api, d, line="E2")
    d2 = _get(api)
    assert "X-Smart" in d2.get("closed_line_keys", []), \
        "closed_line_keys was wiped by adjust"


def test_disabled_activities_preserved_across_adjust(api):
    _baseline(api)
    d = _get(api)
    e2_row = next(a["row_name"] for a in d["assignments"] if a["line"] == "E2" and a["required"] > 0)
    _set_disabled(api, "E2", [e2_row])
    _adjust(api, _get(api), line="E2")
    d2 = _get(api)
    assert e2_row in (d2.get("disabled_activities") or {}).get("E2", []), \
        "disabled_activities lost across adjust"


# ---------- mark-absent + undo restores ----------
def test_undo_restores_mark_absent(api):
    _baseline(api)
    sched = _get(api)
    pid = _mark_absent(api, sched)
    d = _get(api)
    assert pid in d.get("absent_person_ids", [])
    r = api.post(f"{BASE_URL}/api/schedule/{DATE}/undo", params={"shift": SHIFT})
    assert r.status_code == 200
    d2 = r.json()
    assert pid not in d2.get("absent_person_ids", []), "undo did not restore absent list"
