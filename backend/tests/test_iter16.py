"""Iteration 16 backend tests — Close a line + Suggest best line + Start line.

Covers:
  1) Baseline schedule (2026-08-19 day, X-Smart p=1 rc=1, E2/Element 2 p=2 rc=1).
  2) POST /schedule/{date}/close-line: line 'X-Smart' becomes closed_line_keys=['X-Smart'],
     closures[] appended with line/line_key/closed_at/freed_count, cells set required=0,
     assigned=[], shortage=0. total_required recomputed.
  3) GET /schedule/{date} still returns closed_line_keys + closures.
  4) GET /schedules includes closures on the doc.
  5) GET /schedule/{date}/suggest-line returns ranked candidates with
     assignable_count / required / coverage_pct.
  6) POST /schedule/{date}/start-line adds line + auto-assigns from unassigned pool.
  7) GET /analytics/monthly includes closures[] entry for that date.
"""
import os
import pytest
import requests
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"
DATE = "2026-08-19"
SHIFT = "day"


@pytest.fixture(scope="module")
def sess():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def baseline(sess):
    r = sess.post(f"{API}/schedule", json={
        "date": DATE, "shift": SHIFT,
        "line_configs": [
            {"line": "X-Smart", "priority": 1, "run_count": 1},
            {"line": "Element 2", "priority": 2, "run_count": 1},
        ],
        "absent_person_ids": [], "overrides": {},
        "unassigned_keys": [], "required_overrides": {},
    })
    assert r.status_code == 200, r.text
    return r.json()


def test_baseline_created(baseline):
    assert baseline["date"] == DATE
    assert len(baseline["assignments"]) > 0
    assert baseline.get("closed_line_keys", []) == []


def test_close_line_frees_and_logs(sess, baseline):
    r = sess.post(f"{API}/schedule/{DATE}/close-line",
                  json={"shift": SHIFT, "line_key": "X-Smart"})
    assert r.status_code == 200, r.text
    sched = r.json()
    # Closed key present
    assert "X-Smart" in sched.get("closed_line_keys", [])
    # A closure log was recorded
    closures = sched.get("closures", [])
    assert any(c["line_key"] == "X-Smart" for c in closures)
    last = [c for c in closures if c["line_key"] == "X-Smart"][-1]
    assert last["line"] == "X-Smart"
    assert last["freed_count"] >= 0
    assert "closed_at" in last
    # All X-Smart cells zeroed
    xs_cells = [a for a in sched["assignments"] if a["line_key"] == "X-Smart"]
    assert xs_cells, "X-Smart cells should still exist (marked closed)"
    for a in xs_cells:
        assert a["required"] == 0
        assert a["assigned_person_ids"] == []
        assert a["shortage"] == 0
    # Element 2 (canonicalized to 'E2') cells preserved
    e2_cells = [a for a in sched["assignments"] if a["line_key"] in ("Element 2", "E2")]
    assert e2_cells and any(a["required"] > 0 for a in e2_cells)


def test_close_line_idempotency(sess):
    r = sess.post(f"{API}/schedule/{DATE}/close-line",
                  json={"shift": SHIFT, "line_key": "X-Smart"})
    assert r.status_code == 400


def test_get_schedule_returns_closures(sess):
    r = sess.get(f"{API}/schedule/{DATE}", params={"shift": SHIFT})
    assert r.status_code == 200
    d = r.json()
    assert "X-Smart" in d.get("closed_line_keys", [])
    assert any(c["line_key"] == "X-Smart" for c in d.get("closures", []))


def test_list_schedules_has_closures(sess):
    r = sess.get(f"{API}/schedules")
    assert r.status_code == 200
    docs = r.json()
    match = [d for d in docs if d.get("date") == DATE and d.get("shift") == SHIFT]
    assert match, "Our schedule should be listed"
    assert match[0].get("closures"), "closures should be on the schedule doc"


def test_suggest_line(sess):
    r = sess.get(f"{API}/schedule/{DATE}/suggest-line", params={"shift": SHIFT})
    assert r.status_code == 200, r.text
    d = r.json()
    assert "unassigned_pool_size" in d
    assert "suggestions" in d
    # There should be pool freed by close and by default idle; suggestions may be non-empty
    for s in d["suggestions"]:
        assert "line" in s
        assert "assignable_count" in s
        assert "required" in s
        assert "coverage_pct" in s
    # Ranked by coverage_pct desc
    covs = [s["coverage_pct"] for s in d["suggestions"]]
    assert covs == sorted(covs, reverse=True)


def test_start_line_from_suggestion(sess):
    r = sess.get(f"{API}/schedule/{DATE}/suggest-line", params={"shift": SHIFT})
    suggestions = r.json()["suggestions"]
    if not suggestions or suggestions[0]["assignable_count"] == 0:
        pytest.skip("No startable line with idle pool")
    top = suggestions[0]["line"]
    r2 = sess.post(f"{API}/schedule/{DATE}/start-line",
                   json={"shift": SHIFT, "line": top, "priority": 3, "run_count": 1})
    assert r2.status_code == 200, r2.text
    sched = r2.json()
    # New line appears in line_configs
    assert any(c["line"] == top for c in sched["line_configs"])
    # Cells for new line present
    new_cells = [a for a in sched["assignments"] if a["line"] == top]
    assert new_cells
    # Cannot start again
    r3 = sess.post(f"{API}/schedule/{DATE}/start-line",
                   json={"shift": SHIFT, "line": top, "priority": 3, "run_count": 1})
    assert r3.status_code == 400


def test_analytics_monthly_has_closures(sess):
    month = DATE[:7]
    r = sess.get(f"{API}/analytics/monthly", params={"month": month})
    assert r.status_code == 200
    d = r.json()
    assert "closures" in d
    matching = [c for c in d["closures"] if c["date"] == DATE and c["line_key"] == "X-Smart"]
    assert matching, "monthly closures should include the X-Smart closure"
    entry = matching[0]
    assert "closed_at" in entry
    assert "freed_count" in entry
    assert "line" in entry
