"""Iteration 14 backend tests — Late Arrival & Undo.

Covers:
  1) /api/stats -> persons=71, details=71, lines=15 (new file).
  2) Baseline schedule for 2026-08-19 day X-Smart p=1 rc=1 + Element 2 p=2 rc=1.
  3) POST /schedule/{date}/late-arrival WITHOUT target returns
     {person, best_fit, planned:[…], not_planned:[…]}, filtered by skills.
  4) POST /schedule/{date}/late-arrival WITH target on planned cell that is at
     required: removes person from absent, adds override, displaces existing
     worker, either auto-reassigns (displaced_placed_id set) or returns
     'displaced' conflict object with options.
  5) POST /schedule/{date}/late-arrival WITH target on NOT-PLANNED line adds
     that line to line_configs (max_prio+1, rc=1) and produces new column.
  6) POST /schedule/{date}/undo restores prior state; second call -> 400.
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
    """Generate baseline with one absent person from X-Smart P & C."""
    # 1st: clean generate to find an assignee
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
    sched = r.json()
    pc_cell = next(a for a in sched["assignments"]
                   if a["detail"] == "X-Smart P & C")
    absent_pid = pc_cell["assigned_person_ids"][0]

    # Re-generate with that person absent
    r2 = sess.post(f"{API}/schedule", json={
        "date": DATE, "shift": SHIFT,
        "line_configs": [
            {"line": "X-Smart", "priority": 1, "run_count": 1},
            {"line": "Element 2", "priority": 2, "run_count": 1},
        ],
        "absent_person_ids": [absent_pid],
        "overrides": {}, "unassigned_keys": [], "required_overrides": {},
    })
    assert r2.status_code == 200, r2.text
    sched2 = r2.json()
    return {"absent_pid": absent_pid, "sched": sched2, "prev_cell": pc_cell}


# ------ (1) stats ------
def test_stats(sess):
    d = sess.get(f"{API}/stats").json()
    assert d["persons"] == 71
    assert d["details"] == 71
    assert d["lines"] == 15


# ------ (2) baseline ------
def test_baseline_absent_1(baseline):
    sched = baseline["sched"]
    assert baseline["absent_pid"] in sched["absent_person_ids"]
    assert len(sched["absent_person_ids"]) == 1


# ------ (3) late-arrival WITHOUT target ------
def test_late_arrival_options_no_target(sess, baseline):
    pid = baseline["absent_pid"]
    r = sess.post(f"{API}/schedule/{DATE}/late-arrival",
                  json={"shift": SHIFT, "person_id": pid})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["person"]["id"] == pid
    assert "best_fit" in data
    assert "planned" in data and isinstance(data["planned"], list)
    assert "not_planned" in data and isinstance(data["not_planned"], list)
    # All planned options must be on active lines
    active_lines = {c["line"] for c in baseline["sched"]["line_configs"]}
    for opt in data["planned"]:
        assert opt["line"] in active_lines
        assert opt["planned"] is True
    for opt in data["not_planned"]:
        assert opt["line"] not in active_lines
        assert opt["planned"] is False


def test_late_arrival_bad_person(sess):
    r = sess.post(f"{API}/schedule/{DATE}/late-arrival",
                  json={"shift": SHIFT, "person_id": "does-not-exist"})
    assert r.status_code == 404


def test_late_arrival_missing_pid(sess):
    r = sess.post(f"{API}/schedule/{DATE}/late-arrival",
                  json={"shift": SHIFT})
    assert r.status_code == 400


# ------ (4) late-arrival WITH target on planned cell ------
def test_late_arrival_planned_target_displaces_and_undo(sess, baseline):
    pid = baseline["absent_pid"]
    prev = baseline["prev_cell"]  # X-Smart P & C, req=2

    # confirm cell currently at/over required in shorted state
    payload = {
        "shift": SHIFT, "person_id": pid,
        "target": {
            "line": prev["line"], "row_name": prev["row_name"],
            "detail": prev["detail"], "required": prev["required"],
        },
    }
    r = sess.post(f"{API}/schedule/{DATE}/late-arrival", json=payload)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "schedule" in data
    new_sched = data["schedule"]
    # pid no longer absent
    assert pid not in new_sched["absent_person_ids"]
    # pid IS assigned to that cell
    tgt = next(a for a in new_sched["assignments"]
               if a["line"] == prev["line"] and a["detail"] == prev["detail"]
               and a["row_name"] == prev["row_name"])
    assert pid in tgt["assigned_person_ids"]
    # Either displaced was auto-placed OR conflict returned
    assert (data.get("displaced_placed_id") is not None) or (data.get("displaced") is not None)
    if data.get("displaced"):
        assert "id" in data["displaced"] and "options" in data["displaced"]
        assert isinstance(data["displaced"]["options"], list)

    # ---- UNDO restores state ----
    r2 = sess.post(f"{API}/schedule/{DATE}/undo", params={"shift": SHIFT})
    assert r2.status_code == 200, r2.text
    restored = r2.json()
    assert pid in restored["absent_person_ids"]

    # ---- Second undo -> 400 ----
    r3 = sess.post(f"{API}/schedule/{DATE}/undo", params={"shift": SHIFT})
    assert r3.status_code == 400


# ------ (5) late-arrival WITH target on NOT-PLANNED line ------
def test_late_arrival_adds_new_line(sess, baseline):
    """Pick a not-planned line the person has a skill for."""
    pid = baseline["absent_pid"]
    # ask backend which options are not planned for this person
    opts = sess.post(f"{API}/schedule/{DATE}/late-arrival",
                     json={"shift": SHIFT, "person_id": pid}).json()
    if not opts["not_planned"]:
        pytest.skip("Person has no skill on any not-planned line")
    target_opt = opts["not_planned"][0]

    active_before = {c["line"] for c in baseline["sched"]["line_configs"]}
    assert target_opt["line"] not in active_before

    payload = {
        "shift": SHIFT, "person_id": pid,
        "target": {
            "line": target_opt["line"], "row_name": target_opt["row_name"],
            "detail": target_opt["detail"], "required": target_opt["required"],
        },
    }
    r = sess.post(f"{API}/schedule/{DATE}/late-arrival", json=payload)
    assert r.status_code == 200, r.text
    new_sched = r.json()["schedule"]

    # new line is now active
    active_after = {c["line"] for c in new_sched["line_configs"]}
    assert target_opt["line"] in active_after
    # new line was appended with max_prio+1, rc=1
    added_cfg = next(c for c in new_sched["line_configs"] if c["line"] == target_opt["line"])
    max_prev_prio = max(c["priority"] for c in baseline["sched"]["line_configs"])
    assert added_cfg["priority"] == max_prev_prio + 1
    assert added_cfg["run_count"] == 1
    # person assigned in the added cell
    tgt = next(a for a in new_sched["assignments"]
               if a["line"] == target_opt["line"] and a["detail"] == target_opt["detail"])
    assert pid in tgt["assigned_person_ids"]

    # Cleanup: undo so subsequent tests / DB is clean
    sess.post(f"{API}/schedule/{DATE}/undo", params={"shift": SHIFT})
