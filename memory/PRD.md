# FFM Production Scheduling Board – PRD

## Original Problem Statement
> "I have one excel file which has person/resource name and the skill details. Another sheet has the detail and the assembly line matchup and the number of persons required. I want to design one automated resource scheduling board. Only input should be which line to work on the particular day and select which persons are absent and then it should schedule person name against each assembly line. The output should be a dashboard which shows the date at the top, details on the left, column name as the assembly line and the person name which matches the detail and the assembly line."

## Follow-up (v2, 2026-07-16)
- New Excel (FINAL) adds `Row name` column – dashboard rows now come from Row name
- Run counter per line (schedule a line 2/3× with a `#2`, `#3` column suffix)
- Priority number per line (lower = filled first)
- Absent row at the bottom of the board
- Manual adjustment via clickable cells (Dialog with skill-eligible person picker; also Unassign)
- Shift selector (day / evening / night)
- Shortage Analytics page + Monthly History calendar
- PDF export via browser Print · mobile-friendly setup

## Architecture
- Backend: FastAPI + MongoDB (motor). Auto-seeds from `/app/backend/seed_data.xlsx` (FINAL).
- Frontend: React 19 + shadcn/ui + Tailwind. "Industrial Control Room" dark theme.
- Algorithm: sort configs by priority ASC → for each line expand `run_count` × details → specialist-first pick, honor overrides & unassigned_keys, no reuse per date+shift.

## Endpoints
- `GET /api/stats`, `GET /api/persons`, `GET /api/lines`, `GET /api/details`
- `POST /api/schedule`, `GET /api/schedule/{date}?shift=`, `GET /api/schedules`, `DELETE /api/schedule/{date}?shift=`
- `POST /api/schedule/{date}/adjust`  (cell_key = `row_name||line_key`, action = set|clear)
- `POST /api/upload-excel`, `GET /api/export/{date}?shift=`
- `GET /api/analytics/shortage`

## Frontend Pages
- `/` Setup — date, shift, per-line priority + run stepper + enable, absentee list
- `/board` Big-screen Board — row names ↔ line_keys matrix, click cell → adjust dialog, absent bottom row, TV / Print / Excel
- `/history` Monthly calendar with schedule dots
- `/analytics` Shortage analytics
- `/persons` Workforce registry, `/upload` Excel replacement

## Implemented (dates)
- 2026-02-15 (v1): row = detail, no priority/runs, single date scheduling.
- 2026-07-16 (v2): row = row_name; priority + run_count; shift; absent bottom row; click-to-adjust manual override with persistence; Analytics; History calendar; PDF via browser print.

## Testing
- Iteration 2 test report: 100% backend + frontend pass, all 18 scenarios (including priority ordering proof, run duplication with no overlap, adjust set/clear behavior, shift isolation, export filename).

## Backlog
- P1: True native PDF (react-pdf) with print-optimized theme (currently uses browser print which is fine).
- P1: Multi-shift auto-carry (copy day schedule to evening with fresh assignees).
- P2: Fatigue / rotation tracker across days (rolling assignment count per person).
- P2: Undo/redo stack on manual adjustments.
- P2: Mobile PWA – install to home screen, offline absentee marking.
- P2: SMS / WhatsApp broadcast of daily schedule to persons.
