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

import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

app = FastAPI(title="Resource Scheduling Board")
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
    skills: Dict[str, bool] = {}  # detail_name -> bool


class LineDetail(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    detail: str
    line: str
    persons_required: int


class ScheduleRequest(BaseModel):
    date: str  # ISO date YYYY-MM-DD
    selected_lines: List[str]
    absent_person_ids: List[str] = []
    overrides: Optional[Dict[str, List[str]]] = None  # detail name -> [person_ids]


class CellAssignment(BaseModel):
    detail: str
    line: str
    required: int
    assigned_person_ids: List[str]
    assigned_person_names: List[str]
    shortage: int


class Schedule(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    date: str
    selected_lines: List[str]
    absent_person_ids: List[str]
    assignments: List[CellAssignment]
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    total_required: int = 0
    total_assigned: int = 0
    total_shortage: int = 0


# ----------------- Excel parsing & seeding -----------------
def parse_excel_bytes(content: bytes) -> Tuple[List[Person], List[LineDetail]]:
    wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
    sheet_names = {s.lower(): s for s in wb.sheetnames}
    persons_sheet = sheet_names.get("person - skill") or wb.sheetnames[0]
    lines_sheet = sheet_names.get("assembly line") or wb.sheetnames[1]

    # Parse persons
    ws = wb[persons_sheet]
    headers = [ws.cell(row=1, column=c).value for c in range(1, ws.max_column + 1)]
    # Standard columns: SN, Name, Surname, Date of joining, Qualification, Employee type, Date of Birth, Mobile number
    # Then skill columns
    skill_start_col = 9  # 1-based; columns 9..end are skills
    skill_headers = [str(h).strip() for h in headers[skill_start_col - 1:] if h]

    persons: List[Person] = []
    for r in range(2, ws.max_row + 1):
        name = ws.cell(row=r, column=2).value
        if not name:
            continue
        sn = ws.cell(row=r, column=1).value
        surname = ws.cell(row=r, column=3).value or ""
        qualification = ws.cell(row=r, column=5).value or ""
        emp_type = ws.cell(row=r, column=6).value or ""
        mobile = ws.cell(row=r, column=8).value or ""
        skills: Dict[str, bool] = {}
        for i, sk in enumerate(skill_headers):
            v = ws.cell(row=r, column=skill_start_col + i).value
            skills[sk] = str(v).strip().lower() == "yes" if v is not None else False

        persons.append(
            Person(
                sn=int(sn) if isinstance(sn, (int, float)) else None,
                name=str(name).strip(),
                surname=str(surname).strip(),
                qualification=str(qualification).strip(),
                employee_type=str(emp_type).strip(),
                mobile=str(mobile).strip(),
                skills=skills,
            )
        )

    # Parse assembly line details
    ws2 = wb[lines_sheet]
    details: List[LineDetail] = []
    for r in range(2, ws2.max_row + 1):
        detail = ws2.cell(row=r, column=2).value
        line = ws2.cell(row=r, column=3).value
        req = ws2.cell(row=r, column=4).value
        if not detail or not line:
            continue
        try:
            req_int = int(req) if req is not None else 0
        except (ValueError, TypeError):
            req_int = 0
        details.append(
            LineDetail(detail=str(detail).strip(), line=str(line).strip(), persons_required=req_int)
        )

    return persons, details


async def seed_from_file_if_empty():
    persons_count = await db.persons.count_documents({})
    details_count = await db.line_details.count_documents({})
    if persons_count > 0 and details_count > 0:
        return
    seed_path = ROOT_DIR / "seed_data.xlsx"
    if not seed_path.exists():
        logger.warning("No seed file found")
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
    return {"message": "Resource Scheduling API"}


@api_router.get("/persons", response_model=List[Person])
async def list_persons():
    docs = await db.persons.find({}, {"_id": 0}).to_list(1000)
    return [Person(**d) for d in docs]


@api_router.get("/lines")
async def list_lines():
    docs = await db.line_details.find({}, {"_id": 0}).to_list(1000)
    # Group by line, preserving order of first appearance
    by_line: Dict[str, List[dict]] = {}
    order: List[str] = []
    for d in docs:
        line = d["line"]
        if line not in by_line:
            by_line[line] = []
            order.append(line)
        by_line[line].append(d)
    return {"lines": [{"line": l, "details": by_line[l]} for l in order]}


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
        raise HTTPException(400, "No data found in expected sheets")
    await db.persons.delete_many({})
    await db.line_details.delete_many({})
    await db.persons.insert_many([p.model_dump() for p in persons])
    await db.line_details.insert_many([d.model_dump() for d in details])
    return {"persons": len(persons), "details": len(details)}


def _generate_assignments(
    persons: List[dict], details: List[dict], selected_lines: List[str], absent_ids: List[str],
    overrides: Optional[Dict[str, List[str]]] = None,
) -> List[CellAssignment]:
    """Specialist-first algorithm: assign person with fewer total skills first.
    One assignment per person per day.
    """
    overrides = overrides or {}
    # Build skill totals per person
    person_total_skills = {p["id"]: sum(1 for v in p.get("skills", {}).values() if v) for p in persons}
    person_by_id = {p["id"]: p for p in persons}
    absent_set = set(absent_ids)

    # Filter details by selected lines
    active_details = [d for d in details if d["line"] in selected_lines]

    assigned_person_ids: set = set()
    # First, apply user overrides (manual locks): for each detail in overrides, pick those people, mark used.
    override_picks: Dict[str, List[str]] = {}
    for d in active_details:
        key = d["detail"]
        if key in overrides:
            picks = [pid for pid in overrides[key] if pid in person_by_id and pid not in absent_set]
            picks = picks[: d["persons_required"]]
            override_picks[key] = picks
            assigned_person_ids.update(picks)

    # Sort details: higher required first (heavier needs satisfied first), then by line order
    # but to ensure rare skills get the rare specialists, we instead iterate detail-by-detail and pick rarest specialist
    results: List[CellAssignment] = []
    for d in active_details:
        detail_name = d["detail"]
        required = d["persons_required"]
        if detail_name in override_picks:
            picks = override_picks[detail_name]
        else:
            picks = []

        # Eligible candidates: have the skill, not absent, not yet assigned
        eligible = [
            p for p in persons
            if p.get("skills", {}).get(detail_name) is True
            and p["id"] not in absent_set
            and p["id"] not in assigned_person_ids
        ]
        # Sort by total skills ascending (specialist first), then by name
        eligible.sort(key=lambda p: (person_total_skills.get(p["id"], 0), p.get("name", "")))

        remaining = required - len(picks)
        for cand in eligible[:remaining]:
            picks.append(cand["id"])
            assigned_person_ids.add(cand["id"])

        names = []
        for pid in picks:
            p = person_by_id.get(pid)
            if p:
                full = f"{p.get('name','').strip()} {p.get('surname','').strip()}".strip()
                names.append(full)

        results.append(
            CellAssignment(
                detail=detail_name,
                line=d["line"],
                required=required,
                assigned_person_ids=picks,
                assigned_person_names=names,
                shortage=max(0, required - len(picks)),
            )
        )

    return results


@api_router.post("/schedule", response_model=Schedule)
async def generate_schedule(req: ScheduleRequest):
    persons = await db.persons.find({}, {"_id": 0}).to_list(1000)
    details = await db.line_details.find({}, {"_id": 0}).to_list(1000)
    if not persons or not details:
        raise HTTPException(400, "No data seeded. Upload Excel first.")

    assignments = _generate_assignments(
        persons, details, req.selected_lines, req.absent_person_ids, req.overrides
    )
    total_req = sum(a.required for a in assignments)
    total_assigned = sum(len(a.assigned_person_ids) for a in assignments)
    total_short = sum(a.shortage for a in assignments)

    sched = Schedule(
        date=req.date,
        selected_lines=req.selected_lines,
        absent_person_ids=req.absent_person_ids,
        assignments=assignments,
        total_required=total_req,
        total_assigned=total_assigned,
        total_shortage=total_short,
    )

    # Upsert by date
    doc = sched.model_dump()
    await db.schedules.replace_one({"date": req.date}, doc, upsert=True)
    return sched


@api_router.get("/schedule/{date}", response_model=Optional[Schedule])
async def get_schedule(date: str):
    doc = await db.schedules.find_one({"date": date}, {"_id": 0})
    if not doc:
        return None
    return Schedule(**doc)


@api_router.get("/schedules")
async def list_schedules():
    docs = await db.schedules.find({}, {"_id": 0, "assignments": 0}).sort("date", -1).to_list(200)
    return docs


@api_router.delete("/schedule/{date}")
async def delete_schedule(date: str):
    r = await db.schedules.delete_one({"date": date})
    return {"deleted": r.deleted_count}


@api_router.get("/export/{date}")
async def export_schedule(date: str):
    sched_doc = await db.schedules.find_one({"date": date}, {"_id": 0})
    if not sched_doc:
        raise HTTPException(404, "No schedule for this date")

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = f"Schedule {date}"

    # Build matrix: rows = unique details (ordered), cols = selected_lines
    selected_lines = sched_doc["selected_lines"]
    assignments = sched_doc["assignments"]
    detail_order: List[str] = []
    seen = set()
    for a in assignments:
        if a["detail"] not in seen:
            detail_order.append(a["detail"])
            seen.add(a["detail"])
    matrix: Dict[Tuple[str, str], dict] = {(a["detail"], a["line"]): a for a in assignments}

    # Header
    ws.cell(row=1, column=1, value=f"Resource Schedule – {date}").font = Font(bold=True, size=16)
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=len(selected_lines) + 1)

    ws.cell(row=3, column=1, value="Detail").font = Font(bold=True)
    for ci, line in enumerate(selected_lines, start=2):
        ws.cell(row=3, column=ci, value=line).font = Font(bold=True)

    thin = Side(border_style="thin", color="999999")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    red_fill = PatternFill(start_color="FFE3E3", end_color="FFE3E3", fill_type="solid")

    for ri, detail in enumerate(detail_order, start=4):
        ws.cell(row=ri, column=1, value=detail).font = Font(bold=True)
        ws.cell(row=ri, column=1).border = border
        for ci, line in enumerate(selected_lines, start=2):
            cell = ws.cell(row=ri, column=ci)
            cell.border = border
            cell.alignment = Alignment(wrap_text=True, vertical="top")
            assign = matrix.get((detail, line))
            if assign:
                names = "\n".join(assign["assigned_person_names"]) or ""
                if assign["shortage"] > 0:
                    names += f"\n⚠ SHORT BY {assign['shortage']}"
                    cell.fill = red_fill
                cell.value = names
            else:
                cell.value = ""

    # Column widths
    ws.column_dimensions["A"].width = 30
    for ci in range(2, len(selected_lines) + 2):
        ws.column_dimensions[openpyxl.utils.get_column_letter(ci)].width = 22

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return Response(
        content=buf.read(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="schedule-{date}.xlsx"'},
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
    except Exception as e:
        logger.exception(f"Seeding failed: {e}")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
