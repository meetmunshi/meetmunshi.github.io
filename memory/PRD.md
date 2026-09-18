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
- 2026-02 (v3): Late Arrival with displacement/conflict resolution + one-step Undo.
- 2026-02 (v4): Fill Shortages Preview — proposed changes shown in a dialog with per-cell added/displaced diff; Confirm applies, Cancel discards. Backend adds `?preview=true` to `POST /api/schedule/{date}/fill-shortages`.
- 2026-02 (v5): Board Search & Filter bar — search worker by name, filter by skill or line; matching names get a yellow highlight, non-matches dimmed (matrix cells, Support Ops, Absent, Unassigned). Setup default priority for "Spares" line forced to 1.
- 2026-02 (v6): Mobile Board — desktop matrix hidden below md; new card view stacks a card per active line (with per-area rows, shortage flags, tap-to-assign) plus Support Ops, Absent (with Late Arrival), and Unassigned sections. Toolbar buttons collapse to icon-only for non-essential actions; filter bar wraps across rows on small screens.
- 2026-02 (v7): Fill Shortages — replaced greedy 3-pass algorithm with global maximum bipartite matching (Kuhn's augmenting paths). Seeded with current assignments so reshuffles only happen when they demonstrably increase total filled seats. Preview diff still lists every added/removed change so the manager can review the full reshuffle before confirming.
- 2026-02 (v8): Analytics page rebuilt around three monthly insights — Top Absenteeism (with per-worker absence dates), Lines Hit by Absence (shortage-days on absentee days), and Line Utilisation (days-run per line vs total scheduled days). New `GET /api/analytics/monthly?month=YYYY-MM` endpoint returns all three plus a `months_available` list feeding the month selector in the header.
- 2026-02 (v9): Line-name normalisation (`_canonical_line` + `LINE_ALIASES_LOWER`) — aliased names like "Element 2" resolve to the canonical "E2" on write in `generate_schedule` and on read in analytics; startup migration rewrites legacy entries in existing schedules. Line utilisation now lists every master line (including 0-day-run lines). History calendar exposes a per-shift Trash button that calls `DELETE /api/schedule/{date}?shift=` with a warning if the schedule is logged.
- 2026-02 (v10): Line utilisation now counts run INSTANCES (sum of `run_count`) rather than distinct scheduled days. E.g. a `run_count=3` E2 on one day plus `run_count=1` on another shows as `4 runs · 2 days`. Sort key is total_runs desc.
- 2026-02 (v11): Deployment hardening — removed legacy startup wipe block in `on_startup`; `seed_from_file_if_empty` now inserts only into empty collections (no destructive delete); `_migrate_canonical_line_names` uses projected cursor + `update_one($set)` so unprojected fields are preserved; `POST /api/upload-excel` requires `?confirm=true` to guard against accidental roster wipe (frontend automatically passes it). Deployment health check now: 🟢 PASS with zero findings.
- 2026-02 (v12): Mid-day line closure + smart line restart. New endpoints: `POST /schedule/{date}/close-line` (frees a running line's associates to unassigned, logs closure with timestamp, no other cells touched), `GET /schedule/{date}/suggest-line` (ranks candidate lines by how many idle associates fit each line's skill needs via bipartite matching), `POST /schedule/{date}/start-line` (adds a new line mid-shift and auto-fills as many unassigned associates as skill match allows). Board column headers show a hover Close button and a persistent CLOSED badge; Unassigned row shows "Suggest best line to run" that opens a Best-Fit dialog. Closures surface in the Analytics month page and as a ⏻N badge in the History calendar cell.
- 2026-02 (v13): Closed lines now drop from the board entirely (not left as a CLOSED column). `close_line` also zeroes `required` on closed cells and recomputes `total_required` so summary chips reflect only running work. Sidebar upgraded (`md:w-60`, `h-10` logo, `text-[11px] leading-tight`) so "SCHEDULING BOARD" no longer clips at the blue-box edge on any viewport. SOP rewritten with two new steps (Close a Line, Start a New Line) + glossary entries. All changes verified responsive at 1920×900 and 390×844.
- 2026-02 (v14): Area selection on Setup. `Schedule` + `ScheduleRequest` gained `disabled_row_names`. New endpoints: `GET /areas` (distinct row_names) and `POST /schedule/{date}/set-disabled-areas` (toggles areas mid-shift — freed associates go to unassigned pool; re-enable restores `required` from `persons_required`). Setup shows "Areas to Run" grid (all checked by default; changes apply immediately when a schedule exists, otherwise on Generate). Board renders disabled rows as "NOT PLANNED" badge + "not planned today" cells on both desktop and mobile. SOP adds step 02 "Change Areas Mid-Shift" and step 01 mentions the areas grid. Do/Don't panel split into a green Do card and a red Don't card side-by-side.
- 2026-02 (v15): Area selection made **line-specific**. `disabled_row_names: List[str]` replaced by `disabled_activities: Dict[str, List[str]]` (line → row_names). Endpoint renamed to `POST /schedule/{date}/set-disabled-activities`. Setup shows a "Activities Per Line" section — one block per enabled line with its unique row_names as checkboxes; deselecting one activity for one line no longer affects the same activity on other lines. Board disables cells per (line, row_name) pair. SOP updated to reflect the per-line semantics.
- 2026-02 (v16): Support Ops exclusion + per-line Deselect All + Undo Line Closure + Fill-Shortages freeze fix.
  - Setup activities selector now excludes Support Ops lines entirely (Monkey, KK, Spares, Vehicle, Crimping, OS, 5S+Others) — they always appear fully planned on the board. Backend `set-disabled-activities` silently drops any Support-Ops key sent (defense in depth).
  - Each non-Support-Ops line in the activities selector now has per-line **Select All** (green) and **Deselect All** (red) buttons, disabled when their action would be a no-op.
  - `close-line` now snapshots the full pre-close assignments (row_name, line_key, detail, required, assigned_person_ids, assigned_person_names) inside the closure record.
  - New `POST /api/schedule/{date}/reopen-line` endpoint: restores every cell of a closed line from its snapshot, pops the closure entry, removes the line_key from closed_line_keys, and excludes anyone already reassigned to avoid double-booking.
  - Board's Close button now shows a 10-second Sonner toast with an "Undo" action wired to `reopen-line`.
  - `POST /schedule/{date}/fill-shortages` no longer permanently freezes the board — it now locks only the cells whose assignments actually changed (previously every cell was added to `unassigned_keys`, disabling auto-fill after later absences). Docstring updated. Re-tested: mark-absent after fill-shortages still triggers a proper refill.
  - SOP updated (step 01 mentions Support Ops carve-out & new Select/Deselect All buttons; step 08 documents the Undo toast).
  - Verified end-to-end with testing_agent iter19 (7/7 backend + full frontend pass, no critical issues).
- 2026-02 (v17): Consolidated duplicate line-suggestion feature + Multi-step Undo (up to 5).
  - Removed the duplicate "What else can we run?" button from the board's Unassigned row (and the `GET /api/schedule/{date}/suggest-lines` endpoint + `_build_suggestion` helper). Kept the more capable one — the button that starts a new line from the current unassigned pool — renamed its label to **"Suggest another line to run"** (both desktop and mobile).
  - `Schedule.previous_state: Optional[dict]` replaced with `history: List[dict]` bounded to the last 5 entries via MongoDB `$push $slice:-5`. Constant `MAX_HISTORY = 5`.
  - New `_undoable_snapshot(sched_doc, action)` helper captures line_configs, absent_person_ids, overrides, unassigned_keys, required_overrides, assignments, closures, closed_line_keys, disabled_activities, totals, plus the human-readable action label and timestamp.
  - Every mutating endpoint (adjust, fill-shortages non-preview, late-arrival mutation path, mark-absent, set-disabled-activities, close-line, reopen-line, start-line) now snapshots the pre-mutation schedule and pushes it to `history`.
  - `POST /api/schedule/{date}/undo` rewritten from a single-shot late-arrival undo into a generic pop-last-snapshot restore that fully replaces line_configs/absent/overrides/unassigned_keys/required_overrides/assignments/closures/closed_line_keys/disabled_activities/totals in one write. 400 when the stack is empty.
  - `generate_schedule` (used internally by adjust/late-arrival etc.) now preserves `history`, `closures`, `closed_line_keys`, `logged_at` from the existing doc, fixing a latent bug where `/adjust` was wiping closures + disabled_activities.
  - Board's Undo button now shows the stack depth as an inline badge (`UNDO 3`), disables when the stack is empty, and its Sonner toast prints the popped action (`Undone: Mark absent · Aarsh Patel`). SOP + glossary updated.
  - Verified end-to-end with testing_agent iter20 (8/8 backend + full frontend pass, no critical issues).

## Testing
- Iteration 2 test report: 100% backend + frontend pass, all 18 scenarios (including priority ordering proof, run duplication with no overlap, adjust set/clear behavior, shift isolation, export filename).

## Backlog
- P1: True native PDF (react-pdf) with print-optimized theme (currently uses browser print which is fine).
- P1: Multi-shift auto-carry (copy day schedule to evening with fresh assignees).
- P2: Fatigue / rotation tracker across days (rolling assignment count per person).
- P2: Undo/redo stack on manual adjustments.
- P2: Mobile PWA – install to home screen, offline absentee marking.
- P2: SMS / WhatsApp broadcast of daily schedule to persons.
