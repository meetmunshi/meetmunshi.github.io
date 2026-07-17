"""
Iteration 6 backend regression suite:
 - alphabetical /api/persons sort
 - override no longer capped at required (extra hands)
 - prior regression: schedule generation, adjust set/clear, shift isolation, export, analytics
"""
import os
import io
import zipfile
import pytest
import requests
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

TEST_DATE = "2026-07-16"
SHIFT = "day"
STD_LINE_CONFIGS = [
    {"line": "X-Smart", "priority": 1, "run_count": 2},
    {"line": "E2", "priority": 2, "run_count": 1},
    {"line": "Spares", "priority": 3, "run_count": 1},
]


@pytest.fixture(scope="session")
def persons():
    r = requests.get(f"{API}/persons", timeout=30)
    assert r.status_code == 200
    return r.json()


@pytest.fixture(scope="session")
def details():
    r = requests.get(f"{API}/details", timeout=30)
    assert r.status_code == 200
    return r.json()


@pytest.fixture(scope="session")
def base_schedule(persons):
    # regenerate a clean schedule for the standard config
    r = requests.post(
        f"{API}/schedule",
        json={
            "date": TEST_DATE,
            "shift": SHIFT,
            "line_configs": STD_LINE_CONFIGS,
            "absent_person_ids": [],
            "overrides": {},
            "unassigned_keys": [],
        },
        timeout=30,
    )
    assert r.status_code == 200, r.text
    return r.json()


# --- persons endpoint / sort ---
class TestPersonsAlphaSort:
    def test_persons_count_and_alpha_sort(self, persons):
        assert isinstance(persons, list)
        assert len(persons) == 76, f"Expected 76 persons, got {len(persons)}"

        names = [p["name"].strip() for p in persons]
        sorted_names = sorted(names, key=lambda x: x.lower())
        assert names == sorted_names, "persons not sorted alphabetically by name"

        assert persons[0]["name"].lower().startswith("aarsh"), \
            f"first person expected Aarsh Patel, got {persons[0]['name']} {persons[0].get('surname','')}"
        assert persons[-1]["name"].lower().startswith("yuvraj"), \
            f"last person expected Yuvraj Magharola, got {persons[-1]['name']} {persons[-1].get('surname','')}"

        # response should not include mongo _id
        for p in persons[:5]:
            assert "_id" not in p


# --- schedule regression ---
class TestScheduleGeneration:
    def test_schedule_summary(self, base_schedule):
        s = base_schedule
        assert s["date"] == TEST_DATE
        assert s["shift"] == SHIFT
        assert s["total_required"] > 0
        # Sum invariants
        total_assigned = sum(len(a["assigned_person_ids"]) for a in s["assignments"])
        total_short = sum(a["shortage"] for a in s["assignments"])
        assert total_assigned == s["total_assigned"]
        assert total_short == s["total_shortage"]
        assert s["total_required"] == s["total_assigned"] + s["total_shortage"]

    def test_line_keys(self, base_schedule):
        keys = sorted({a["line_key"] for a in base_schedule["assignments"]})
        assert keys == sorted(["X-Smart", "X-Smart #2", "E2", "Spares"]), keys

    def test_priority_ordering(self, base_schedule):
        # X-Smart run 1 gets people before Spares run 1 (priority 1 vs 3)
        cfgs = base_schedule["line_configs"]
        assert cfgs[0]["line"] == "X-Smart" and cfgs[0]["priority"] == 1

    def test_no_duplicate_assignments(self, base_schedule):
        seen = {}
        for a in base_schedule["assignments"]:
            for pid in a["assigned_person_ids"]:
                assert pid not in seen, f"person {pid} in both {seen.get(pid)} and {a['line_key']}"
                seen[pid] = a["line_key"]


# --- extra hands (override exceeds required) ---
class TestExtraHands:
    def test_override_allows_more_than_required(self, base_schedule, persons):
        # Find a cell with required=1 (X-Smart Spares row shortage ~1, but pick E2 or Spares w/ req=1)
        target = None
        for a in base_schedule["assignments"]:
            if a["required"] == 1:
                target = a
                break
        assert target is not None, "no required=1 cell found"

        # Grab 3 skilled person ids for that detail
        skilled = [p["id"] for p in persons if (p.get("skills") or {}).get(target["detail"])]
        assert len(skilled) >= 3, f"need at least 3 skilled for {target['detail']}, got {len(skilled)}"
        picks = skilled[:3]

        cell_key = f"{target['row_name']}||{target['line_key']}"
        r = requests.post(
            f"{API}/schedule/{TEST_DATE}/adjust",
            json={
                "shift": SHIFT,
                "cell_key": cell_key,
                "action": "set",
                "person_ids": picks,
            },
            timeout=30,
        )
        assert r.status_code == 200, r.text
        sched = r.json()
        cell = next(a for a in sched["assignments"]
                    if a["row_name"] == target["row_name"] and a["line_key"] == target["line_key"])
        assert cell["assigned_person_ids"] == picks, \
            f"expected all 3 picks preserved, got {cell['assigned_person_ids']}"
        assert cell["shortage"] == 0, f"shortage should be 0, got {cell['shortage']}"
        assert len(cell["assigned_person_names"]) == 3

    def test_extra_hands_persist_after_regenerate(self, persons):
        # Set an override with 2 picks on a required=1 cell then regenerate via POST /api/schedule
        # to ensure _generate_assignments does NOT truncate the overrides list.
        r = requests.get(f"{API}/schedule/{TEST_DATE}", params={"shift": SHIFT}, timeout=30)
        assert r.status_code == 200
        sched = r.json()
        target = next(a for a in sched["assignments"] if a["required"] == 1)
        skilled = [p["id"] for p in persons if (p.get("skills") or {}).get(target["detail"])]
        picks = skilled[:2]
        cell_key = f"{target['row_name']}||{target['line_key']}"
        overrides = {cell_key: picks}

        r2 = requests.post(
            f"{API}/schedule",
            json={
                "date": TEST_DATE,
                "shift": SHIFT,
                "line_configs": STD_LINE_CONFIGS,
                "absent_person_ids": [],
                "overrides": overrides,
                "unassigned_keys": [],
            },
            timeout=30,
        )
        assert r2.status_code == 200
        sched2 = r2.json()
        cell = next(a for a in sched2["assignments"]
                    if a["row_name"] == target["row_name"] and a["line_key"] == target["line_key"])
        assert cell["assigned_person_ids"] == picks
        assert cell["shortage"] == 0


# --- adjust clear (regression) ---
class TestAdjustClear:
    def test_adjust_clear_leaves_cell_empty(self, persons):
        # Regenerate clean state
        r = requests.post(
            f"{API}/schedule",
            json={
                "date": TEST_DATE,
                "shift": SHIFT,
                "line_configs": STD_LINE_CONFIGS,
                "absent_person_ids": [],
                "overrides": {},
                "unassigned_keys": [],
            },
            timeout=30,
        )
        sched = r.json()
        # Pick a filled cell
        target = next(a for a in sched["assignments"] if a["assigned_person_ids"])
        cell_key = f"{target['row_name']}||{target['line_key']}"
        r2 = requests.post(
            f"{API}/schedule/{TEST_DATE}/adjust",
            json={"shift": SHIFT, "cell_key": cell_key, "action": "clear"},
            timeout=30,
        )
        assert r2.status_code == 200
        sched2 = r2.json()
        cell = next(a for a in sched2["assignments"]
                    if a["row_name"] == target["row_name"] and a["line_key"] == target["line_key"])
        assert cell["assigned_person_ids"] == []
        assert cell["shortage"] == cell["required"]


# --- shift isolation (regression) ---
class TestShiftIsolation:
    def test_day_and_evening_independent(self):
        for shift in ("day", "evening"):
            r = requests.post(
                f"{API}/schedule",
                json={
                    "date": TEST_DATE,
                    "shift": shift,
                    "line_configs": STD_LINE_CONFIGS,
                    "absent_person_ids": [],
                    "overrides": {},
                    "unassigned_keys": [],
                },
                timeout=30,
            )
            assert r.status_code == 200
            assert r.json()["shift"] == shift
        # Delete evening so we don't pollute analytics counts
        requests.delete(f"{API}/schedule/{TEST_DATE}", params={"shift": "evening"}, timeout=30)


# --- export xlsx ---
class TestExport:
    def test_export_returns_valid_xlsx(self):
        r = requests.get(f"{API}/export/{TEST_DATE}", params={"shift": SHIFT}, timeout=30)
        assert r.status_code == 200
        assert "spreadsheetml" in r.headers.get("content-type", "")
        assert "attachment" in r.headers.get("content-disposition", "")
        # Must be a valid zip (xlsx is zip)
        z = zipfile.ZipFile(io.BytesIO(r.content))
        assert len(z.namelist()) > 0


# --- analytics ---
class TestAnalytics:
    def test_analytics_shape(self):
        r = requests.get(f"{API}/analytics/shortage", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert set(data.keys()) == {"top_short_details", "top_short_lines", "history"}
        assert isinstance(data["history"], list)


# --- stats sanity ---
class TestStats:
    def test_stats(self):
        r = requests.get(f"{API}/stats", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["persons"] == 76
        assert d["details"] == 72
        assert d["lines"] == 15
