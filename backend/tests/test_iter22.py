"""Iter22: absence-stats, skills coverage associates, coverage exports (read-only)."""
import os
import io
import csv
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")


@pytest.fixture(scope="module")
def persons():
    r = requests.get(f"{BASE_URL}/api/persons")
    assert r.status_code == 200
    return r.json()


# Absence stats
def test_absence_stats_shape(persons):
    r = requests.get(f"{BASE_URL}/api/persons/absence-stats")
    assert r.status_code == 200, r.text
    data = r.json()
    assert isinstance(data, dict)
    ids = {p["id"] for p in persons}
    assert set(data.keys()) == ids
    assert len(data) == len(persons)
    for pid, v in data.items():
        assert set(v.keys()) == {"absent_days", "logged_days", "rate"}
        assert isinstance(v["absent_days"], int) and isinstance(v["logged_days"], int)
        assert 0 <= v["rate"] <= 1
        if v["logged_days"]:
            assert abs(v["rate"] - round(v["absent_days"] / v["logged_days"], 4)) < 1e-6
        else:
            assert v["rate"] == 0


def test_persons_count_75(persons):
    assert len(persons) == 75


# Skill coverage associates
def test_coverage_associates(persons):
    r = requests.get(f"{BASE_URL}/api/skills/coverage")
    assert r.status_code == 200
    data = r.json()
    assert data["total_associates"] == len(persons)
    pmap = {p["id"]: p for p in persons}
    for row in data["rows"]:
        assert "associates" in row
        assert len(row["associates"]) == row["trained_count"]
        expected = {p["id"] for p in persons if (p.get("skills") or {}).get(row["skill"])}
        assert {a["id"] for a in row["associates"]} == expected, row["skill"]
        for a in row["associates"]:
            assert isinstance(a["name"], str) and a["name"]
            assert a["id"] in pmap
    counts = [r["trained_count"] for r in data["rows"]]
    assert counts == sorted(counts, reverse=True)


@pytest.mark.parametrize("sort", ["count", "name"])
def test_coverage_export_csv(sort):
    r = requests.get(f"{BASE_URL}/api/skills/coverage/export", params={"fmt": "csv", "sort": sort})
    assert r.status_code == 200
    assert "text/csv" in r.headers["content-type"]
    rows = list(csv.reader(io.StringIO(r.text)))
    assert rows[0] == ["Skill", "Trained Count", "Total Associates", "Coverage %"]
    assert len(rows) > 1
    if sort == "name":
        names = [x[0].lower() for x in rows[1:]]
        assert names == sorted(names)


def test_coverage_export_xlsx():
    import openpyxl
    r = requests.get(f"{BASE_URL}/api/skills/coverage/export", params={"fmt": "xlsx"})
    assert r.status_code == 200
    assert "spreadsheetml" in r.headers["content-type"]
    wb = openpyxl.load_workbook(io.BytesIO(r.content))
    ws = wb.active
    assert ws.cell(1, 1).value == "Skill"
    assert ws.max_row > 1
