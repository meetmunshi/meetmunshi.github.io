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
    overrides: Dict[str, List[str]] = {}   # key = f"{row_name}||{line}#{run}" -> person_ids
    unassigned_keys: List[str] = []        # keys the user explicitly cleared


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
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    total_required: int = 0
    total_assigned: int = 0
    total_shortage: int = 0


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
    await db.persons.delete_many({})
    await db.line_details.delete_many({})
    if persons:
        await db.persons.insert_many([p.model_dump() for p in persons])
    if details:
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
async def upload_excel(file: UploadFile = File(...)):
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


def _generate_assignments(
    persons: List[dict],
    details: List[dict],
    line_configs: List[LineConfig],
    absent_ids: List[str],
    overrides: Dict[str, List[str]],
    unassigned_keys: List[str],
) -> List[CellAssignment]:
    persons = persons or []
    details = details or []
    overrides = overrides or {}
    unassigned_keys = unassigned_keys or []
    person_total_skills = {p["id"]: sum(1 for v in p.get("skills", {}).values() if v) for p in persons}
    person_by_id = {p["id"]: p for p in persons}
    absent_set = set(absent_ids)
    unassigned_set = set(unassigned_keys)

    # Sort configs by priority (ascending: 1 first)
    sorted_configs = sorted(line_configs, key=lambda c: (c.priority, c.line))
    details_by_line: Dict[str, List[dict]] = defaultdict(list)
    for d in details:
        details_by_line[d["line"]].append(d)

    # Build expanded work items: (priority, line, run, detail)
    work: List[Tuple[int, str, int, dict]] = []
    for cfg in sorted_configs:
        for run_idx in range(1, max(1, cfg.run_count) + 1):
            for d in details_by_line.get(cfg.line, []):
                work.append((cfg.priority, cfg.line, run_idx, d))

    assigned_person_ids: set = set()
    results: List[CellAssignment] = []

    # First apply overrides — they lock those people
    override_used: set = set()
    for key, pids in overrides.items():
        for pid in pids:
            if pid in person_by_id and pid not in absent_set:
                override_used.add(pid)
    assigned_person_ids.update(override_used)

    for priority, line, run_idx, d in work:
        detail_name = d["detail"]
        row_name = d.get("row_name") or detail_name
        required = d["persons_required"]
        line_key = f"{line}" if run_idx == 1 else f"{line} #{run_idx}"
        cell_key = f"{row_name}||{line_key}"

        picks: List[str] = []
        if cell_key in overrides:
            for pid in overrides[cell_key]:
                if pid in person_by_id and pid not in absent_set:
                    picks.append(pid)
            # Allow user to intentionally exceed required (extra hands)

        if cell_key in unassigned_set:
            # User explicitly cleared — do NOT auto-fill
            names = []
            for pid in picks:
                p = person_by_id.get(pid)
                if p:
                    names.append(f"{p.get('name','').strip()} {p.get('surname','').strip()}".strip())
            results.append(CellAssignment(
                row_name=row_name, line=line, run=run_idx, line_key=line_key,
                detail=detail_name, required=required,
                assigned_person_ids=picks, assigned_person_names=names,
                shortage=max(0, required - len(picks)),
            ))
            continue

        remaining = required - len(picks)
        if remaining > 0:
            eligible = [
                p for p in persons
                if bool(p.get("skills", {}).get(detail_name))
                and p["id"] not in absent_set
                and p["id"] not in assigned_person_ids
                and p["id"] not in picks
            ]
            eligible.sort(key=lambda p: (person_total_skills.get(p["id"], 0), p.get("name", "")))
            for cand in eligible[:remaining]:
                picks.append(cand["id"])

        for pid in picks:
            assigned_person_ids.add(pid)

        names = []
        for pid in picks:
            p = person_by_id.get(pid)
            if p:
                names.append(f"{p.get('name','').strip()} {p.get('surname','').strip()}".strip())

        results.append(CellAssignment(
            row_name=row_name, line=line, run=run_idx, line_key=line_key,
            detail=detail_name, required=required,
            assigned_person_ids=picks, assigned_person_names=names,
            shortage=max(0, required - len(picks)),
        ))

    return results


@api_router.post("/schedule", response_model=Schedule)
async def generate_schedule(req: ScheduleRequest):
    persons = await db.persons.find({}, {"_id": 0}).to_list(1000)
    details = await db.line_details.find({}, {"_id": 0}).to_list(1000)
    if not persons or not details:
        raise HTTPException(400, "No data seeded.")
    assignments = _generate_assignments(
        persons, details, req.line_configs, req.absent_person_ids,
        req.overrides, req.unassigned_keys,
    )
    total_req = sum(a.required for a in assignments)
    total_assigned = sum(len(a.assigned_person_ids) for a in assignments)
    total_short = sum(a.shortage for a in assignments)
    sched = Schedule(
        date=req.date, shift=req.shift, line_configs=req.line_configs,
        absent_person_ids=req.absent_person_ids,
        assignments=assignments, overrides=req.overrides,
        unassigned_keys=req.unassigned_keys,
        total_required=total_req, total_assigned=total_assigned, total_shortage=total_short,
    )
    doc = sched.model_dump()
    await db.schedules.replace_one({"date": req.date, "shift": req.shift}, doc, upsert=True)
    return sched


@api_router.get("/schedule/{date}/suggest-lines")
async def suggest_lines(date: str, shift: str = "day"):
    """Using the free pool (unassigned + not absent), suggest additional lines that could run today."""
    sched_doc = await db.schedules.find_one({"date": date, "shift": shift}, {"_id": 0})
    if not sched_doc:
        raise HTTPException(404, "Schedule not found")

    persons = await db.persons.find({}, {"_id": 0}).to_list(1000)
    details = await db.line_details.find({}, {"_id": 0}).to_list(1000)
    absent_set = set(sched_doc.get("absent_person_ids", []))
    used: set = set()
    for a in sched_doc["assignments"]:
        for pid in a["assigned_person_ids"]:
            used.add(pid)

    active_lines = {c["line"] for c in sched_doc["line_configs"]}
    free_pool = [p for p in persons if p["id"] not in absent_set and p["id"] not in used]
    person_total_skills = {p["id"]: sum(1 for v in p.get("skills", {}).values() if v) for p in persons}

    # Group details by line for candidate lines only
    details_by_line: Dict[str, List[dict]] = defaultdict(list)
    for d in details:
        if d["line"] not in active_lines:
            details_by_line[d["line"]].append(d)

    suggestions = []
    for line, dets in details_by_line.items():
        line_used: set = set()
        cell_reports = []
        total_req = 0
        total_filled = 0
        for d in dets:
            eligible = [
                p for p in free_pool
                if bool(p.get("skills", {}).get(d["detail"]))
                and p["id"] not in line_used
            ]
            eligible.sort(key=lambda p: (person_total_skills.get(p["id"], 0), p.get("name", "")))
            picks = eligible[: d["persons_required"]]
            for p in picks:
                line_used.add(p["id"])
            total_req += d["persons_required"]
            total_filled += len(picks)
            cell_reports.append({
                "row_name": d.get("row_name") or d["detail"],
                "detail": d["detail"],
                "required": d["persons_required"],
                "eligible": len(eligible),
                "assigned_names": [f"{p['name']} {p.get('surname','')}".strip() for p in picks],
                "shortage": max(0, d["persons_required"] - len(picks)),
            })
        coverage = 1.0 if total_req == 0 else total_filled / total_req
        suggestions.append({
            "line": line,
            "required": total_req,
            "fillable": total_filled,
            "coverage_pct": round(coverage * 100),
            "fully_covered": total_filled == total_req and total_req > 0,
            "cells": cell_reports,
        })

    suggestions.sort(key=lambda s: (-s["coverage_pct"], -s["fillable"], s["line"]))
    return {"free_pool_size": len(free_pool), "suggestions": suggestions}


@api_router.post("/schedule/{date}/fill-shortages", response_model=Schedule)
async def fill_shortages(date: str, shift: str = "day"):
    """Auto-assign best available free candidates to every shortage cell."""
    sched_doc = await db.schedules.find_one({"date": date, "shift": shift}, {"_id": 0})
    if not sched_doc:
        raise HTTPException(404, "Schedule not found")

    persons = await db.persons.find({}, {"_id": 0}).to_list(1000)
    person_by_id = {p["id"]: p for p in persons}
    person_total_skills = {p["id"]: sum(1 for v in p.get("skills", {}).values() if v) for p in persons}
    absent_set = set(sched_doc.get("absent_person_ids", []))

    # Currently-assigned person ids across the schedule
    used: set = set()
    for a in sched_doc["assignments"]:
        for pid in a["assigned_person_ids"]:
            used.add(pid)

    overrides = dict(sched_doc.get("overrides", {}) or {})
    unassigned = set(sched_doc.get("unassigned_keys", []) or [])
    filled = 0

    # Sort shortage cells: hardest to fill first (lowest count of skilled free candidates)
    shortage_cells = [a for a in sched_doc["assignments"] if a["shortage"] > 0]
    def scarcity(cell):
        return sum(
            1 for p in persons
            if bool(p.get("skills", {}).get(cell["detail"]))
            and p["id"] not in absent_set
        )
    shortage_cells.sort(key=scarcity)

    for cell in shortage_cells:
        need = cell["shortage"]
        cell_key = f"{cell['row_name']}||{cell['line_key']}"
        eligible = [
            p for p in persons
            if bool(p.get("skills", {}).get(cell["detail"]))
            and p["id"] not in absent_set
            and p["id"] not in used
        ]
        # Prefer specialists (fewer skills) so generalists remain for other cells
        eligible.sort(key=lambda p: (person_total_skills.get(p["id"], 0), p.get("name", "")))
        picks_new_ids = [c["id"] for c in eligible[:need]]
        picks_existing = cell["assigned_person_ids"] + picks_new_ids
        if picks_new_ids:
            overrides[cell_key] = picks_existing
            unassigned.discard(cell_key)
            for pid in picks_new_ids:
                used.add(pid)
            filled += len(picks_new_ids)

    req = ScheduleRequest(
        date=date, shift=shift,
        line_configs=[LineConfig(**c) for c in sched_doc["line_configs"]],
        absent_person_ids=sched_doc["absent_person_ids"],
        overrides=overrides,
        unassigned_keys=list(unassigned),
    )
    result = await generate_schedule(req)
    return result


@api_router.post("/schedule/{date}/adjust")
async def adjust_cell(date: str, payload: dict):
    """Manual adjustment: swap or unassign a person in a cell.
    payload = {shift, cell_key, person_ids: [list], action: 'set' | 'clear'}"""
    shift = payload.get("shift", "day")
    cell_key = payload.get("cell_key")
    action = payload.get("action", "set")
    person_ids = payload.get("person_ids", [])
    if not cell_key:
        raise HTTPException(400, "cell_key required")
    sched_doc = await db.schedules.find_one({"date": date, "shift": shift}, {"_id": 0})
    if not sched_doc:
        raise HTTPException(404, "Schedule not found")
    overrides = sched_doc.get("overrides", {}) or {}
    unassigned = set(sched_doc.get("unassigned_keys", []) or [])
    if action == "clear":
        overrides.pop(cell_key, None)
        unassigned.add(cell_key)
    else:
        overrides[cell_key] = person_ids
        unassigned.discard(cell_key)
    req = ScheduleRequest(
        date=date, shift=shift,
        line_configs=[LineConfig(**c) for c in sched_doc["line_configs"]],
        absent_person_ids=sched_doc["absent_person_ids"],
        overrides=overrides,
        unassigned_keys=list(unassigned),
    )
    return await generate_schedule(req)


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
    # Force re-seed if row_name column not yet populated
    try:
        any_detail = await db.line_details.find_one({}, {"_id": 0})
        if any_detail and not any_detail.get("row_name"):
            await db.persons.delete_many({})
            await db.line_details.delete_many({})
            await db.schedules.delete_many({})
            logger.info("Old data lacked row_name; wiped for re-seed")
        await seed_from_file_if_empty()
    except Exception as e:
        logger.exception(f"Seeding failed: {e}")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
