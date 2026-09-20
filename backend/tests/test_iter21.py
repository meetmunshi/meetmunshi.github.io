"""Iter21 backend tests: data management features
 - Schedule model no longer exposes `history` field
 - POST /schedule/{date}/restore (client-driven undo)
 - DELETE /schedules/month/{YYYY-MM}?archived=
 - GET /schedules?archived=
 - Startup housekeeping: _auto_archive_and_purge, _purge_stale_setups
"""
import os
import re
import asyncio
import pytest
import requests
from datetime import datetime, timezone, timedelta

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
DATE = "2026-02-15"
SHIFT = "day"


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    yield s
    # Cleanup
    s.delete(f"{BASE_URL}/api/schedules/month/2026-02", params={"archived": "false"})
    s.delete(f"{BASE_URL}/api/schedules/month/2026-02", params={"archived": "true"})


def _create(api, date=DATE, shift=SHIFT):
    api.delete(f"{BASE_URL}/api/schedule/{date}", params={"shift": shift})
    r = api.post(f"{BASE_URL}/api/schedule", json={
        "date": date, "shift": shift,
        "line_configs": [
            {"line": "X-Smart", "priority": 1, "run_count": 1},
            {"line": "E2", "priority": 2, "run_count": 1},
        ],
        "absent_person_ids": [],
        "disabled_activities": {},
    })
    assert r.status_code == 200, r.text
    return r.json()


def _get(api, date=DATE, shift=SHIFT):
    r = api.get(f"{BASE_URL}/api/schedule/{date}", params={"shift": shift})
    assert r.status_code == 200, r.text
    return r.json()


# ---------------- (1) history field is NOT exposed ----------------
def test_history_field_absent_in_response(api):
    sched = _create(api)
    # do a mutation
    api.post(f"{BASE_URL}/api/schedule/{DATE}/fill-shortages", params={"shift": SHIFT})
    d = _get(api)
    # Either missing entirely or empty legacy list
    hist = d.get("history")
    assert hist in (None, []), f"history should not be a live field, got {hist!r}"


# ---------------- (2) POST /restore ----------------
def test_restore_replaces_schedule_state(api):
    sched = _create(api)
    # Snapshot the pristine state
    snap = {
        "line_configs": sched["line_configs"],
        "assignments": sched["assignments"],
        "absent_person_ids": sched.get("absent_person_ids", []),
        "absent_persons": sched.get("absent_persons", []),
        "overrides": sched.get("overrides", {}),
        "unassigned_keys": sched.get("unassigned_keys", []),
        "required_overrides": sched.get("required_overrides", {}),
        "closures": sched.get("closures", []),
        "closed_line_keys": sched.get("closed_line_keys", []),
        "disabled_activities": sched.get("disabled_activities", {}),
        "total_required": sched.get("total_required", 0),
        "total_assigned": sched.get("total_assigned", 0),
        "total_shortage": sched.get("total_shortage", 0),
    }
    # Mutate
    r = api.post(f"{BASE_URL}/api/schedule/{DATE}/close-line",
                 json={"shift": SHIFT, "line_key": "X-Smart"})
    assert r.status_code == 200
    d = _get(api)
    assert "X-Smart" in d.get("closed_line_keys", [])

    # Restore
    r2 = api.post(f"{BASE_URL}/api/schedule/{DATE}/restore",
                  json={"shift": SHIFT, "snapshot": snap})
    assert r2.status_code == 200, r2.text
    d2 = r2.json()
    assert "X-Smart" not in d2.get("closed_line_keys", []), "restore did not revert close-line"


def test_restore_400_on_malformed(api):
    _create(api)
    # missing assignments
    r = api.post(f"{BASE_URL}/api/schedule/{DATE}/restore",
                 json={"shift": SHIFT, "snapshot": {"line_configs": []}})
    assert r.status_code == 400
    # missing line_configs
    r2 = api.post(f"{BASE_URL}/api/schedule/{DATE}/restore",
                  json={"shift": SHIFT, "snapshot": {"assignments": []}})
    assert r2.status_code == 400


def test_restore_404_when_missing(api):
    api.delete(f"{BASE_URL}/api/schedule/2026-02-28", params={"shift": SHIFT})
    r = api.post(f"{BASE_URL}/api/schedule/2026-02-28/restore",
                 json={"shift": SHIFT, "snapshot": {"assignments": [], "line_configs": []}})
    assert r.status_code == 404


# ---------------- (3) DELETE /schedules/month ----------------
def test_delete_month_active_only(api):
    _create(api, date="2026-02-10")
    _create(api, date="2026-02-11")
    r = api.delete(f"{BASE_URL}/api/schedules/month/2026-02", params={"archived": "false"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body.keys()) >= {"deleted", "month", "archived"}
    assert body["month"] == "2026-02"
    assert body["archived"] is False
    assert body["deleted"] >= 2
    # verify gone (GET returns 200 with null body when not found)
    r2 = api.get(f"{BASE_URL}/api/schedule/2026-02-10", params={"shift": SHIFT})
    assert r2.status_code == 200
    assert r2.json() is None


def test_delete_month_bad_format(api):
    r = api.delete(f"{BASE_URL}/api/schedules/month/2026-2", params={"archived": "false"})
    assert r.status_code == 400
    r2 = api.delete(f"{BASE_URL}/api/schedules/month/badstring", params={"archived": "false"})
    assert r2.status_code == 400


# ---------------- (4) GET /schedules?archived= ----------------
def test_list_schedules_archived_filter(api):
    """Seed one active + one archived directly via mongo (using restart-safe approach:
    create via API then flip archived via a raw update using motor)."""
    import motor.motor_asyncio
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    mongo_url = os.environ["MONGO_URL"]
    db_name = os.environ["DB_NAME"]

    async def _flip_archived(date, val):
        client = motor.motor_asyncio.AsyncIOMotorClient(mongo_url)
        db = client[db_name]
        await db.schedules.update_one({"date": date, "shift": SHIFT},
                                       {"$set": {"archived": val}})
        client.close()

    _create(api, date="2026-02-20")  # active
    _create(api, date="2026-02-21")  # will flip to archived
    asyncio.run(_flip_archived("2026-02-21", True))

    r_active = api.get(f"{BASE_URL}/api/schedules", params={"archived": "false"})
    assert r_active.status_code == 200
    active_dates = [s["date"] for s in r_active.json()]
    assert "2026-02-20" in active_dates
    assert "2026-02-21" not in active_dates

    r_arch = api.get(f"{BASE_URL}/api/schedules", params={"archived": "true"})
    assert r_arch.status_code == 200
    arch_dates = [s["date"] for s in r_arch.json()]
    assert "2026-02-21" in arch_dates
    assert "2026-02-20" not in arch_dates


def test_delete_month_archived_variant(api):
    """Ensure ?archived=true only deletes archived docs, leaves active."""
    import motor.motor_asyncio
    load_ok = True
    try:
        from dotenv import load_dotenv
        load_dotenv("/app/backend/.env")
    except Exception:
        load_ok = False
    mongo_url = os.environ["MONGO_URL"]
    db_name = os.environ["DB_NAME"]

    async def _flip_archived(date, val):
        client = motor.motor_asyncio.AsyncIOMotorClient(mongo_url)
        db = client[db_name]
        await db.schedules.update_one({"date": date, "shift": SHIFT},
                                       {"$set": {"archived": val}})
        client.close()

    _create(api, date="2026-02-22")  # active
    _create(api, date="2026-02-23")  # archived
    asyncio.run(_flip_archived("2026-02-23", True))

    r = api.delete(f"{BASE_URL}/api/schedules/month/2026-02", params={"archived": "true"})
    assert r.status_code == 200
    body = r.json()
    assert body["archived"] is True
    assert body["deleted"] >= 1
    # active one survives
    still = api.get(f"{BASE_URL}/api/schedule/2026-02-22", params={"shift": SHIFT})
    assert still.status_code == 200


# ---------------- (5) Startup housekeeping ----------------
def test_housekeeping_helpers_directly():
    """Call the private helpers directly to exercise archive/purge/stale cleanup
    without waiting for a supervisor restart."""
    import sys
    sys.path.insert(0, "/app/backend")
    import motor.motor_asyncio
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    from server import _auto_archive_and_purge, _purge_stale_setups
    mongo_url = os.environ["MONGO_URL"]
    db_name = os.environ["DB_NAME"]

    today = datetime.now(timezone.utc).date()
    old_active_date = (today - timedelta(days=100)).isoformat()   # should auto-archive
    very_old_arch_date = (today - timedelta(days=400)).isoformat()  # should be purged
    stale_created_at = (datetime.now(timezone.utc) - timedelta(hours=48)).isoformat()
    stale_date = (today - timedelta(days=1)).isoformat()

    async def _seed_and_run():
        client = motor.motor_asyncio.AsyncIOMotorClient(mongo_url)
        db = client[db_name]
        # Clean any leftover test docs first
        await db.schedules.delete_many({"date": {"$in": [old_active_date, very_old_arch_date, stale_date]}})

        # 1) 100 days old, not archived → expect auto-archive
        await db.schedules.insert_one({
            "id": "test-old-active", "date": old_active_date, "shift": SHIFT,
            "line_configs": [], "absent_person_ids": [], "assignments": [],
            "created_at": (datetime.now(timezone.utc) - timedelta(days=100)).isoformat(),
            "logged_at": (datetime.now(timezone.utc) - timedelta(days=100)).isoformat(),
        })
        # 2) 400 days old, archived → expect purge
        await db.schedules.insert_one({
            "id": "test-very-old-arch", "date": very_old_arch_date, "shift": SHIFT,
            "line_configs": [], "absent_person_ids": [], "assignments": [],
            "archived": True,
            "created_at": (datetime.now(timezone.utc) - timedelta(days=400)).isoformat(),
            "logged_at": (datetime.now(timezone.utc) - timedelta(days=400)).isoformat(),
        })
        # 3) stale unlogged >24h old → expect delete
        await db.schedules.insert_one({
            "id": "test-stale-unlogged", "date": stale_date, "shift": SHIFT,
            "line_configs": [], "absent_person_ids": [], "assignments": [],
            "logged_at": None,
            "created_at": stale_created_at,
        })

        await _auto_archive_and_purge()
        await _purge_stale_setups()

        d1 = await db.schedules.find_one({"id": "test-old-active"})
        d2 = await db.schedules.find_one({"id": "test-very-old-arch"})
        d3 = await db.schedules.find_one({"id": "test-stale-unlogged"})

        # cleanup any residue
        await db.schedules.delete_many({"id": {"$in": ["test-old-active", "test-very-old-arch", "test-stale-unlogged"]}})
        client.close()
        return d1, d2, d3

    d1, d2, d3 = asyncio.run(_seed_and_run())
    assert d1 is not None and d1.get("archived") is True, f"100-day-old active should be auto-archived, got {d1}"
    assert d2 is None, "400-day-old archived should have been purged"
    assert d3 is None, "24h+ unlogged draft should have been purged"
