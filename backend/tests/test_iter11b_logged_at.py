"""
Iteration 11b backend tests: `logged_at` preservation across regenerations.

generate_schedule (via POST /api/schedule, /adjust, /mark-absent, /fill-shortages,
/auto-plan) must NOT overwrite a previously-set logged_at timestamp. A fresh
schedule for a new date must still start with logged_at == null.
"""
import os
import pytest
import requests
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

LOG_DATE = "2026-08-05"
FRESH_DATE = "2026-08-20"
SHIFT = "day"
CONFIGS = [
    {"line": "SK300", "priority": 1, "run_count": 1},
    {"line": "GX300", "priority": 2, "run_count": 1},
]


def _regen(date, configs=None, absent=None):
    r = requests.post(
        f"{API}/schedule",
        json={
            "date": date, "shift": SHIFT,
            "line_configs": configs or CONFIGS,
            "absent_person_ids": absent or [],
            "overrides": {}, "unassigned_keys": [],
            "required_overrides": {},
        },
        timeout=30,
    )
    assert r.status_code == 200, r.text
    return r.json()


def _get(date):
    r = requests.get(f"{API}/schedule/{date}", params={"shift": SHIFT}, timeout=30)
    assert r.status_code == 200
    return r.json()


@pytest.fixture(scope="module")
def logged_schedule():
    # Clean slate then create + log
    requests.delete(f"{API}/schedule/{LOG_DATE}", params={"shift": SHIFT}, timeout=30)
    _regen(LOG_DATE)
    r = requests.post(f"{API}/schedule/{LOG_DATE}/log", params={"shift": SHIFT}, timeout=30)
    assert r.status_code == 200, r.text
    ts = r.json()["logged_at"]
    assert ts
    return ts


class TestLoggedAtPreservation:
    """After /log, subsequent regen/adjust/mark-absent/fill-shortages must keep logged_at."""

    def test_log_sets_timestamp(self, logged_schedule):
        got = _get(LOG_DATE)
        assert got["logged_at"] == logged_schedule

    def test_regenerate_preserves_logged_at(self, logged_schedule):
        # POST /api/schedule for the same date/shift must preserve the timestamp
        s = _regen(LOG_DATE)
        assert s["logged_at"] == logged_schedule, \
            f"regenerate wiped logged_at: {s.get('logged_at')} != {logged_schedule}"
        # And GET verifies persistence
        assert _get(LOG_DATE)["logged_at"] == logged_schedule

    def test_adjust_preserves_logged_at(self, logged_schedule):
        sched = _get(LOG_DATE)
        target = next(a for a in sched["assignments"] if a["assigned_person_ids"])
        cell_key = f"{target['row_name']}||{target['line_key']}||{target['detail']}"
        r = requests.post(
            f"{API}/schedule/{LOG_DATE}/adjust",
            json={"shift": SHIFT, "cell_key": cell_key, "action": "clear"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        assert r.json()["logged_at"] == logged_schedule
        assert _get(LOG_DATE)["logged_at"] == logged_schedule

    def test_mark_absent_preserves_logged_at(self, logged_schedule):
        sched = _get(LOG_DATE)
        pid = next(
            (a["assigned_person_ids"][0] for a in sched["assignments"] if a["assigned_person_ids"]),
            None,
        )
        if pid is None:
            # nothing to mark absent — force-regen and retry
            sched = _regen(LOG_DATE)
            pid = next(a["assigned_person_ids"][0] for a in sched["assignments"] if a["assigned_person_ids"])
        r = requests.post(
            f"{API}/schedule/{LOG_DATE}/mark-absent",
            json={"shift": SHIFT, "person_id": pid},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        assert r.json()["logged_at"] == logged_schedule
        assert _get(LOG_DATE)["logged_at"] == logged_schedule

    def test_fill_shortages_preserves_logged_at(self, logged_schedule):
        r = requests.post(
            f"{API}/schedule/{LOG_DATE}/fill-shortages",
            params={"shift": SHIFT},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        assert r.json()["logged_at"] == logged_schedule
        assert _get(LOG_DATE)["logged_at"] == logged_schedule


class TestFreshScheduleLoggedAtNull:
    """Auto-plan (and any regen) on a NEW date must start with logged_at == null.
    It must not accidentally pick up logs from other dates."""

    def test_autoplan_fresh_date_has_null_logged_at(self):
        # Ensure clean slate
        requests.delete(f"{API}/schedule/{FRESH_DATE}", params={"shift": SHIFT}, timeout=30)
        r = requests.post(
            f"{API}/schedule/auto-plan",
            json={
                "date": FRESH_DATE, "shift": SHIFT,
                "absent_person_ids": [], "min_coverage": 80,
            },
            timeout=60,
        )
        assert r.status_code == 200, r.text
        s = r.json()
        assert s.get("logged_at") in (None, ""), \
            f"fresh auto-plan should have null logged_at, got {s.get('logged_at')!r}"
        got = _get(FRESH_DATE)
        assert got.get("logged_at") in (None, "")
        # And the existing logged date must remain untouched
        requests.delete(f"{API}/schedule/{FRESH_DATE}", params={"shift": SHIFT}, timeout=30)
