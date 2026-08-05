"""
Iteration 12 backend tests:
 - adjust action=set locks the cell (no autofill on regen)
 - fill-shortages 3-pass algorithm (free / borrow / swap-chain)
 - absenteeism report: 'By Person' is primary sheet, 'By Date' secondary
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
SHIFT = "day"
CONFIGS = [
    {"line": "SK300", "priority": 1, "run_count": 1},
    {"line": "GX300", "priority": 2, "run_count": 1},
]


def _fresh(date):
    requests.delete(f"{API}/schedule/{date}", params={"shift": SHIFT}, timeout=30)
    r = requests.post(
        f"{API}/schedule",
        json={
            "date": date, "shift": SHIFT, "line_configs": CONFIGS,
            "absent_person_ids": [], "overrides": {},
            "unassigned_keys": [], "required_overrides": {},
        },
        timeout=30,
    )
    assert r.status_code == 200, r.text
    return r.json()


def _get(sched, row_name, line_key, detail=None):
    for a in sched["assignments"]:
        if a["row_name"] == row_name and a["line_key"] == line_key:
            if detail is None or a["detail"] == detail:
                return a
    return None


def _regen(date, sched):
    """Regenerate keeping overrides/unassigned/required_overrides (like frontend refresh does)."""
    r = requests.post(
        f"{API}/schedule",
        json={
            "date": date, "shift": SHIFT, "line_configs": CONFIGS,
            "absent_person_ids": sched.get("absent_person_ids", []),
            "overrides": sched.get("overrides", {}),
            "unassigned_keys": sched.get("unassigned_keys", []),
            "required_overrides": sched.get("required_overrides", {}),
        },
        timeout=30,
    )
    assert r.status_code == 200, r.text
    return r.json()


# ---------- Adjust action=set locks the cell ----------
class TestAdjustSetLocks:
    DATE = "2026-08-20"

    def test_set_empty_picks_leaves_cell_short(self):
        pre = _fresh(self.DATE)
        target = next(
            a for a in pre["assignments"]
            if a["line_key"] == "SK300" and a["required"] >= 1
        )
        cell_key = f"{target['row_name']}||{target['line_key']}||{target['detail']}"
        req = target["required"]

        r = requests.post(
            f"{API}/schedule/{self.DATE}/adjust",
            json={"shift": SHIFT, "cell_key": cell_key, "action": "set", "person_ids": []},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        sched = r.json()
        cell = _get(sched, target["row_name"], target["line_key"], target["detail"])
        assert cell["assigned_person_ids"] == [], f"expected empty, got {cell['assigned_person_ids']}"
        assert cell["required"] == req
        assert cell["shortage"] == req
        assert cell_key in sched["unassigned_keys"], "cell_key must be added to unassigned_keys"

        # Regenerate — should NOT autofill
        again = _regen(self.DATE, sched)
        cell2 = _get(again, target["row_name"], target["line_key"], target["detail"])
        assert cell2["assigned_person_ids"] == []
        assert cell2["shortage"] == req

    def test_set_fewer_than_required_stays_partial(self):
        pre = _fresh(self.DATE)
        target = next(
            a for a in pre["assignments"]
            if a["line_key"] == "SK300" and a["required"] >= 2 and len(a["assigned_person_ids"]) >= 2
        )
        cell_key = f"{target['row_name']}||{target['line_key']}||{target['detail']}"
        keep = target["assigned_person_ids"][:1]
        req = target["required"]

        r = requests.post(
            f"{API}/schedule/{self.DATE}/adjust",
            json={"shift": SHIFT, "cell_key": cell_key, "action": "set", "person_ids": keep},
            timeout=30,
        )
        sched = r.json()
        cell = _get(sched, target["row_name"], target["line_key"], target["detail"])
        assert cell["assigned_person_ids"] == keep
        assert cell["shortage"] == req - 1

        again = _regen(self.DATE, sched)
        cell2 = _get(again, target["row_name"], target["line_key"], target["detail"])
        assert cell2["assigned_person_ids"] == keep, "must NOT autofill on regen"
        assert cell2["shortage"] == req - 1

    def test_set_more_than_required_keeps_extras(self):
        pre = _fresh(self.DATE)
        # Find someone free (assigned nowhere) — from unassigned row
        # Simpler: pick any two skilled persons, target a required=1 cell
        target = next(
            a for a in pre["assignments"]
            if a["line_key"] == "SK300" and a["required"] == 1 and len(a["assigned_person_ids"]) >= 1
        )
        cell_key = f"{target['row_name']}||{target['line_key']}||{target['detail']}"
        # Take current 1 person + one extra free skilled person if available
        r_persons = requests.get(f"{API}/persons", timeout=30).json()
        skill = target["detail"]
        already_assigned = {pid for a in pre["assignments"] for pid in a["assigned_person_ids"]}
        extra = next(
            (p for p in r_persons if p["id"] not in already_assigned
             and p.get("skills", {}).get(skill)),
            None,
        )
        if not extra:
            # fallback: pick any other person already-skilled from a different cell
            extra = next(
                (p for p in r_persons if p["id"] not in target["assigned_person_ids"]
                 and p.get("skills", {}).get(skill)),
                None,
            )
        assert extra, "need a second person with the skill"

        picks = target["assigned_person_ids"] + [extra["id"]]
        r = requests.post(
            f"{API}/schedule/{self.DATE}/adjust",
            json={"shift": SHIFT, "cell_key": cell_key, "action": "set", "person_ids": picks},
            timeout=30,
        )
        sched = r.json()
        cell = _get(sched, target["row_name"], target["line_key"], target["detail"])
        assert cell["assigned_person_ids"] == picks
        assert cell["shortage"] == 0

        again = _regen(self.DATE, sched)
        cell2 = _get(again, target["row_name"], target["line_key"], target["detail"])
        assert cell2["assigned_person_ids"] == picks


# ---------- fill-shortages 3-pass algorithm ----------
class TestFillShortagesMultiPass:
    DATE = "2026-08-21"

    def test_pass2_borrow_from_excess(self):
        """Force a scenario: cell A has an EXTRA person P, cell B is short with detail=skill of P.
        Verify fill-shortages borrows P from A into B."""
        pre = _fresh(self.DATE)
        persons = requests.get(f"{API}/persons", timeout=30).json()
        person_by_id = {p["id"]: p for p in persons}
        assigned_now = {pid for a in pre["assignments"] for pid in a["assigned_person_ids"]}
        # Pick any cell B with required>=1
        pool = [a for a in pre["assignments"] if a["required"] >= 1 and a["assigned_person_ids"]]
        for B in pool:
            skillB = B["detail"]
            # Find a different cell A whose assigned person also has skillB (so borrowing is possible)
            for A in pool:
                if A is B or A["line_key"] == B["line_key"] and A["row_name"] == B["row_name"] and A["detail"] == B["detail"]:
                    continue
                donor_candidate = next(
                    (pid for pid in A["assigned_person_ids"]
                     if person_by_id.get(pid, {}).get("skills", {}).get(skillB)),
                    None,
                )
                if donor_candidate:
                    target_A, target_B, borrow_id = A, B, donor_candidate
                    break
            else:
                continue
            break
        else:
            pytest.skip("could not construct borrow scenario")

        A_key = f"{target_A['row_name']}||{target_A['line_key']}||{target_A['detail']}"
        B_key = f"{target_B['row_name']}||{target_B['line_key']}||{target_B['detail']}"

        # Step 1: Ensure A has an EXTRA — add borrow_id if not already, so A now has required+1
        new_A_ids = list(target_A["assigned_person_ids"])
        if borrow_id not in new_A_ids:
            new_A_ids.append(borrow_id)
        else:
            # If already assigned, add one more skilled person to create excess
            extras = [p["id"] for p in persons
                      if p["id"] not in assigned_now and p.get("skills", {}).get(target_A["detail"])]
            if not extras:
                pytest.skip("no extras available to create excess")
            new_A_ids.append(extras[0])
        r = requests.post(
            f"{API}/schedule/{self.DATE}/adjust",
            json={"shift": SHIFT, "cell_key": A_key, "action": "set", "person_ids": new_A_ids},
            timeout=30,
        )
        assert r.status_code == 200

        # Step 2: Clear B → shortage
        r = requests.post(
            f"{API}/schedule/{self.DATE}/adjust",
            json={"shift": SHIFT, "cell_key": B_key, "action": "set", "person_ids": []},
            timeout=30,
        )
        sched = r.json()
        cellA = _get(sched, target_A["row_name"], target_A["line_key"], target_A["detail"])
        cellB = _get(sched, target_B["row_name"], target_B["line_key"], target_B["detail"])
        assert len(cellA["assigned_person_ids"]) > cellA["required"], "A must have excess"
        assert cellB["shortage"] >= 1

        # Step 3: fill-shortages should borrow from A into B
        r = requests.post(f"{API}/schedule/{self.DATE}/fill-shortages",
                         params={"shift": SHIFT}, timeout=30)
        assert r.status_code == 200, r.text
        filled = r.json()
        cellB2 = _get(filled, target_B["row_name"], target_B["line_key"], target_B["detail"])
        assert cellB2["shortage"] == 0, (
            f"fill-shortages failed to close B; assigned={cellB2['assigned_person_ids']} "
            f"required={cellB2['required']}"
        )

    def test_fill_shortages_general_closes_all(self):
        """Baseline: after fresh schedule for 2026-08-06 the total_shortage should be 0
        already (per iter11b baseline). But if we clear a cell, fill-shortages should recover."""
        d = "2026-08-22"
        pre = _fresh(d)
        # Pick any cell with required>=1 and clear it
        target = next(a for a in pre["assignments"] if a["required"] >= 1 and a["assigned_person_ids"])
        cell_key = f"{target['row_name']}||{target['line_key']}||{target['detail']}"
        r = requests.post(
            f"{API}/schedule/{d}/adjust",
            json={"shift": SHIFT, "cell_key": cell_key, "action": "clear", "person_ids": []},
            timeout=30,
        )
        s = r.json()
        cell = _get(s, target["row_name"], target["line_key"], target["detail"])
        assert cell["shortage"] >= 1 or cell["assigned_person_ids"] != target["assigned_person_ids"]

        r = requests.post(f"{API}/schedule/{d}/fill-shortages", params={"shift": SHIFT}, timeout=30)
        filled = r.json()
        cell2 = _get(filled, target["row_name"], target["line_key"], target["detail"])
        # Either refilled from free pool or borrowed
        assert cell2["shortage"] == 0, f"expected 0 shortage after fill, got {cell2}"


# ---------- Absenteeism report — sheet ordering ----------
class TestAbsenteeismReportSheets:
    def test_by_person_first_sheet(self):
        # Ensure at least one date has logged absence in range
        d = "2026-08-23"
        requests.delete(f"{API}/schedule/{d}", params={"shift": SHIFT}, timeout=30)
        # get some person id
        p = requests.get(f"{API}/persons", timeout=30).json()[0]
        r = requests.post(
            f"{API}/schedule",
            json={
                "date": d, "shift": SHIFT, "line_configs": CONFIGS,
                "absent_person_ids": [p["id"]], "overrides": {},
                "unassigned_keys": [], "required_overrides": {},
            },
            timeout=30,
        )
        assert r.status_code == 200

        r = requests.get(
            f"{API}/reports/absenteeism",
            params={"start": "2026-08-01", "end": "2026-08-31"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        buf = io.BytesIO(r.content)
        with zipfile.ZipFile(buf) as zf:
            wb_xml = zf.read("xl/workbook.xml").decode("utf-8")
        # openpyxl writes sheet nodes in visual order — check "By Person" appears before "By Date"
        idx_person = wb_xml.find('name="By Person"')
        idx_date = wb_xml.find('name="By Date"')
        assert idx_person != -1, "By Person sheet missing"
        assert idx_date != -1, "By Date sheet missing"
        assert idx_person < idx_date, "By Person must be the FIRST sheet"

    def test_by_person_columns(self):
        import openpyxl
        r = requests.get(
            f"{API}/reports/absenteeism",
            params={"start": "2026-08-01", "end": "2026-08-31"},
            timeout=30,
        )
        assert r.status_code == 200
        wb = openpyxl.load_workbook(io.BytesIO(r.content))
        assert wb.sheetnames[0] == "By Person", f"got {wb.sheetnames}"
        ws = wb["By Person"]
        headers = [ws.cell(row=1, column=c).value for c in range(1, 5)]
        assert headers == ["Name", "Employee Type", "Total Absent Days", "Dates Absent"], headers
