# FFM Production Scheduling Board – PRD

## Original Problem Statement
> "I have one excel file which has person/resource name and the skill details. Another sheet has the detail and the assembly line matchup and the number of persons required. I want to design one automated resource scheduling board. Only input should be which line to work on the particular day and select which persons are absent and then it should schedule person name against each assembly line. The output should be a dashboard which shows the date at the top, details on the left, column name as the assembly line and the person name which matches the detail and the assembly line."

## Architecture
- **Backend**: FastAPI + MongoDB (motor). Auto-seeds from `/app/backend/seed_data.xlsx` on startup.
- **Frontend**: React 19 + react-router + shadcn/ui + Tailwind. Theme: "Industrial Control Room" dark.
- **Algorithm**: Specialist-first (candidates sorted by ascending count of total Yes-skills), strict one-assignment-per-person-per-day.

## User Personas
1. **Shift Supervisor** – does daily setup (picks date, lines, absentees), generates the schedule, prints/exports.
2. **Floor Operator / Production Team** – views the big-screen TV board for their station assignment.
3. **HR / Data Admin** – uploads new skill-matrix Excel files when the workforce or skills change.

## Core Requirements (static)
- Pre-load all 77 persons and 14 assembly lines / 63 details from the original Excel.
- Inputs only: date + line selection + absentee marks.
- Auto-schedule respecting skill, absentee, and one-per-day rules.
- Big-screen dashboard: date header, details rows, lines columns, names in cells, shortages highlighted.
- Re-upload Excel button.
- Export Excel & Print (PDF via browser).

## Implemented (2026-02-15)
- Backend (`/app/backend/server.py`):
  - Models: `Person`, `LineDetail`, `Schedule`, `CellAssignment`
  - Endpoints: `GET /api/stats`, `GET /api/persons`, `GET /api/lines`, `GET /api/details`, `POST /api/schedule`, `GET /api/schedule/{date}`, `GET /api/schedules`, `DELETE /api/schedule/{date}`, `POST /api/upload-excel`, `GET /api/export/{date}`
  - Auto-seed from bundled `seed_data.xlsx` (77 persons / 63 details / 14 lines).
  - Specialist-first assignment with strict one-per-day, upsert by date.
- Frontend:
  - `/` Setup – date, line toggles, absentee chip-list with search, live stats, Generate.
  - `/board` Big-screen Board – huge date header, sticky-header matrix, shortage cells (red, pulse), TV mode, Print, Excel export.
  - `/persons` Workforce registry with skill-count progress bars.
  - `/upload` Replace skill-matrix Excel.

## Testing
- Full e2e tested by testing_agent_v3 — 100% backend & frontend pass (iteration_1.json).

## Backlog / Next Steps
- **P0 (none)** – core requirement is complete.
- **P1**: Manual override – let supervisor swap an assigned person in a cell (locks override even if regenerated).
- **P1**: Auto-balance workload counter per person across days (fatigue tracking).
- **P2**: PDF export (currently print-to-PDF via browser).
- **P2**: Weekly/Monthly summary view, shortage analytics (which skills are most-strained).
- **P2**: Multi-shift support (morning / evening rotation).
- **P2**: Mobile-friendly absentee marking (e.g., supervisor walking the floor with a phone).
