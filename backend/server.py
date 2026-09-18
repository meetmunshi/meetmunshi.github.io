from fastapi import FastAPI, APIRouter, UploadFile, File, HTTPException, Response
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import io
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Dict, Optional, Tuple
import uuid
from datetime import datetime, timezone
from collections import defaultdict

import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

app = FastAPI(title="Resource Scheduling Board v2")
api_router = APIRouter(prefix="/api")


# ----------------- Models -----------------
class Person(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    sn: Optional[int] = None
    name: str
    surname: Optional[str] = ""
    qualification: Optional[str] = ""
    employee_type: Optional[str] = ""
    mobile: Optional[str] = ""
    skills: Dict[str, bool] = {}


class LineDetail(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    detail: str
    line: str
    row_name: str = ""
    persons_required: int


class LineConfig(BaseModel):
    line: str
    priority: int = 5           # 1 = highest
    run_count: int = 1          # 1..N replicas of this line


class ScheduleRequest(BaseModel):
    date: str
    shift: str = "day"           # day | evening | night
    line_configs: List[LineConfig] = []
    absent_person_ids: List[str] = []
    overrides: Dict[str, List[str]] = {}   # key = f"{row_name}||{line_key}||{detail}" or f"{row_name}||{line_key}" -> person_ids
    unassigned_keys: List[str] = []
    required_overrides: Dict[str, int] = {}  # key = f"{row_name}||{line_key}||{detail}" -> new required count
    disabled_activities: Dict[str, List[str]] = {}   # line -> list of row_names to skip for that line only


class CellAssignment(BaseModel):
    row_name: str
    line: str
    run: int                      # 1..run_count
    line_key: str                 # e.g., "X-Smart" or "X-Smart #2"
    detail: str
    required: int
    assigned_person_ids: List[str]
    assigned_person_names: List[str]
    shortage: int


class Schedule(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    date: str
    shift: str = "day"
    line_configs: List[LineConfig]
    absent_person_ids: List[str]
    assignments: List[CellAssignment]
    overrides: Dict[str, List[str]] = {}
    unassigned_keys: List[str] = []
    required_overrides: Dict[str, int] = {}
    logged_at: Optional[str] = None
    history: List[dict] = []                      # bounded undo stack (last 5 actions)
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    total_required: int = 0
    total_assigned: int = 0
    total_shortage: int = 0
    closures: List[dict] = []                     # [{line_key, line, closed_at, freed_count}]
    closed_line_keys: List[str] = []
    disabled_activities: Dict[str, List[str]] = {}   # line -> row_names deselected only for that line


MAX_HISTORY = 5


def _undoable_snapshot(sched_doc: dict, action: str) -> dict:
    """Capture the subset of schedule fields needed to restore this state."""
    return {
        "action": action,
        "snapshot_at": datetime.now(timezone.utc).isoformat(),
        "line_configs": [dict(c) for c in (sched_doc.get("line_configs") or [])],
        "absent_person_ids": list(sched_doc.get("absent_person_ids") or []),
        "overrides": dict(sched_doc.get("overrides") or {}),
        "unassigned_keys": list(sched_doc.get("unassigned_keys") or []),
        "required_overrides": dict(sched_doc.get("required_overrides") or {}),
        "assignments": [dict(a) for a in (sched_doc.get("assignments") or [])],
        "closures": [dict(c) for c in (sched_doc.get("closures") or [])],
        "closed_line_keys": list(sched_doc.get("closed_line_keys") or []),
        "disabled_activities": {k: list(v) for k, v in (sched_doc.get("disabled_activities") or {}).items()},
        "total_required": sched_doc.get("total_required", 0),
        "total_assigned": sched_doc.get("total_assigned", 0),
        "total_shortage": sched_doc.get("total_shortage", 0),
    }


async def _push_history(date: str, shift: str, sched_doc: dict, action: str) -> None:
    """Append a snapshot of the CURRENT schedule state to history (bounded to MAX_HISTORY)."""
    snap = _undoable_snapshot(sched_doc, action)
    await db.schedules.update_one(
        {"date": date, "shift": shift},
        {"$push": {"history": {"$each": [snap], "$slice": -MAX_HISTORY}}},
    )


# ----------------- Excel parsing & seeding -----------------
def _parse_persons_sheet(ws) -> List[Person]:
    headers = [ws.cell(row=1, column=c).value for c in range(1, ws.max_column + 1)]
    skill_start_col = 9
    skill_headers = [str(h).strip() for h in headers[skill_start_col - 1:] if h]

    persons: List[Person] = []
    for r in range(2, ws.max_row + 1):
        name = ws.cell(row=r, column=2).value
        if not name:
            continue
        sn_v = ws.cell(row=r, column=1).value
        skills = {
            sk: (str(ws.cell(row=r, column=skill_start_col + i).value).strip().lower() == "yes"
                 if ws.cell(row=r, column=skill_start_col + i).value is not None else False)
            for i, sk in enumerate(skill_headers)
        }
        persons.append(Person(
            sn=int(sn_v) if isinstance(sn_v, (int, float)) else None,
            name=str(name).strip(),
            surname=str(ws.cell(row=r, column=3).value or "").strip(),
            qualification=str(ws.cell(row=r, column=5).value or "").strip(),
            employee_type=str(ws.cell(row=r, column=6).value or "").strip(),
            mobile=str(ws.cell(row=r, column=8).value or "").strip(),
            skills=skills,
        ))
    return persons


def _coerce_int(v) -> int:
    try:
        return int(v) if v is not None else 0
    except (ValueError, TypeError):
        return 0


def _parse_lines_sheet(ws) -> List[LineDetail]:
    details: List[LineDetail] = []
    for r in range(2, ws.max_row + 1):
        detail = ws.cell(row=r, column=2).value
        line = ws.cell(row=r, column=3).value
        if not detail or not line:
            continue
        row_name = ws.cell(row=r, column=5).value
        details.append(LineDetail(
            detail=str(detail).strip(),
            line=str(line).strip(),
            row_name=str(row_name).strip() if row_name else str(detail).strip(),
            persons_required=_coerce_int(ws.cell(row=r, column=4).value),
        ))
    return details


def parse_excel_bytes(content: bytes) -> Tuple[List[Person], List[LineDetail]]:
    wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
    sheet_names = {s.lower(): s for s in wb.sheetnames}
    persons_sheet = sheet_names.get("person - skill") or wb.sheetnames[0]
    lines_sheet = sheet_names.get("assembly line") or wb.sheetnames[1]
    persons = _parse_persons_sheet(wb[persons_sheet])
    details = _parse_lines_sheet(wb[lines_sheet])
    return persons, details


async def seed_from_file_if_empty():
    persons_count = await db.persons.count_documents({})
    details_count = await db.line_details.count_documents({})
    if persons_count > 0 and details_count > 0:
        return
    seed_path = ROOT_DIR / "seed_data.xlsx"
    if not seed_path.exists():
        return
    with open(seed_path, "rb") as f:
        content = f.read()
    persons, details = parse_excel_bytes(content)
    # Only insert into collections that are empty — never delete existing data.
    if persons_count == 0 and persons:
        await db.persons.insert_many([p.model_dump() for p in persons])
    if details_count == 0 and details:
        await db.line_details.insert_many([d.model_dump() for d in details])
    logger.info(f"Seeded {len(persons)} persons and {len(details)} line details")


# ----------------- Endpoints -----------------
@api_router.get("/")
async def root():
    return {"message": "Resource Scheduling API v2"}


@api_router.get("/persons", response_model=List[Person])
async def list_persons():
    docs = await db.persons.find({}, {"_id": 0}).to_list(1000)
    docs.sort(key=lambda p: (p.get("name", "").lower(), p.get("surname", "").lower()))
    return [Person(**d) for d in docs]


@api_router.get("/lines")
async def list_lines():
    docs = await db.line_details.find({}, {"_id": 0}).to_list(1000)
    by_line: Dict[str, List[dict]] = {}
    order: List[str] = []
    row_names_set: List[str] = []
    for d in docs:
        line = d["line"]
        if line not in by_line:
            by_line[line] = []
            order.append(line)
        by_line[line].append(d)
        rn = d.get("row_name") or d["detail"]
        if rn not in row_names_set:
            row_names_set.append(rn)
    return {
        "lines": [{"line": l, "details": by_line[l]} for l in order],
        "row_names": row_names_set,
    }


@api_router.get("/details", response_model=List[LineDetail])
async def list_details():
    docs = await db.line_details.find({}, {"_id": 0}).to_list(1000)
    return [LineDetail(**d) for d in docs]


@api_router.post("/upload-excel")
async def upload_excel(file: UploadFile = File(...), confirm: bool = False):
    """Replace the current persons + line_details roster with the contents of the uploaded Excel.
    Requires ?confirm=true to guard against accidental data loss — the client must explicitly opt in."""
    if not confirm:
        raise HTTPException(
            400,
            "Uploading replaces the current roster. Retry with ?confirm=true to proceed.",
        )
    if not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(400, "Only .xlsx/.xls files supported")
    content = await file.read()
    try:
        persons, details = parse_excel_bytes(content)
    except Exception as e:
        raise HTTPException(400, f"Failed to parse excel: {e}")
    if not persons or not details:
        raise HTTPException(400, "No data found")
    await db.persons.delete_many({})
    await db.line_details.delete_many({})
    await db.persons.insert_many([p.model_dump() for p in persons])
    await db.line_details.insert_many([d.model_dump() for d in details])
    return {"persons": len(persons), "details": len(details)}


def _person_full_name(p: dict) -> str:
    return f"{p.get('name','').strip()} {p.get('surname','').strip()}".strip()


def _names_from_ids(ids: List[str], person_by_id: Dict[str, dict]) -> List[str]:
    return [_person_full_name(person_by_id[pid]) for pid in ids if pid in person_by_id]


def _apply_override_picks(
    cell_key: str,
    overrides: Dict[str, List[str]],
    person_by_id: Dict[str, dict],
    absent_set: set,
) -> List[str]:
    """Return picks locked in by user overrides for this cell (skips absent/unknown)."""
    if cell_key not in overrides:
        return []
    return [
        pid for pid in overrides[cell_key]
        if pid in person_by_id and pid not in absent_set
    ]


def _select_eligible(
    detail_name: str,
    remaining: int,
    persons: List[dict],
    absent_set: set,
    used_globally: set,
    used_locally: List[str],
    person_total_skills: Dict[str, int],
) -> List[dict]:
    """Return specialist-first eligible candidates for a cell."""
    eligible = [
        p for p in persons
        if bool(p.get("skills", {}).get(detail_name))
        and p["id"] not in absent_set
        and p["id"] not in used_globally
        and p["id"] not in used_locally
    ]
    eligible.sort(key=lambda p: (person_total_skills.get(p["id"], 0), p.get("name", "")))
    return eligible[:remaining]


def _build_work_items(
    line_configs: List[LineConfig],
    details_by_line: Dict[str, List[dict]],
) -> List[Tuple[int, str, int, dict]]:
    sorted_configs = sorted(line_configs, key=lambda c: (c.priority, c.line))
    work: List[Tuple[int, str, int, dict]] = []
    for cfg in sorted_configs:
        for run_idx in range(1, max(1, cfg.run_count) + 1):
            for d in details_by_line.get(cfg.line, []):
                work.append((cfg.priority, cfg.line, run_idx, d))
    return work


def _generate_assignments(
    persons: List[dict],
    details: List[dict],
    line_configs: List[LineConfig],
    absent_ids: List[str],
    overrides: Dict[str, List[str]],
    unassigned_keys: List[str],
    required_overrides: Optional[Dict[str, int]] = None,
    disabled_activities: Optional[Dict[str, List[str]]] = None,
) -> List[CellAssignment]:
    persons = persons or []
    details = details or []
    overrides = overrides or {}
    unassigned_keys = unassigned_keys or []
    required_overrides = required_overrides or {}
    # Normalise: line -> set(row_names)
    disabled_by_line = {ln: set(rows or []) for ln, rows in (disabled_activities or {}).items()}

    person_total_skills = {p["id"]: sum(1 for v in p.get("skills", {}).values() if v) for p in persons}
    person_by_id = {p["id"]: p for p in persons}
    absent_set = set(absent_ids)
    unassigned_set = set(unassigned_keys)

    details_by_line: Dict[str, List[dict]] = defaultdict(list)
    for d in details:
        details_by_line[d["line"]].append(d)

    work = _build_work_items(line_configs, details_by_line)

    # Lock in override people up-front so auto-fill won't reuse them
    assigned_person_ids: set = set()
    for pids in overrides.values():
        for pid in pids:
            if pid in person_by_id and pid not in absent_set:
                assigned_person_ids.add(pid)

    results: List[CellAssignment] = []
    for _priority, line, run_idx, d in work:
        detail_name = d["detail"]
        row_name = d.get("row_name") or detail_name
        line_key = f"{line}" if run_idx == 1 else f"{line} #{run_idx}"
        cell_key_detail = f"{row_name}||{line_key}||{detail_name}"
        cell_key_agg = f"{row_name}||{line_key}"

        # Required can be overridden by user (per-detail preferred, else per-aggregate).
        # Line-specific disabled activities force required=0 regardless of overrides.
        base_required = d["persons_required"]
        if row_name in disabled_by_line.get(line, set()):
            required = 0
        else:
            required = required_overrides.get(cell_key_detail)
            if required is None:
                required = required_overrides.get(cell_key_agg, base_required)
            required = max(0, int(required))

        # Overrides — prefer detail-specific key, fall back to aggregate key
        picks = _apply_override_picks(cell_key_detail, overrides, person_by_id, absent_set)
        if not picks:
            picks = _apply_override_picks(cell_key_agg, overrides, person_by_id, absent_set)
        picks = list(picks)

        was_cleared = cell_key_detail in unassigned_set or cell_key_agg in unassigned_set
        if not was_cleared:
            remaining = required - len(picks)
            if remaining > 0:
                extras = _select_eligible(
                    detail_name, remaining, persons,
                    absent_set, assigned_person_ids, picks, person_total_skills,
                )
                picks.extend(c["id"] for c in extras)

        assigned_person_ids.update(picks)
        results.append(CellAssignment(
            row_name=row_name, line=line, run=run_idx, line_key=line_key,
            detail=detail_name, required=required,
            assigned_person_ids=picks,
            assigned_person_names=_names_from_ids(picks, person_by_id),
            shortage=max(0, required - len(picks)),
        ))

    return results


@api_router.post("/schedule", response_model=Schedule)
async def generate_schedule(req: ScheduleRequest):
    persons = await db.persons.find({}, {"_id": 0}).to_list(1000)
    details = await db.line_details.find({}, {"_id": 0}).to_list(1000)
    if not persons or not details:
        raise HTTPException(400, "No data seeded.")
    # Canonicalise incoming line names (E2 vs "Element 2" etc.)
    master_lines = {d["line"] for d in details}
    for cfg in req.line_configs:
        cfg.line = _canonical_line(cfg.line, master_lines)
    assignments = _generate_assignments(
        persons, details, req.line_configs, req.absent_person_ids,
        req.overrides, req.unassigned_keys, req.required_overrides,
        req.disabled_activities,
    )
    total_req = sum(a.required for a in assignments)
    total_assigned = sum(len(a.assigned_person_ids) for a in assignments)
    total_short = sum(a.shortage for a in assignments)
    sched = Schedule(
        date=req.date, shift=req.shift, line_configs=req.line_configs,
        absent_person_ids=req.absent_person_ids,
        assignments=assignments, overrides=req.overrides,
        unassigned_keys=req.unassigned_keys,
        required_overrides=req.required_overrides,
        disabled_activities=req.disabled_activities,
        total_required=total_req, total_assigned=total_assigned, total_shortage=total_short,
    )
    doc = sched.model_dump()
    # Preserve implicit server-side state across regenerations so mutating callers
    # (adjust, late-arrival, etc.) don't accidentally wipe closures / undo history.
    existing = await db.schedules.find_one(
        {"date": req.date, "shift": req.shift},
        {"_id": 0, "logged_at": 1, "history": 1, "closures": 1, "closed_line_keys": 1},
    )
    if existing:
        if existing.get("logged_at"):
            doc["logged_at"] = existing["logged_at"]
            sched.logged_at = existing["logged_at"]
        doc["history"] = existing.get("history") or []
        doc["closures"] = existing.get("closures") or []
        doc["closed_line_keys"] = existing.get("closed_line_keys") or []
    await db.schedules.replace_one({"date": req.date, "shift": req.shift}, doc, upsert=True)
    return sched


class AutoPlanRequest(BaseModel):
    date: str
    shift: str = "day"
    absent_person_ids: List[str] = []
    min_coverage: int = 80          # only include lines with at least this coverage %


def _skill_totals(persons: List[dict]) -> Dict[str, int]:
    return {p["id"]: sum(1 for v in p.get("skills", {}).values() if v) for p in persons}


# Known aliases → canonical (lowercase key matches). Add here as data drift is spotted.
LINE_ALIASES_LOWER: Dict[str, str] = {
    "element 2": "E2",
    "element2": "E2",
}

# Support Ops lines are treated specially throughout the app:
# they always appear fully planned on the board and are excluded from
# per-line activity selection. Match by case-insensitive base name.
SUPPORT_LINES_LOWER: set = {"monkey", "kk", "spares", "vehicle", "crimping", "os", "5s+others"}


def _is_support_line(name: str) -> bool:
    return isinstance(name, str) and name.strip().lower() in SUPPORT_LINES_LOWER


def _canonical_line(name: str, master_lines: set) -> str:
    """Return the canonical line name from the master list, resolving aliases and casing."""
    if not name:
        return name
    if name in master_lines:
        return name
    key = name.strip().lower()
    alias = LINE_ALIASES_LOWER.get(key)
    if alias and alias in master_lines:
        return alias
    for m in master_lines:
        if m.lower() == key:
            return m
    return name


def _group_details_by_line(details: List[dict]) -> Dict[str, List[dict]]:
    grouped: Dict[str, List[dict]] = defaultdict(list)
    for d in details:
        grouped[d["line"]].append(d)
    return grouped


def _pick_specialists(
    detail_name: str,
    limit: int,
    persons: List[dict],
    skill_totals: Dict[str, int],
    excluded_ids: set,
) -> List[dict]:
    """Return up to `limit` skilled candidates, specialist-first, excluding used/absent."""
    eligible = [
        p for p in persons
        if bool(p.get("skills", {}).get(detail_name)) and p["id"] not in excluded_ids
    ]
    eligible.sort(key=lambda p: (skill_totals.get(p["id"], 0), p.get("name", "")))
    return eligible[:limit]


def _max_bipartite_matching(
    cells: List[dict],
    persons: List[dict],
    absent_set: set,
    skill_totals: Dict[str, int],
    initial: Optional[Dict[int, List[str]]] = None,
) -> Dict[int, List[str]]:
    """Global maximum bipartite matching between (cell seats) and (available persons).

    - Every cell contributes `required` seats.
    - A person can fill a seat iff person.skills[cell.detail] is truthy.
    - Each person is used at most once.
    - Kuhn's algorithm (augmenting paths); seats iterated by scarcity ASC, candidates
      ordered by skill_total ASC (specialist-first) — so rarest skills claim
      specialists first, matching the existing scheduling philosophy.
    - If `initial` is provided, the matching is seeded with those assignments and only
      empty/short seats are augmented — this minimises reshuffles: an already-matched
      person only moves if an augmenting path proves the move is necessary to fill
      another seat.

    Returns: {cell_index: [person_id, ...]}
    """
    # Expand seats
    seats: List[Tuple[int, int]] = []  # (cell_index, seat_index_within_cell)
    for ci, c in enumerate(cells):
        for r in range(int(c.get("required", 0))):
            seats.append((ci, r))

    persons_avail = [p for p in persons if p["id"] not in absent_set]
    avail_ids = {p["id"] for p in persons_avail}

    # Scarcity per detail (fewer eligible = rarer)
    scarcity: Dict[str, int] = {}
    for c in cells:
        d = c["detail"]
        if d in scarcity:
            continue
        scarcity[d] = sum(
            1 for p in persons_avail if bool(p.get("skills", {}).get(d))
        )

    # Order seats: rarest skill first, then by cell index for stability
    seats.sort(key=lambda s: (scarcity.get(cells[s[0]]["detail"], 0), s[0], s[1]))

    # Adjacency per seat: specialist-first (fewer skills), stable by name
    adj: Dict[Tuple[int, int], List[str]] = {}
    for s in seats:
        d = cells[s[0]]["detail"]
        elig = [p for p in persons_avail if bool(p.get("skills", {}).get(d))]
        elig.sort(key=lambda p: (skill_totals.get(p["id"], 0), p.get("name", "")))
        adj[s] = [p["id"] for p in elig]

    match_seat: Dict[Tuple[int, int], str] = {}
    match_person: Dict[str, Tuple[int, int]] = {}

    # Seed matching from current schedule (skip absents / unqualified)
    if initial:
        for ci, pids in initial.items():
            req = int(cells[ci].get("required", 0))
            d = cells[ci]["detail"]
            person_map = {p["id"]: p for p in persons_avail}
            slot_index = 0
            for pid in pids:
                if slot_index >= req:
                    break
                if pid not in avail_ids or pid in match_person:
                    continue
                p = person_map.get(pid)
                if not p or not bool(p.get("skills", {}).get(d)):
                    continue
                seat = (ci, slot_index)
                match_seat[seat] = pid
                match_person[pid] = seat
                slot_index += 1

    def try_augment(seat: Tuple[int, int], visited: set) -> bool:
        for pid in adj[seat]:
            if pid in visited:
                continue
            visited.add(pid)
            if pid not in match_person or try_augment(match_person[pid], visited):
                match_seat[seat] = pid
                match_person[pid] = seat
                return True
        return False

    # Only augment seats that are still empty
    for s in seats:
        if s in match_seat:
            continue
        try_augment(s, set())

    result: Dict[int, List[str]] = {ci: [] for ci in range(len(cells))}
    for (ci, _r), pid in match_seat.items():
        result[ci].append(pid)
    return result


def _simulate_line_fill(
    line_details: List[dict],
    persons: List[dict],
    skill_totals: Dict[str, int],
    absent_set: set,
    reserved: set,
) -> Tuple[int, int, set, List[dict]]:
    """Simulate assigning `line_details` from the free pool.
    Returns (total_required, total_filled, used_ids, per_detail_reports)."""
    line_used: set = set()
    total_req = 0
    total_fill = 0
    reports: List[dict] = []
    for d in line_details:
        excluded = absent_set | reserved | line_used
        picks = _pick_specialists(d["detail"], d["persons_required"], persons, skill_totals, excluded)
        for c in picks:
            line_used.add(c["id"])
        total_req += d["persons_required"]
        total_fill += len(picks)
        reports.append({"detail": d, "picks": picks})
    return total_req, total_fill, line_used, reports


@api_router.post("/schedule/auto-plan", response_model=Schedule)
async def auto_plan(req: AutoPlanRequest):
    """Given absentees, greedily pick lines that maximize headcount utilization."""
    persons = await db.persons.find({}, {"_id": 0}).to_list(1000)
    details = await db.line_details.find({}, {"_id": 0}).to_list(1000)
    if not persons or not details:
        raise HTTPException(400, "No data seeded.")

    absent_set = set(req.absent_person_ids)
    skill_totals = _skill_totals(persons)
    details_by_line = _group_details_by_line(details)
    all_lines = list(details_by_line.keys())

    selected: List[str] = []
    used: set = set()

    def score(line: str) -> Tuple[int, int, set]:
        total_req, total_fill, line_used, _ = _simulate_line_fill(
            details_by_line[line], persons, skill_totals, absent_set, used,
        )
        pct = 100 if total_req == 0 else round(total_fill * 100 / total_req)
        return pct, total_fill, line_used

    while True:
        best = None
        best_score = (-1, -1)
        best_used: set = set()
        for line in all_lines:
            if line in selected:
                continue
            pct, fill, line_used = score(line)
            if pct >= req.min_coverage and (pct, fill) > best_score:
                best_score = (pct, fill)
                best = line
                best_used = line_used
        if not best:
            break
        selected.append(best)
        used.update(best_used)

    if not selected:
        raise HTTPException(400, "Could not auto-plan any line with the current headcount.")

    line_configs = [LineConfig(line=l, priority=i + 1, run_count=1) for i, l in enumerate(selected)]
    gen_req = ScheduleRequest(
        date=req.date, shift=req.shift,
        line_configs=line_configs,
        absent_person_ids=req.absent_person_ids,
        overrides={}, unassigned_keys=[],
    )
    return await generate_schedule(gen_req)


def _collect_used_person_ids(sched_doc: dict) -> set:
    used: set = set()
    for a in sched_doc["assignments"]:
        for pid in a["assigned_person_ids"]:
            used.add(pid)
    return used


@api_router.post("/schedule/{date}/fill-shortages")
async def fill_shortages(date: str, shift: str = "day", preview: bool = False):
    """Optimally fill every shortage using max bipartite matching (Kuhn's).

    Seeds the matching with existing assignments so already-placed associates
    only move when necessary to enable another seat. When preview=true, returns
    a diff of proposed changes without persisting. Only cells whose assignments
    actually change are locked (unassigned_keys / overrides) — untouched cells
    keep flowing through auto-fill on later absentee changes, so the board
    never permanently freezes.
    """
    sched_doc = await db.schedules.find_one({"date": date, "shift": shift}, {"_id": 0})
    if not sched_doc:
        raise HTTPException(404, "Schedule not found")

    persons = await db.persons.find({}, {"_id": 0}).to_list(1000)
    person_by_id = {p["id"]: p for p in persons}
    skill_totals = _skill_totals(persons)
    absent_set = set(sched_doc.get("absent_person_ids", []))
    overrides = dict(sched_doc.get("overrides", {}) or {})
    unassigned = set(sched_doc.get("unassigned_keys", []) or [])

    assignments = [dict(a) for a in sched_doc["assignments"]]
    for a in assignments:
        a["assigned_person_ids"] = list(a["assigned_person_ids"])
    # Snapshot pre-fill state for preview diff
    initial_state = {
        f"{a['row_name']}||{a['line_key']}||{a['detail']}": {
            "assigned": list(a["assigned_person_ids"]),
            "required": a["required"],
        }
        for a in assignments
    }
    initial_shortage = sum(max(0, a["required"] - len(a["assigned_person_ids"])) for a in assignments)

    def cell_key(a: dict) -> str:
        return f"{a['row_name']}||{a['line_key']}||{a['detail']}"

    # Global maximum bipartite matching across ALL cells & available persons.
    # Seeded with current assignments so reshuffles only happen when needed.
    cells_input = [{"detail": a["detail"], "required": a["required"]} for a in assignments]
    initial_match = {ci: list(a["assigned_person_ids"]) for ci, a in enumerate(assignments)}
    optimal = _max_bipartite_matching(cells_input, persons, absent_set, skill_totals, initial=initial_match)
    for ci, a in enumerate(assignments):
        new_ids = optimal.get(ci, [])
        old_ids = list(a["assigned_person_ids"])
        a["assigned_person_ids"] = new_ids
        # Only lock the cell if the assignments actually changed. Otherwise leave the
        # existing overrides/unassigned state alone so subsequent auto-fills stay
        # unblocked (else the board freezes: every cell would be marked "unassigned"
        # forever, defeating auto-optimisation after later absences).
        if set(new_ids) != set(old_ids):
            overrides[cell_key(a)] = new_ids
            unassigned.add(cell_key(a))

    if preview:
        # Build diff without persisting
        changes = []
        for a in assignments:
            key = cell_key(a)
            before = set(initial_state[key]["assigned"])
            after = set(a["assigned_person_ids"])
            added = after - before
            removed = before - after
            if not added and not removed:
                continue
            new_shortage = max(0, a["required"] - len(after))
            changes.append({
                "row_name": a["row_name"],
                "line_key": a["line_key"],
                "detail": a["detail"],
                "required": a["required"],
                "added": [
                    {"id": pid, "name": _person_full_name(person_by_id[pid])}
                    for pid in added if pid in person_by_id
                ],
                "removed": [
                    {"id": pid, "name": _person_full_name(person_by_id[pid])}
                    for pid in removed if pid in person_by_id
                ],
                "now_short": new_shortage > 0,
                "shortage_after": new_shortage,
            })
        # Sort: cells with additions first, then removals
        changes.sort(key=lambda c: (-len(c["added"]), c["row_name"], c["line_key"]))
        remaining_shortage = sum(max(0, a["required"] - len(a["assigned_person_ids"])) for a in assignments)
        return {
            "preview": True,
            "initial_shortage": initial_shortage,
            "remaining_shortage": remaining_shortage,
            "filled_count": initial_shortage - remaining_shortage,
            "changes": changes,
        }

    req = ScheduleRequest(
        date=date, shift=shift,
        line_configs=[LineConfig(**c) for c in sched_doc["line_configs"]],
        absent_person_ids=sched_doc["absent_person_ids"],
        overrides=overrides,
        unassigned_keys=list(unassigned),
        required_overrides=dict(sched_doc.get("required_overrides", {}) or {}),
        disabled_activities=sched_doc.get("disabled_activities", {}) or {},
    )
    snap = _undoable_snapshot(sched_doc, "Fill all shortages")
    result = await generate_schedule(req)
    await db.schedules.update_one(
        {"date": date, "shift": shift},
        {"$push": {"history": {"$each": [snap], "$slice": -MAX_HISTORY}}},
    )
    return result


@api_router.get("/schedule/{date}/suggest-replacement")
async def suggest_replacement(date: str, cell_key: str, shift: str = "day", top: int = 3):
    """Suggest top-N replacement candidates for a specific cell.
    cell_key format: 'row_name||line_key||detail'"""
    sched_doc = await db.schedules.find_one({"date": date, "shift": shift}, {"_id": 0})
    if not sched_doc:
        raise HTTPException(404, "Schedule not found")
    parts = cell_key.split("||")
    if len(parts) < 3:
        raise HTTPException(400, "cell_key must be 'row_name||line_key||detail'")
    row_name, line_key, detail = parts[0], parts[1], "||".join(parts[2:])

    target = next(
        (a for a in sched_doc["assignments"]
         if a["row_name"] == row_name and a["line_key"] == line_key and a["detail"] == detail),
        None,
    )
    if not target:
        raise HTTPException(404, "Cell not found")

    persons = await db.persons.find({}, {"_id": 0}).to_list(1000)
    skill_totals = _skill_totals(persons)
    absent_set = set(sched_doc.get("absent_person_ids", []))

    used = set()
    for a in sched_doc["assignments"]:
        if a is target:
            continue
        used.update(a["assigned_person_ids"])

    excluded = absent_set | used | set(target["assigned_person_ids"])
    free = _pick_specialists(detail, top, persons, skill_totals, excluded)

    def location_of(pid: str) -> Optional[dict]:
        for a in sched_doc["assignments"]:
            if pid in a["assigned_person_ids"]:
                return {"row_name": a["row_name"], "line_key": a["line_key"], "detail": a["detail"]}
        return None

    borrowable = []
    for p in persons:
        if p["id"] in absent_set or p["id"] in {c["id"] for c in free}:
            continue
        if p["id"] in target["assigned_person_ids"]:
            continue
        if not bool(p.get("skills", {}).get(detail)):
            continue
        loc = location_of(p["id"])
        if loc:
            borrowable.append({"person": p, "current": loc})
    borrowable.sort(key=lambda x: skill_totals.get(x["person"]["id"], 0))

    return {
        "cell": {"row_name": row_name, "line_key": line_key, "detail": detail, "required": target["required"]},
        "free": [
            {"id": p["id"], "name": _person_full_name(p), "skills": skill_totals.get(p["id"], 0)}
            for p in free
        ],
        "borrowable": [
            {"id": b["person"]["id"], "name": _person_full_name(b["person"]),
             "skills": skill_totals.get(b["person"]["id"], 0), "current": b["current"]}
            for b in borrowable[:top]
        ],
    }


@api_router.post("/schedule/{date}/adjust")
async def adjust_cell(date: str, payload: dict):
    """Manual adjustment: swap or unassign a person in a cell.
    payload = {shift, cell_key, person_ids: [list], action: 'set' | 'clear', required?: int}
    Note: action='set' locks the cell to EXACTLY the given person_ids (no autofill)."""
    shift = payload.get("shift", "day")
    cell_key = payload.get("cell_key")
    action = payload.get("action", "set")
    person_ids = payload.get("person_ids", [])
    new_required = payload.get("required")
    if not cell_key:
        raise HTTPException(400, "cell_key required")
    sched_doc = await db.schedules.find_one({"date": date, "shift": shift}, {"_id": 0})
    if not sched_doc:
        raise HTTPException(404, "Schedule not found")
    snap = _undoable_snapshot(sched_doc, f"Manual edit · {cell_key}")
    overrides = sched_doc.get("overrides", {}) or {}
    unassigned = set(sched_doc.get("unassigned_keys", []) or [])
    required_overrides = dict(sched_doc.get("required_overrides", {}) or {})
    if action == "clear":
        overrides.pop(cell_key, None)
        unassigned.add(cell_key)
    else:
        overrides[cell_key] = person_ids
        # Lock user's exact list — no auto-fill, no auto-remove
        unassigned.add(cell_key)
    if new_required is not None:
        required_overrides[cell_key] = max(0, int(new_required))
    req = ScheduleRequest(
        date=date, shift=shift,
        line_configs=[LineConfig(**c) for c in sched_doc["line_configs"]],
        absent_person_ids=sched_doc["absent_person_ids"],
        overrides=overrides,
        unassigned_keys=list(unassigned),
        required_overrides=required_overrides,
        disabled_activities=sched_doc.get("disabled_activities", {}) or {},
    )
    result = await generate_schedule(req)
    await db.schedules.update_one(
        {"date": date, "shift": shift},
        {"$push": {"history": {"$each": [snap], "$slice": -MAX_HISTORY}}},
    )
    return result


@api_router.post("/schedule/{date}/late-arrival")
async def late_arrival(date: str, payload: dict):
    """Handle an associate arriving late.
    payload = {shift, person_id, target?: {line, row_name, detail, add_line?: bool}}
    If target given: assign them there, possibly displacing another. Response includes displacement info.
    If no target: just returns best-fit + options for the manager to pick from.
    Every mutation stores a previous_state snapshot for one-step undo."""
    shift = payload.get("shift", "day")
    pid = payload.get("person_id")
    target = payload.get("target")
    if not pid:
        raise HTTPException(400, "person_id required")

    sched_doc = await db.schedules.find_one({"date": date, "shift": shift}, {"_id": 0})
    if not sched_doc:
        raise HTTPException(404, "Schedule not found")

    persons = await db.persons.find({}, {"_id": 0}).to_list(1000)
    person_by_id = {p["id"]: p for p in persons}
    details = await db.line_details.find({}, {"_id": 0}).to_list(1000)
    skill_totals = _skill_totals(persons)
    person = person_by_id.get(pid)
    if not person:
        raise HTTPException(404, "Person not found")

    active_lines = {c["line"] for c in sched_doc["line_configs"]}
    absent_set = set(sched_doc.get("absent_person_ids", []))
    used = _collect_used_person_ids(sched_doc) - {pid}

    def build_options() -> dict:
        planned, not_planned = [], []
        for d in details:
            if not bool(person.get("skills", {}).get(d["detail"])):
                continue
            # Find cell state in current assignments (if line is active)
            cell = next(
                (a for a in sched_doc["assignments"]
                 if a["line"] == d["line"] and a["detail"] == d["detail"]),
                None,
            )
            base = {
                "line": d["line"],
                "row_name": d.get("row_name") or d["detail"],
                "detail": d["detail"],
                "required": d["persons_required"],
            }
            if d["line"] in active_lines and cell:
                gap = cell["shortage"]
                base.update({
                    "line_key": cell["line_key"],
                    "assigned_count": len(cell["assigned_person_ids"]),
                    "shortage": gap,
                    "planned": True,
                    "priority_score": (gap * 100) + (10 - min(skill_totals.get(pid, 0), 10)),
                })
                planned.append(base)
            else:
                base.update({"line_key": d["line"], "assigned_count": 0, "shortage": d["persons_required"], "planned": False, "priority_score": 0})
                not_planned.append(base)
        planned.sort(key=lambda x: (-x["priority_score"], x["line"]))
        not_planned.sort(key=lambda x: x["line"])
        best_fit = planned[0] if planned else (not_planned[0] if not_planned else None)
        return {"best_fit": best_fit, "planned": planned, "not_planned": not_planned}

    if not target:
        return {"person": {"id": pid, "name": _person_full_name(person)}, **build_options()}

    # --- Mutation path: snapshot then assign ---
    snap = _undoable_snapshot(sched_doc, f"Late arrival · {_person_full_name(person)}")

    # Remove from absent
    absent = [a for a in sched_doc["absent_person_ids"] if a != pid]

    overrides = dict(sched_doc.get("overrides", {}) or {})
    unassigned = set(sched_doc.get("unassigned_keys", []) or [])
    line_configs = list(sched_doc["line_configs"])

    line = target["line"]
    detail = target["detail"]
    row_name = target.get("row_name") or detail

    # Add line if it's not planned yet
    if line not in active_lines:
        max_prio = max((c["priority"] for c in line_configs), default=0)
        line_configs.append({"line": line, "priority": max_prio + 1, "run_count": 1})

    line_key = line  # run 1
    cell_key = f"{row_name}||{line_key}||{detail}"

    # Current cell state
    cell = next(
        (a for a in sched_doc["assignments"]
         if a["line_key"] == line_key and a["detail"] == detail and a["row_name"] == row_name),
        None,
    )
    current_ids = list(cell["assigned_person_ids"]) if cell else []
    required = cell["required"] if cell else target.get("required", 1)

    displaced_id = None
    if cell and len(current_ids) >= required and current_ids:
        # Displace the LAST-in assignee (avoid displacing specialists first if possible)
        current_ids.sort(key=lambda i: -skill_totals.get(i, 0))
        displaced_id = current_ids.pop(0)

    if pid not in current_ids:
        current_ids.append(pid)
    overrides[cell_key] = current_ids
    unassigned.add(cell_key)

    # Try to reassign displaced associate to a skill-matching free/shortage cell
    displaced_options = None
    if displaced_id:
        disp_person = person_by_id.get(displaced_id)
        placed = False
        if disp_person:
            for a in sched_doc["assignments"]:
                # Skip the target cell we just filled
                if a["line_key"] == line_key and a["detail"] == detail and a["row_name"] == row_name:
                    continue
                if not bool(disp_person.get("skills", {}).get(a["detail"])):
                    continue
                # Prefer shortage cells
                if a["shortage"] > 0:
                    dk = f"{a['row_name']}||{a['line_key']}||{a['detail']}"
                    new_list = list(a["assigned_person_ids"])
                    if displaced_id not in new_list:
                        new_list.append(displaced_id)
                    overrides[dk] = new_list
                    unassigned.add(dk)
                    placed = True
                    break
        if not placed:
            # Conflict — return options for the manager
            opts = []
            for a in sched_doc["assignments"]:
                if a["line_key"] == line_key and a["detail"] == detail and a["row_name"] == row_name:
                    continue
                if disp_person and bool(disp_person.get("skills", {}).get(a["detail"])):
                    opts.append({
                        "line": a["line"], "row_name": a["row_name"], "line_key": a["line_key"],
                        "detail": a["detail"], "shortage": a["shortage"],
                        "assigned_count": len(a["assigned_person_ids"]),
                    })
            displaced_options = {
                "id": displaced_id,
                "name": _person_full_name(disp_person) if disp_person else displaced_id,
                "options": opts,
            }

    req = ScheduleRequest(
        date=date, shift=shift,
        line_configs=[LineConfig(**c) for c in line_configs],
        absent_person_ids=absent,
        overrides=overrides,
        unassigned_keys=list(unassigned),
        required_overrides=dict(sched_doc.get("required_overrides", {}) or {}),
        disabled_activities=sched_doc.get("disabled_activities", {}) or {},
    )
    new_sched = await generate_schedule(req)
    # Push snapshot onto the undo stack (bounded to MAX_HISTORY)
    await db.schedules.update_one(
        {"date": date, "shift": shift},
        {"$push": {"history": {"$each": [snap], "$slice": -MAX_HISTORY}}},
    )
    return {
        "schedule": new_sched.model_dump(),
        "displaced": displaced_options,
        "displaced_placed_id": displaced_id if displaced_id and not displaced_options else None,
    }


@api_router.post("/schedule/{date}/undo", response_model=Schedule)
async def undo_last_action(date: str, shift: str = "day"):
    """Undo the most recent mutating action. Steps back through up to MAX_HISTORY
    snapshots one at a time (fully restores the schedule doc to the popped state)."""
    sched_doc = await db.schedules.find_one({"date": date, "shift": shift}, {"_id": 0})
    if not sched_doc:
        raise HTTPException(404, "Schedule not found")
    history = list(sched_doc.get("history") or [])
    if not history:
        raise HTTPException(400, "Nothing to undo")
    snap = history.pop()  # most recent
    await db.schedules.update_one(
        {"date": date, "shift": shift},
        {"$set": {
            "line_configs": snap.get("line_configs", []),
            "absent_person_ids": snap.get("absent_person_ids", []),
            "overrides": snap.get("overrides", {}),
            "unassigned_keys": snap.get("unassigned_keys", []),
            "required_overrides": snap.get("required_overrides", {}),
            "assignments": snap.get("assignments", []),
            "closures": snap.get("closures", []),
            "closed_line_keys": snap.get("closed_line_keys", []),
            "disabled_activities": snap.get("disabled_activities", {}),
            "total_required": snap.get("total_required", 0),
            "total_assigned": snap.get("total_assigned", 0),
            "total_shortage": snap.get("total_shortage", 0),
            "history": history,
        }},
    )
    return await _get_schedule_doc(date, shift)


@api_router.post("/schedule/{date}/mark-absent")
async def mark_absent_from_board(date: str, payload: dict):
    """Mark a person absent from the board WITHOUT re-planning. Removes them from all cells they're in.
    Other assignments stay put. payload = {shift, person_id}"""
    shift = payload.get("shift", "day")
    person_id = payload.get("person_id")
    if not person_id:
        raise HTTPException(400, "person_id required")
    sched_doc = await db.schedules.find_one({"date": date, "shift": shift}, {"_id": 0})
    if not sched_doc:
        raise HTTPException(404, "Schedule not found")

    persons = await db.persons.find({"id": person_id}, {"_id": 0, "name": 1, "surname": 1}).to_list(1)
    person_label = _person_full_name(persons[0]) if persons else person_id
    snap = _undoable_snapshot(sched_doc, f"Mark absent · {person_label}")

    absent = list(sched_doc.get("absent_person_ids", []) or [])
    if person_id not in absent:
        absent.append(person_id)

    # Build overrides for every currently-assigned cell EXCLUDING this person, and keep the
    # rest of assignments frozen — no full regeneration, so plan doesn't shuffle.
    overrides = dict(sched_doc.get("overrides", {}) or {})
    unassigned = set(sched_doc.get("unassigned_keys", []) or [])
    required_overrides = dict(sched_doc.get("required_overrides", {}) or {})

    for a in sched_doc["assignments"]:
        if person_id not in a["assigned_person_ids"]:
            continue
        cell_key = f"{a['row_name']}||{a['line_key']}||{a['detail']}"
        remaining = [pid for pid in a["assigned_person_ids"] if pid != person_id]
        overrides[cell_key] = remaining
        # Prevent auto-fill from replacing this person — plan stays as-is, cell shows as short
        unassigned.add(cell_key)

    req = ScheduleRequest(
        date=date, shift=shift,
        line_configs=[LineConfig(**c) for c in sched_doc["line_configs"]],
        absent_person_ids=absent,
        overrides=overrides,
        unassigned_keys=list(unassigned),
        required_overrides=required_overrides,
        disabled_activities=sched_doc.get("disabled_activities", {}) or {},
    )
    result = await generate_schedule(req)
    await db.schedules.update_one(
        {"date": date, "shift": shift},
        {"$push": {"history": {"$each": [snap], "$slice": -MAX_HISTORY}}},
    )
    return result


class SetDisabledActivitiesRequest(BaseModel):
    shift: str = "day"
    disabled_activities: Dict[str, List[str]] = {}   # line -> [row_names]


@api_router.get("/areas")
async def list_areas():
    """Distinct row_names (areas) across the master line_details."""
    names = await db.line_details.distinct("row_name")
    return {"areas": sorted([n for n in names if n])}


@api_router.post("/schedule/{date}/set-disabled-activities", response_model=Schedule)
async def set_disabled_activities(date: str, req: SetDisabledActivitiesRequest):
    """Toggle which (line, row_name) activities are active on the current schedule.
    - Newly disabled (line, row_name) pairs: cells clear + required=0 + locked; freed associates
      go to unassigned pool.
    - Re-enabled pairs: required restored from persons_required; cell unlocked. Freed associates
      stay in unassigned for manager to place via the existing adjust flow.
    Only the specified (line, row_name) cell is touched — never affects other lines."""
    sched = await db.schedules.find_one({"date": date, "shift": req.shift}, {"_id": 0})
    if not sched:
        raise HTTPException(404, "Schedule not found")
    snap = _undoable_snapshot(sched, "Activity change")
    details = await db.line_details.find({}, {"_id": 0}).to_list(1000)
    req_per_detail = {(d["line"], d["detail"]): int(d.get("persons_required", 0)) for d in details}

    def _norm(d: Dict[str, List[str]]) -> Dict[str, set]:
        # Silently drop any Support Ops line — those lines can't have activities disabled.
        return {
            ln: set(rows or [])
            for ln, rows in (d or {}).items()
            if rows and not _is_support_line(ln)
        }

    current = _norm(sched.get("disabled_activities") or {})
    new_map = _norm(req.disabled_activities)

    all_lines = set(current.keys()) | set(new_map.keys())
    newly_disabled: List[Tuple[str, str]] = []
    newly_enabled: List[Tuple[str, str]] = []
    for ln in all_lines:
        cur = current.get(ln, set())
        nxt = new_map.get(ln, set())
        for r in (nxt - cur):
            newly_disabled.append((ln, r))
        for r in (cur - nxt):
            newly_enabled.append((ln, r))

    unassigned_keys = set(sched.get("unassigned_keys") or [])
    overrides = dict(sched.get("overrides") or {})

    disabled_pair_set = {(ln, r) for ln, rows in new_map.items() for r in rows}
    for a in sched["assignments"]:
        pair = (a["line"], a["row_name"])
        key = f"{a['row_name']}||{a['line_key']}||{a['detail']}"
        if pair in disabled_pair_set:
            a["assigned_person_ids"] = []
            a["assigned_person_names"] = []
            a["required"] = 0
            a["shortage"] = 0
            overrides[key] = []
            unassigned_keys.add(key)
        elif (a["line"], a["row_name"]) in {(ln, r) for ln, r in newly_enabled}:
            base = req_per_detail.get((a["line"], a["detail"]), a.get("required", 0))
            a["required"] = int(base)
            a["shortage"] = max(0, a["required"] - len(a.get("assigned_person_ids", [])))
            overrides.pop(key, None)
            unassigned_keys.discard(key)

    total_required = sum(a.get("required", 0) for a in sched["assignments"])
    total_assigned = sum(len(a.get("assigned_person_ids", [])) for a in sched["assignments"])
    total_shortage = sum(a.get("shortage", 0) for a in sched["assignments"])

    persisted = {ln: sorted(list(rows)) for ln, rows in new_map.items() if rows}

    await db.schedules.update_one(
        {"date": date, "shift": req.shift},
        {"$set": {
            "assignments": sched["assignments"],
            "disabled_activities": persisted,
            "unassigned_keys": list(unassigned_keys),
            "overrides": overrides,
            "total_required": total_required,
            "total_assigned": total_assigned,
            "total_shortage": total_shortage,
        },
         "$push": {"history": {"$each": [snap], "$slice": -MAX_HISTORY}}},
    )
    return await _get_schedule_doc(date, req.shift)


class CloseLineRequest(BaseModel):
    shift: str = "day"
    line_key: str


class StartLineRequest(BaseModel):
    shift: str = "day"
    line: str
    priority: int = 3
    run_count: int = 1


def _current_unassigned_ids(sched: dict, persons: List[dict]) -> List[str]:
    """All non-absent persons who are not currently assigned to any cell."""
    absent = set(sched.get("absent_person_ids", []))
    assigned: set = set()
    for a in sched.get("assignments", []):
        assigned.update(a.get("assigned_person_ids", []))
    return [p["id"] for p in persons if p["id"] not in absent and p["id"] not in assigned]


async def _get_schedule_doc(date: str, shift: str) -> dict:
    doc = await db.schedules.find_one({"date": date, "shift": shift}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Schedule not found")
    return doc


@api_router.post("/schedule/{date}/close-line", response_model=Schedule)
async def close_line(date: str, req: CloseLineRequest):
    """Close a running line mid-shift. Frees every associate on that line to the unassigned
    pool, logs the closure with a timestamp, and leaves every other cell untouched."""
    sched = await db.schedules.find_one({"date": date, "shift": req.shift}, {"_id": 0})
    if not sched:
        raise HTTPException(404, "Schedule not found")
    if req.line_key in (sched.get("closed_line_keys") or []):
        raise HTTPException(400, f"Line '{req.line_key}' is already closed")
    line_cells = [a for a in sched["assignments"] if a["line_key"] == req.line_key]
    if not line_cells:
        raise HTTPException(404, f"Line '{req.line_key}' not found in schedule")
    snap = _undoable_snapshot(sched, f"Close line · {req.line_key}")

    freed_count = 0
    line_base = req.line_key.split(" #")[0]
    # Snapshot BEFORE clearing so reopen can restore associates back to their exact cells.
    pre_close_snapshot = [
        {
            "row_name": a["row_name"],
            "line": a["line"],
            "run": a.get("run", 1),
            "line_key": a["line_key"],
            "detail": a["detail"],
            "required": a["required"],
            "assigned_person_ids": list(a["assigned_person_ids"]),
            "assigned_person_names": list(a["assigned_person_names"]),
        }
        for a in line_cells
    ]
    for a in line_cells:
        freed_count += len(a["assigned_person_ids"])
        a["assigned_person_ids"] = []
        a["assigned_person_names"] = []
        a["required"] = 0
        a["shortage"] = 0

    now = datetime.now(timezone.utc).isoformat()
    closure = {
        "line_key": req.line_key,
        "line": line_base,
        "closed_at": now,
        "freed_count": freed_count,
        "snapshot": pre_close_snapshot,
    }
    closures = list(sched.get("closures") or [])
    closures.append(closure)
    closed_keys = list(set((sched.get("closed_line_keys") or []) + [req.line_key]))

    # Lock the closed cells so future auto-fills don't repopulate them
    unassigned_keys = set(sched.get("unassigned_keys") or [])
    overrides = dict(sched.get("overrides") or {})
    for a in line_cells:
        key = f"{a['row_name']}||{a['line_key']}||{a['detail']}"
        overrides[key] = []
        unassigned_keys.add(key)

    total_shortage = sum(a.get("shortage", 0) for a in sched["assignments"])
    total_assigned = sum(len(a.get("assigned_person_ids", [])) for a in sched["assignments"])
    total_required = sum(a.get("required", 0) for a in sched["assignments"])

    await db.schedules.update_one(
        {"date": date, "shift": req.shift},
        {"$set": {
            "assignments": sched["assignments"],
            "closures": closures,
            "closed_line_keys": closed_keys,
            "unassigned_keys": list(unassigned_keys),
            "overrides": overrides,
            "total_shortage": total_shortage,
            "total_assigned": total_assigned,
            "total_required": total_required,
        },
         "$push": {"history": {"$each": [snap], "$slice": -MAX_HISTORY}}},
    )
    return await _get_schedule_doc(date, req.shift)


class ReopenLineRequest(BaseModel):
    shift: str = "day"
    line_key: str


@api_router.post("/schedule/{date}/reopen-line", response_model=Schedule)
async def reopen_line(date: str, req: ReopenLineRequest):
    """Undo a mid-day line closure: restore the line's cells + assignments from the
    closure snapshot, remove the closure entry, and unlock the cells so the board
    resumes optimising normally. Associates who got reassigned in the meantime
    aren't double-booked — the snapshot only wins for people still free."""
    sched = await db.schedules.find_one({"date": date, "shift": req.shift}, {"_id": 0})
    if not sched:
        raise HTTPException(404, "Schedule not found")
    closures = list(sched.get("closures") or [])
    closed_keys = list(sched.get("closed_line_keys") or [])
    if req.line_key not in closed_keys:
        raise HTTPException(400, f"Line '{req.line_key}' is not closed")
    pre_snap = _undoable_snapshot(sched, f"Reopen line · {req.line_key}")

    # Find the most recent closure for this line_key
    closure = None
    closure_idx = -1
    for i in range(len(closures) - 1, -1, -1):
        if closures[i].get("line_key") == req.line_key:
            closure = closures[i]
            closure_idx = i
            break
    if not closure:
        raise HTTPException(404, "Closure record not found for this line")

    snapshot = closure.get("snapshot") or []
    if not snapshot:
        # Legacy closure without snapshot — just reopen the shell, associates go to pool
        pass

    # Anyone already reassigned to a non-closed cell after closure keeps that spot.
    still_assigned: set = set()
    for a in sched.get("assignments", []):
        if a["line_key"] == req.line_key:
            continue
        for pid in a.get("assigned_person_ids", []):
            still_assigned.add(pid)

    persons = await db.persons.find({}, {"_id": 0}).to_list(1000)
    p_by_id = {p["id"]: p for p in persons}

    overrides = dict(sched.get("overrides") or {})
    unassigned_keys = set(sched.get("unassigned_keys") or [])

    # Restore each cell of the reopened line from the snapshot
    snap_by_key = {
        f"{s['row_name']}||{s['line_key']}||{s['detail']}": s for s in snapshot
    }
    for a in sched.get("assignments", []):
        if a["line_key"] != req.line_key:
            continue
        cell_key = f"{a['row_name']}||{a['line_key']}||{a['detail']}"
        snap = snap_by_key.get(cell_key)
        if snap:
            restored_ids = [pid for pid in snap["assigned_person_ids"] if pid not in still_assigned]
            a["required"] = int(snap.get("required", 0))
            a["assigned_person_ids"] = restored_ids
            a["assigned_person_names"] = [
                _person_full_name(p_by_id[pid]) for pid in restored_ids if pid in p_by_id
            ]
            a["shortage"] = max(0, a["required"] - len(restored_ids))
            # Unlock cell so auto-fill can top it up if needed
            unassigned_keys.discard(cell_key)
            overrides.pop(cell_key, None)

    # Drop the closure entry + closed_line_keys marker
    closures.pop(closure_idx)
    closed_keys = [k for k in closed_keys if k != req.line_key]

    total_required = sum(a.get("required", 0) for a in sched["assignments"])
    total_assigned = sum(len(a.get("assigned_person_ids", [])) for a in sched["assignments"])
    total_shortage = sum(a.get("shortage", 0) for a in sched["assignments"])

    await db.schedules.update_one(
        {"date": date, "shift": req.shift},
        {"$set": {
            "assignments": sched["assignments"],
            "closures": closures,
            "closed_line_keys": closed_keys,
            "overrides": overrides,
            "unassigned_keys": list(unassigned_keys),
            "total_required": total_required,
            "total_assigned": total_assigned,
            "total_shortage": total_shortage,
        },
         "$push": {"history": {"$each": [pre_snap], "$slice": -MAX_HISTORY}}},
    )
    return await _get_schedule_doc(date, req.shift)


@api_router.get("/schedule/{date}/suggest-line")
async def suggest_line(date: str, shift: str = "day"):
    """Recommend which lines could be started now using only the current unassigned pool.
    Ranks each candidate line by how many idle-skilled associates could fill it via
    maximum bipartite matching."""
    sched = await db.schedules.find_one({"date": date, "shift": shift}, {"_id": 0})
    if not sched:
        raise HTTPException(404, "Schedule not found")
    persons = await db.persons.find({}, {"_id": 0}).to_list(1000)
    details = await db.line_details.find({}, {"_id": 0}).to_list(1000)
    skill_totals = _skill_totals(persons)

    unassigned_ids = set(_current_unassigned_ids(sched, persons))
    unassigned_pool = [p for p in persons if p["id"] in unassigned_ids]

    active_base_lines = {a["line_key"].split(" #")[0] for a in sched.get("assignments", [])}

    suggestions = []
    for line_name in sorted({d["line"] for d in details}):
        # Skip lines that already have cells in the schedule (running or closed)
        if line_name in active_base_lines:
            continue
        line_details_this = [d for d in details if d["line"] == line_name]
        cells_input = [
            {"detail": d["detail"], "required": int(d.get("persons_required", 0))}
            for d in line_details_this
        ]
        total_required = sum(c["required"] for c in cells_input)
        if total_required <= 0:
            continue
        # Match against only the unassigned pool
        matching = _max_bipartite_matching(cells_input, unassigned_pool, set(), skill_totals)
        assignable = sum(len(v) for v in matching.values())
        suggestions.append({
            "line": line_name,
            "assignable_count": assignable,
            "required": total_required,
            "coverage_pct": round((assignable / total_required) * 100) if total_required else 0,
        })

    suggestions.sort(key=lambda s: (-s["coverage_pct"], -s["assignable_count"], s["line"]))
    return {
        "unassigned_pool_size": len(unassigned_pool),
        "suggestions": suggestions,
    }


@api_router.post("/schedule/{date}/start-line", response_model=Schedule)
async def start_line(date: str, req: StartLineRequest):
    """Start a new line mid-shift. Adds the line to line_configs, creates cells, and
    auto-assigns as many unassigned-pool associates as skill-match allows.
    Associates who don't fit stay unassigned for manual placement."""
    sched = await db.schedules.find_one({"date": date, "shift": req.shift}, {"_id": 0})
    if not sched:
        raise HTTPException(404, "Schedule not found")
    details = await db.line_details.find({"line": req.line}, {"_id": 0}).to_list(200)
    if not details:
        raise HTTPException(404, f"Line '{req.line}' not found in master data")
    persons = await db.persons.find({}, {"_id": 0}).to_list(1000)
    person_by_id = {p["id"]: p for p in persons}
    skill_totals = _skill_totals(persons)

    active_base_lines = {a["line_key"].split(" #")[0] for a in sched.get("assignments", [])}
    if req.line in active_base_lines:
        raise HTTPException(400, f"Line '{req.line}' is already running today")
    snap = _undoable_snapshot(sched, f"Start line · {req.line}")

    unassigned_ids = set(_current_unassigned_ids(sched, persons))
    unassigned_pool = [p for p in persons if p["id"] in unassigned_ids]

    cells_input = [
        {"detail": d["detail"], "required": int(d.get("persons_required", 0))}
        for d in details
    ]
    matching = _max_bipartite_matching(cells_input, unassigned_pool, set(), skill_totals)

    new_line_key = req.line
    new_assignments = []
    for ci, d in enumerate(details):
        ids = matching.get(ci, [])
        names = [_person_full_name(person_by_id[i]) for i in ids if i in person_by_id]
        required = int(d.get("persons_required", 0))
        new_assignments.append({
            "row_name": d.get("row_name", d["detail"]),
            "line": req.line,
            "run": 1,
            "line_key": new_line_key,
            "detail": d["detail"],
            "required": required,
            "assigned_person_ids": ids,
            "assigned_person_names": names,
            "shortage": max(0, required - len(ids)),
        })

    sched["assignments"].extend(new_assignments)
    line_configs = list(sched.get("line_configs") or [])
    line_configs.append({"line": req.line, "priority": req.priority, "run_count": req.run_count})

    total_required = sum(a.get("required", 0) for a in sched["assignments"])
    total_assigned = sum(len(a.get("assigned_person_ids", [])) for a in sched["assignments"])
    total_shortage = sum(a.get("shortage", 0) for a in sched["assignments"])

    await db.schedules.update_one(
        {"date": date, "shift": req.shift},
        {"$set": {
            "assignments": sched["assignments"],
            "line_configs": line_configs,
            "total_required": total_required,
            "total_assigned": total_assigned,
            "total_shortage": total_shortage,
        },
         "$push": {"history": {"$each": [snap], "$slice": -MAX_HISTORY}}},
    )
    return await _get_schedule_doc(date, req.shift)



@api_router.post("/schedule/{date}/log")
async def log_schedule(date: str, shift: str = "day"):
    """Freeze the current schedule as 'logged' so it counts for History reports."""
    now = datetime.now(timezone.utc).isoformat()
    r = await db.schedules.update_one(
        {"date": date, "shift": shift},
        {"$set": {"logged_at": now}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Schedule not found")
    return {"logged_at": now}


@api_router.get("/reports/absenteeism")
async def absenteeism_report(start: str, end: str, only_logged: bool = False):
    """Return an Excel report of absentees per date within [start, end]."""
    query = {"date": {"$gte": start, "$lte": end}}
    if only_logged:
        query["logged_at"] = {"$ne": None}
    docs = await db.schedules.find(query, {"_id": 0}).sort("date", 1).to_list(500)
    persons = await db.persons.find({}, {"_id": 0}).to_list(1000)
    p_by_id = {p["id"]: p for p in persons}

    wb = openpyxl.Workbook()

    # PRIMARY sheet: cumulative per-person totals with dates
    ws = wb.active
    ws.title = "By Person"
    counts: Dict[str, int] = defaultdict(int)
    dates_by_person: Dict[str, List[str]] = defaultdict(list)
    for s in docs:
        for pid in s.get("absent_person_ids", []) or []:
            counts[pid] += 1
            dates_by_person[pid].append(f"{s['date']} ({s.get('shift','day')})")
    ws.cell(row=1, column=1, value="Name").font = Font(bold=True)
    ws.cell(row=1, column=2, value="Employee Type").font = Font(bold=True)
    ws.cell(row=1, column=3, value="Total Absent Days").font = Font(bold=True)
    ws.cell(row=1, column=4, value="Dates Absent").font = Font(bold=True)
    ranked = sorted(counts.items(), key=lambda x: (-x[1], p_by_id.get(x[0], {}).get("name", "")))
    for ri, (pid, cnt) in enumerate(ranked, 2):
        p = p_by_id.get(pid)
        ws.cell(row=ri, column=1, value=_person_full_name(p) if p else pid)
        ws.cell(row=ri, column=2, value=(p or {}).get("employee_type", ""))
        ws.cell(row=ri, column=3, value=cnt)
        ws.cell(row=ri, column=4, value=", ".join(dates_by_person[pid]))
    for col_letter, width in [("A", 28), ("B", 20), ("C", 18), ("D", 90)]:
        ws.column_dimensions[col_letter].width = width

    # Secondary sheet: per-date detail
    ws2 = wb.create_sheet("By Date")
    headers = ["Date", "Shift", "Absent Count", "Names", "Logged At"]
    for ci, h in enumerate(headers, 1):
        ws2.cell(row=1, column=ci, value=h).font = Font(bold=True)
    for ri, s in enumerate(docs, 2):
        absent_ids = s.get("absent_person_ids", []) or []
        names = ", ".join(
            _person_full_name(p_by_id[pid]) for pid in absent_ids if pid in p_by_id
        ) or ""
        ws2.cell(row=ri, column=1, value=s["date"])
        ws2.cell(row=ri, column=2, value=s.get("shift", "day"))
        ws2.cell(row=ri, column=3, value=len(absent_ids))
        ws2.cell(row=ri, column=4, value=names)
        ws2.cell(row=ri, column=5, value=s.get("logged_at") or "")
    for col_letter, width in [("A", 12), ("B", 10), ("C", 14), ("D", 80), ("E", 30)]:
        ws2.column_dimensions[col_letter].width = width

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return Response(
        content=buf.read(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="absenteeism-{start}-to-{end}.xlsx"'},
    )


@api_router.get("/schedule/{date}", response_model=Optional[Schedule])
async def get_schedule(date: str, shift: str = "day"):
    doc = await db.schedules.find_one({"date": date, "shift": shift}, {"_id": 0})
    if not doc:
        return None
    return Schedule(**doc)


@api_router.get("/schedules")
async def list_schedules():
    docs = await db.schedules.find({}, {"_id": 0, "assignments": 0}).sort("date", -1).to_list(500)
    return docs


@api_router.delete("/schedule/{date}")
async def delete_schedule(date: str, shift: str = "day"):
    r = await db.schedules.delete_one({"date": date, "shift": shift})
    return {"deleted": r.deleted_count}


@api_router.get("/analytics/shortage")
async def shortage_analytics(days: int = 30):
    docs = await db.schedules.find({}, {"_id": 0}).sort("date", -1).limit(days).to_list(days)
    by_detail: Dict[str, int] = defaultdict(int)
    by_line: Dict[str, int] = defaultdict(int)
    by_date: List[dict] = []
    for s in docs:
        total = 0
        for a in s.get("assignments", []):
            if a["shortage"] > 0:
                by_detail[a["detail"]] += a["shortage"]
                by_line[a["line"]] += a["shortage"]
                total += a["shortage"]
        by_date.append({"date": s["date"], "shift": s.get("shift", "day"), "shortage": total,
                        "assigned": s.get("total_assigned", 0), "required": s.get("total_required", 0)})
    return {
        "top_short_details": sorted(by_detail.items(), key=lambda x: -x[1])[:10],
        "top_short_lines": sorted(by_line.items(), key=lambda x: -x[1])[:10],
        "history": by_date,
    }


@api_router.get("/analytics/monthly")
async def monthly_analytics(month: Optional[str] = None):
    """Three monthly insights: top absentees, lines suffering from absence, line utilisation.
    month: 'YYYY-MM' (defaults to current month based on latest schedule date)."""
    # Distinct months available (for the month selector)
    all_dates = await db.schedules.distinct("date")
    months_set = {d[:7] for d in all_dates if isinstance(d, str) and len(d) >= 7}
    months_available = sorted(months_set, reverse=True)

    if not month:
        month = months_available[0] if months_available else datetime.now(timezone.utc).strftime("%Y-%m")

    # Fetch schedules for month
    start = f"{month}-01"
    # naive next-month calc
    y, m = int(month[:4]), int(month[5:7])
    ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
    end = f"{ny:04d}-{nm:02d}-01"

    docs = await db.schedules.find(
        {"date": {"$gte": start, "$lt": end}}, {"_id": 0}
    ).sort("date", 1).to_list(500)

    persons = await db.persons.find({}, {"_id": 0}).to_list(1000)
    p_by_id = {p["id"]: p for p in persons}
    master_lines = set(await db.line_details.distinct("line"))

    # --- 1) Top absentees
    absentee_counts: Dict[str, int] = defaultdict(int)
    absentee_dates: Dict[str, List[str]] = defaultdict(list)
    for s in docs:
        seen_today: set = set()  # de-dup within a date (same person absent day+evening etc.)
        for pid in s.get("absent_person_ids", []):
            key = (s["date"], pid)
            if key in seen_today:
                continue
            seen_today.add(key)
            absentee_counts[pid] += 1
            absentee_dates[pid].append(s["date"])
    top_absentees = []
    for pid, cnt in sorted(absentee_counts.items(), key=lambda x: -x[1])[:10]:
        p = p_by_id.get(pid)
        top_absentees.append({
            "person_id": pid,
            "name": _person_full_name(p) if p else pid,
            "count": cnt,
            "dates": sorted(set(absentee_dates[pid])),
        })

    # --- 2) Lines suffering from absence: rank by shortage-days where absents ≥ 1
    line_absence_days: Dict[str, int] = defaultdict(int)
    line_absence_shortage: Dict[str, int] = defaultdict(int)
    for s in docs:
        if not s.get("absent_person_ids"):
            continue
        # Which lines had shortage on this day?
        short_lines_today: Dict[str, int] = defaultdict(int)
        for a in s.get("assignments", []):
            if a.get("shortage", 0) > 0:
                line = _canonical_line(a["line"], master_lines)
                short_lines_today[line] += a["shortage"]
        for line, tot in short_lines_today.items():
            line_absence_days[line] += 1
            line_absence_shortage[line] += tot

    lines_hit_by_absence = [
        {"line": line, "shortage_days": days, "shortage_total": line_absence_shortage[line]}
        for line, days in sorted(line_absence_days.items(), key=lambda x: (-x[1], -line_absence_shortage[x[0]]))
    ]

    # --- 3) Line utilisation: total RUN INSTANCES per line in the month
    # (a schedule with run_count=2 on a day counts as 2 runs, not 1 day)
    line_runs: Dict[str, int] = {line: 0 for line in master_lines}
    line_days: Dict[str, set] = {line: set() for line in master_lines}
    all_days: set = set()
    for s in docs:
        all_days.add(s["date"])
        for cfg in s.get("line_configs", []):
            line = _canonical_line(cfg["line"], master_lines)
            if line not in line_runs:
                line_runs[line] = 0
                line_days[line] = set()
            line_runs[line] += int(cfg.get("run_count", 1) or 1)
            line_days[line].add(s["date"])
    days_with_schedule = len(all_days)
    line_utilisation = [
        {
            "line": line,
            "total_runs": line_runs[line],
            "days_run": len(line_days[line]),
        }
        for line in sorted(line_runs.keys(), key=lambda k: (-line_runs[k], -len(line_days[k]), k))
    ]

    # --- 4) Closures logged this month (line, date, time, freed_count)
    closures_log = []
    for s in docs:
        for c in s.get("closures", []) or []:
            closures_log.append({
                "date": s["date"],
                "shift": s.get("shift", "day"),
                "line": _canonical_line(c.get("line", ""), master_lines),
                "line_key": c.get("line_key"),
                "closed_at": c.get("closed_at"),
                "freed_count": c.get("freed_count", 0),
            })
    closures_log.sort(key=lambda x: x.get("closed_at", ""), reverse=True)

    return {
        "month": month,
        "months_available": months_available,
        "days_with_schedule": days_with_schedule,
        "top_absentees": top_absentees,
        "lines_hit_by_absence": lines_hit_by_absence,
        "line_utilisation": line_utilisation,
        "closures": closures_log,
    }


@api_router.get("/export/{date}")
async def export_schedule(date: str, shift: str = "day"):
    sched_doc = await db.schedules.find_one({"date": date, "shift": shift}, {"_id": 0})
    if not sched_doc:
        raise HTTPException(404, "No schedule")

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = f"Schedule {date}"

    assignments = sched_doc["assignments"]
    # Column keys in configured order
    line_configs = sorted(sched_doc["line_configs"], key=lambda c: (c["priority"], c["line"]))
    col_keys: List[str] = []
    for cfg in line_configs:
        for r in range(1, max(1, cfg["run_count"]) + 1):
            col_keys.append(cfg["line"] if r == 1 else f"{cfg['line']} #{r}")

    row_order: List[str] = []
    seen = set()
    for a in assignments:
        rn = a["row_name"]
        if rn not in seen:
            row_order.append(rn)
            seen.add(rn)

    matrix: Dict[Tuple[str, str], dict] = {(a["row_name"], a["line_key"]): a for a in assignments}

    ws.cell(row=1, column=1, value=f"Resource Schedule – {date} ({shift})").font = Font(bold=True, size=16)
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=len(col_keys) + 1)
    ws.cell(row=3, column=1, value="Row Name").font = Font(bold=True)
    for ci, ck in enumerate(col_keys, start=2):
        ws.cell(row=3, column=ci, value=ck).font = Font(bold=True)

    thin = Side(border_style="thin", color="999999")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    red_fill = PatternFill(start_color="FFE3E3", end_color="FFE3E3", fill_type="solid")

    for ri, rn in enumerate(row_order, start=4):
        ws.cell(row=ri, column=1, value=rn).font = Font(bold=True)
        ws.cell(row=ri, column=1).border = border
        for ci, ck in enumerate(col_keys, start=2):
            cell = ws.cell(row=ri, column=ci)
            cell.border = border
            cell.alignment = Alignment(wrap_text=True, vertical="top")
            a = matrix.get((rn, ck))
            if a:
                text = "\n".join(a["assigned_person_names"])
                if a["shortage"] > 0:
                    text += f"\n⚠ SHORT BY {a['shortage']}"
                    cell.fill = red_fill
                cell.value = text
            else:
                cell.value = ""

    # Absent row
    absent_row = len(row_order) + 5
    ws.cell(row=absent_row, column=1, value="ABSENT").font = Font(bold=True, color="CC0000")
    absent_ids = set(sched_doc.get("absent_person_ids", []))
    if absent_ids:
        person_docs = await db.persons.find({"id": {"$in": list(absent_ids)}}, {"_id": 0}).to_list(1000)
        names = ", ".join(f"{p['name']} {p.get('surname','')}".strip() for p in person_docs)
    else:
        names = "None"
    ws.cell(row=absent_row, column=2, value=names)
    ws.merge_cells(start_row=absent_row, start_column=2, end_row=absent_row, end_column=len(col_keys) + 1)

    ws.column_dimensions["A"].width = 26
    for ci in range(2, len(col_keys) + 2):
        ws.column_dimensions[openpyxl.utils.get_column_letter(ci)].width = 22

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return Response(
        content=buf.read(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="schedule-{date}-{shift}.xlsx"'},
    )


@api_router.get("/stats")
async def stats():
    persons = await db.persons.count_documents({})
    details = await db.line_details.count_documents({})
    lines = await db.line_details.distinct("line")
    schedules = await db.schedules.count_documents({})
    return {"persons": persons, "details": details, "lines": len(lines), "schedules": schedules}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


@app.on_event("startup")
async def on_startup():
    try:
        await seed_from_file_if_empty()
        await _migrate_canonical_line_names()
    except Exception as e:
        logger.exception(f"Startup init failed: {e}")


async def _migrate_canonical_line_names():
    """One-time migration: rewrite any legacy/aliased line names in existing schedules.
    Scans the collection once; only writes to docs that actually need canonicalisation.
    Batch-safe: uses a bounded projection query and streams via cursor."""
    master = set(await db.line_details.distinct("line"))
    if not master:
        return
    # Only fetch fields the migration touches. Batch-limited to avoid unbounded startup cost.
    cursor = db.schedules.find(
        {},
        {"_id": 1, "date": 1, "shift": 1, "line_configs": 1, "assignments": 1},
    ).limit(5000)
    async for s in cursor:
        changed = False
        for cfg in s.get("line_configs", []):
            canon = _canonical_line(cfg.get("line", ""), master)
            if canon != cfg.get("line"):
                cfg["line"] = canon
                changed = True
        for a in s.get("assignments", []):
            canon = _canonical_line(a.get("line", ""), master)
            if canon != a.get("line"):
                a["line"] = canon
                changed = True
            # line_key = line for base run, or "{line} #N"
            lk = a.get("line_key", "")
            if lk.startswith(a["line"]):
                pass
            else:
                # legacy prefix — rebuild
                if " #" in lk:
                    _, tail = lk.split(" #", 1)
                    a["line_key"] = f"{a['line']} #{tail}"
                else:
                    a["line_key"] = a["line"]
                changed = True
        if changed:
            await db.schedules.update_one(
                {"_id": s["_id"]},
                {"$set": {
                    "line_configs": s.get("line_configs", []),
                    "assignments": s.get("assignments", []),
                }},
            )
            logger.info(f"Canonicalised line names in schedule {s.get('date')} {s.get('shift')}")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
