"""Iteration 13 backend tests.
Covers:
  1) /api/stats returns persons=71, details=72, lines=15.
  2) /api/lines: Monkey has 'Monkey X-Smart' (row_name='monkey xx')
     and 'Monkey Element 2' (row_name='monkey e2').
  3) POST /api/schedule for 2026-08-16 day XSmart+E2+SK300 → req=38 ass=38 short=0.
  4) GET /api/schedule/{date}/suggest-replacement caps at top and returns proper shape.
  5) fill-shortages fixed-point loop reduces (typically zeroes) short.
"""
import os
import pytest
import requests
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"
DATE = "2026-08-16"
SHIFT = "day"


@pytest.fixture(scope="module")
def sess():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# -------- (1) stats --------
def test_stats_counts(sess):
    r = sess.get(f"{API}/stats", timeout=30)
    assert r.status_code == 200
    d = r.json()
    assert d.get("persons") == 71, d
    assert d.get("details") == 72, d
    assert d.get("lines") == 15, d


# -------- (2) Monkey row_names --------
def test_monkey_subtasks(sess):
    r = sess.get(f"{API}/lines", timeout=30)
    assert r.status_code == 200
    payload = r.json()
    lines = payload["lines"] if isinstance(payload, dict) else payload
    monkey = next((l for l in lines if l.get("line") == "Monkey"), None)
    assert monkey is not None, "Monkey line missing"
    by_name = {d["detail"]: (d.get("row_name") or "").lower() for d in monkey["details"]}
    assert "Monkey X-Smart" in by_name, by_name
    assert "Monkey Element 2" in by_name, by_name
    assert by_name["Monkey X-Smart"] == "monkey xx"
    assert by_name["Monkey Element 2"] == "monkey e2"


# -------- (3) schedule --------
@pytest.fixture(scope="module")
def sched(sess):
    sess.delete(f"{API}/schedule/{DATE}", params={"shift": SHIFT}, timeout=30)
    payload = {
        "date": DATE, "shift": SHIFT,
        "line_configs": [
            {"line": "X-Smart", "priority": 1, "run_count": 1},
            {"line": "E2", "priority": 2, "run_count": 1},
            {"line": "SK300", "priority": 3, "run_count": 1},
        ],
        "absent_person_ids": [], "overrides": {},
        "unassigned_keys": [], "required_overrides": {},
    }
    r = sess.post(f"{API}/schedule", json=payload, timeout=60)
    assert r.status_code == 200, r.text
    return r.json()


def test_schedule_totals(sched):
    assert sched.get("total_required") == 38, sched
    assert sched.get("total_assigned") == 38, sched
    assert sched.get("total_shortage") == 0, sched


def test_no_duplicate_person_assignments(sched):
    ids = []
    for a in sched.get("assignments", []):
        ids.extend(a.get("assigned_person_ids", []))
    assert len(ids) == len(set(ids)), (
        f"duplicate person ids: total={len(ids)} unique={len(set(ids))}"
    )


# -------- (4) suggest-replacement --------
def test_suggest_replacement_shape(sched, sess):
    support = {"monkey", "kk", "spares", "vehicle", "crimping", "os", "5s+others"}
    a = next(
        (x for x in sched["assignments"]
         if x.get("assigned_person_ids") and x.get("line_key") not in {"Monkey", "KK", "Spares", "Vehicle", "Crimping", "OS", "5S+Others"}),
        None,
    )
    assert a is not None
    cell_key = f"{a['row_name']}||{a['line_key']}||{a['detail']}"
    r = sess.get(f"{API}/schedule/{DATE}/suggest-replacement",
                 params={"cell_key": cell_key, "shift": SHIFT, "top": 3}, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert set(d.keys()) >= {"cell", "free", "borrowable"}
    assert len(d["free"]) <= 3
    assert len(d["borrowable"]) <= 3
    for c in d["free"]:
        assert {"id", "name", "skills"} <= set(c.keys())
    for c in d["borrowable"]:
        assert {"id", "name", "skills", "current"} <= set(c.keys())
        assert {"row_name", "line_key", "detail"} <= set(c["current"].keys())


def test_suggest_replacement_404(sess):
    r = sess.get(f"{API}/schedule/{DATE}/suggest-replacement",
                 params={"cell_key": "bogus||bogus||bogus", "shift": SHIFT, "top": 3}, timeout=30)
    assert r.status_code == 404


def test_suggest_replacement_bad_key(sess):
    r = sess.get(f"{API}/schedule/{DATE}/suggest-replacement",
                 params={"cell_key": "bad_format", "shift": SHIFT, "top": 3}, timeout=30)
    assert r.status_code == 400


# -------- (5) fill-shortages fixed point --------
def test_fill_shortages_fixed_point(sched, sess):
    # Mark 4 assigned persons absent → likely creates shortages
    picked = []
    for a in sched["assignments"]:
        for pid in a.get("assigned_person_ids", []):
            picked.append(pid)
            if len(picked) >= 4:
                break
        if len(picked) >= 4:
            break
    assert picked
    for pid in picked:
        r = sess.post(f"{API}/schedule/{DATE}/mark-absent",
                      json={"shift": SHIFT, "person_id": pid}, timeout=30)
        assert r.status_code == 200, r.text
    before = r.json()
    r2 = sess.post(f"{API}/schedule/{DATE}/fill-shortages", params={"shift": SHIFT}, timeout=60)
    assert r2.status_code == 200, r2.text
    after = r2.json()
    # Fill-shortages must never increase shortage
    assert after.get("total_shortage", 0) <= before.get("total_shortage", 0), (
        before.get("total_shortage"), after.get("total_shortage"))
