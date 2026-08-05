"""
Iteration 11 backend tests:
 - New seed data (71 persons / 72 details / 15 lines)
 - required_overrides per-detail
 - mark-absent from board (freeze plan, no autofill replacement)
 - log schedule + absenteeism xlsx report
 - SK300 frame renders 4 detail rows summing to 6 required
"""
import io
import os
import zipfile
import pytest
import requests
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

TEST_DATE = "2026-08-05"
SHIFT = "day"
CONFIGS = [
    {"line": "SK300", "priority": 1, "run_count": 1},
    {"line": "GX300", "priority": 2, "run_count": 1},
]


# --- Stats: new seed data ---
class TestStatsNewSeed:
    def test_stats_counts(self):
        r = requests.get(f"{API}/stats", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["persons"] == 71, f"expected 71 persons, got {d['persons']}"
        assert d["details"] == 72, f"expected 72 details, got {d['details']}"
        assert d["lines"] == 15, f"expected 15 lines, got {d['lines']}"


# --- Multi-detail rendering: SK300 frame has 4 sub-details totaling 6 required ---
@pytest.fixture(scope="module")
def sk_schedule():
    # Clean slate before
    requests.delete(f"{API}/schedule/{TEST_DATE}", params={"shift": SHIFT}, timeout=30)
    r = requests.post(
        f"{API}/schedule",
        json={
            "date": TEST_DATE, "shift": SHIFT,
            "line_configs": CONFIGS,
            "absent_person_ids": [], "overrides": {},
            "unassigned_keys": [], "required_overrides": {},
        },
        timeout=30,
    )
    assert r.status_code == 200, r.text
    return r.json()


class TestSK300FrameMultiDetail:
    def test_sk300_frame_has_4_details_summing_to_6(self, sk_schedule):
        frame_cells = [
            a for a in sk_schedule["assignments"]
            if a["line_key"] == "SK300" and a["row_name"] == "frame"
        ]
        assert len(frame_cells) == 4, (
            f"expected 4 SK300 frame sub-details, got {len(frame_cells)}: "
            f"{[c['detail'] for c in frame_cells]}"
        )
        total_req = sum(c["required"] for c in frame_cells)
        assert total_req == 6, f"expected SK300 frame total required=6, got {total_req}"

    def test_gx300_frame_sums_to_2(self, sk_schedule):
        cells = [
            a for a in sk_schedule["assignments"]
            if a["line_key"] == "GX300" and a["row_name"] == "frame"
        ]
        assert len(cells) == 2, f"expected 2 GX300 frame details, got {len(cells)}"
        assert sum(c["required"] for c in cells) == 2

    def test_no_duplicate_person(self, sk_schedule):
        seen = {}
        for a in sk_schedule["assignments"]:
            for pid in a["assigned_person_ids"]:
                assert pid not in seen, f"duplicate {pid}"
                seen[pid] = a["line_key"]


# --- required_overrides: per-detail via /adjust ---
class TestRequiredOverride:
    def test_adjust_lowers_required(self):
        # Dedicated date to avoid worker races overwriting schedule doc
        d = "2026-08-11"
        requests.delete(f"{API}/schedule/{d}", params={"shift": SHIFT}, timeout=30)
        r0 = requests.post(
            f"{API}/schedule",
            json={
                "date": d, "shift": SHIFT, "line_configs": CONFIGS,
                "absent_person_ids": [], "overrides": {},
                "unassigned_keys": [], "required_overrides": {},
            },
            timeout=30,
        )
        pre = r0.json()
        target = next(
            (a for a in pre["assignments"]
             if a["line_key"] == "SK300" and a["row_name"] == "frame" and a["required"] >= 2),
            None,
        )
        assert target is not None, "no SK300 frame sub-cell with required>=2"
        cell_key = f"{target['row_name']}||{target['line_key']}||{target['detail']}"
        new_req = target["required"] - 1

        r = requests.post(
            f"{API}/schedule/{d}/adjust",
            json={
                "shift": SHIFT, "cell_key": cell_key, "action": "set",
                "person_ids": target["assigned_person_ids"][:new_req],
                "required": new_req,
            },
            timeout=30,
        )
        assert r.status_code == 200, r.text
        sched = r.json()
        cell = next(
            a for a in sched["assignments"]
            if a["row_name"] == target["row_name"]
            and a["line_key"] == target["line_key"]
            and a["detail"] == target["detail"]
        )
        assert cell["required"] == new_req, \
            f"required not updated: {cell['required']} != {new_req}"

        # Verify persistence via GET
        r2 = requests.get(f"{API}/schedule/{d}", params={"shift": SHIFT}, timeout=30)
        got = r2.json()
        cell2 = next(
            a for a in got["assignments"]
            if a["row_name"] == target["row_name"]
            and a["line_key"] == target["line_key"]
            and a["detail"] == target["detail"]
        )
        assert cell2["required"] == new_req


# --- Mark absent from board: no autofill replacement ---
class TestMarkAbsentFromBoard:
    def test_mark_absent_removes_and_freezes(self):
        # Clean regen
        r = requests.post(
            f"{API}/schedule",
            json={
                "date": TEST_DATE, "shift": SHIFT,
                "line_configs": CONFIGS,
                "absent_person_ids": [], "overrides": {},
                "unassigned_keys": [], "required_overrides": {},
            },
            timeout=30,
        )
        pre = r.json()
        # Pick any assigned person
        target = next(a for a in pre["assignments"] if a["assigned_person_ids"])
        pid = target["assigned_person_ids"][0]
        pre_assigned = pre["total_assigned"]
        pre_short = pre["total_shortage"]

        r2 = requests.post(
            f"{API}/schedule/{TEST_DATE}/mark-absent",
            json={"shift": SHIFT, "person_id": pid},
            timeout=30,
        )
        assert r2.status_code == 200, r2.text
        after = r2.json()
        # Person is in absent list
        assert pid in after["absent_person_ids"]
        # Person no longer in any cell
        for a in after["assignments"]:
            assert pid not in a["assigned_person_ids"], \
                f"person still in cell {a['line_key']}"
        # Total assigned decreases by 1, shortage increases by 1
        assert after["total_assigned"] == pre_assigned - 1, \
            f"assigned: {pre_assigned} -> {after['total_assigned']}"
        assert after["total_shortage"] == pre_short + 1, \
            f"shortage: {pre_short} -> {after['total_shortage']}"


# --- Log schedule + Absenteeism report ---
class TestLogAndReport:
    def test_log_endpoint_sets_timestamp(self):
        # Use a dedicated date so parallel tests don't overwrite the doc.
        d = "2026-08-10"
        requests.delete(f"{API}/schedule/{d}", params={"shift": SHIFT}, timeout=30)
        requests.post(
            f"{API}/schedule",
            json={
                "date": d, "shift": SHIFT, "line_configs": CONFIGS,
                "absent_person_ids": [], "overrides": {},
                "unassigned_keys": [], "required_overrides": {},
            },
            timeout=30,
        )
        r = requests.post(
            f"{API}/schedule/{d}/log", params={"shift": SHIFT}, timeout=30,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "logged_at" in data and data["logged_at"]

        # GET should reflect logged_at
        r2 = requests.get(f"{API}/schedule/{d}", params={"shift": SHIFT}, timeout=30)
        sched = r2.json()
        assert sched.get("logged_at"), "logged_at not persisted on GET"

    def test_log_404_when_missing(self):
        r = requests.post(
            f"{API}/schedule/1999-12-31/log", params={"shift": SHIFT}, timeout=30,
        )
        assert r.status_code == 404

    def test_absenteeism_xlsx_returns_valid_workbook(self):
        r = requests.get(
            f"{API}/reports/absenteeism",
            params={"start": "2026-08-01", "end": "2026-08-31"},
            timeout=30,
        )
        assert r.status_code == 200
        ct = r.headers.get("content-type", "")
        assert "spreadsheetml" in ct, f"unexpected content-type {ct}"
        assert "attachment" in r.headers.get("content-disposition", "")
        z = zipfile.ZipFile(io.BytesIO(r.content))
        assert len(z.namelist()) > 0

    def test_absenteeism_only_logged_filter(self):
        r = requests.get(
            f"{API}/reports/absenteeism",
            params={"start": "2026-08-01", "end": "2026-08-31", "only_logged": "true"},
            timeout=30,
        )
        assert r.status_code == 200
        # Should still be a valid xlsx
        z = zipfile.ZipFile(io.BytesIO(r.content))
        assert len(z.namelist()) > 0


# --- No regression: auto-plan / fill-shortages / suggest-lines still work ---
class TestNoRegression:
    def test_autoplan_still_works(self):
        d = "2026-08-06"
        requests.delete(f"{API}/schedule/{d}", params={"shift": SHIFT}, timeout=30)
        r = requests.post(
            f"{API}/schedule/auto-plan",
            json={"date": d, "shift": SHIFT, "absent_person_ids": [], "min_coverage": 80},
            timeout=60,
        )
        assert r.status_code == 200, r.text
        s = r.json()
        assert s["total_required"] > 0
        assert s["total_assigned"] / s["total_required"] >= 0.80
        # cleanup
        requests.delete(f"{API}/schedule/{d}", params={"shift": SHIFT}, timeout=30)

    def test_fill_shortages_still_works(self):
        # Use the SK300+GX300 schedule; call fill-shortages, expect 200
        r = requests.post(
            f"{API}/schedule/{TEST_DATE}/fill-shortages",
            params={"shift": SHIFT}, timeout=30,
        )
        assert r.status_code == 200, r.text

    def test_suggest_lines_still_works(self):
        r = requests.get(
            f"{API}/schedule/{TEST_DATE}/suggest-lines",
            params={"shift": SHIFT}, timeout=30,
        )
        assert r.status_code == 200
        d = r.json()
        assert "free_pool_size" in d and "suggestions" in d
