import { Link } from "react-router-dom";
import {
    ClipboardList, Users, LayoutGrid, PlayCircle,
    Sparkles, Lock, Upload, Monitor, BarChart3, Flame,
    UserCheck, Undo2, Search, Smartphone, Trash2, CalendarDays, Eye,
    PowerOff, Play,
} from "lucide-react";

const steps = [
    {
        n: "01",
        title: "Set Up Today's Plan",
        icon: LayoutGrid,
        body: [
            "Open Setup from the left menu.",
            "Pick today's date and shift.",
            "Tick the assembly lines that will run today. Set Priority (1 = highest, gets people first) and Runs (how many times a line runs today).",
            "In 'Activities Per Line', each enabled non-Support Ops line shows its own set of activities. All are ticked by default. Untick any single activity for a specific line (e.g. run only Testing for E2 while X-Smart runs everything) — only that line's cell becomes 'not planned today', other lines stay untouched. Use the per-line 'Select all' / 'Deselect all' buttons to flip an entire line in one click.",
            "Support Ops lines (Monkey, KK, Spares, Vehicle, Crimping, OS, 5S+Others) are always fully planned — they don't appear in the activities selector.",
            "In 'Mark Absent', tick everyone who is not coming in today.",
        ],
    },
    {
        n: "02",
        title: "Change Activities Mid-Shift",
        icon: LayoutGrid,
        body: [
            "You can flip a line's activity on or off at any point during the day from the same Setup screen — no need to regenerate the schedule.",
            "Turn a line's activity OFF: associates in that specific (line × activity) cell are freed to the Unassigned pool. The board keeps the cell visible for that line only, marked 'not planned today' — other lines with the same activity are unaffected.",
            "Turn a line's activity BACK ON: the cell becomes active again (empty). Place freed associates using the normal click-to-edit adjust flow.",
        ],
    },
    {
        n: "03",
        title: "Build the Board",
        icon: PlayCircle,
        body: [
            "Click Generate Schedule to build the board from your ticked lines.",
            "Or click Auto-Plan From Absentees to let the tool pick the best set of lines automatically for today's headcount.",
            "You'll land on the Board page with everyone assigned.",
        ],
    },
    {
        n: "04",
        title: "Read the Board",
        icon: Monitor,
        body: [
            "Rows = Areas (P&C ASSEMBLY, SUB ASSEMBLY-1/2/3, FRAME, TESTING, PRE-PACKING, SPYDER, TROLLEY).",
            "Columns = Assembly lines (X-Smart, E2, SK300, GX300…). Support Ops on the right groups small lines (Monkey, KK, Spares, Vehicle, Crimping, OS, 5S+Others).",
            "Next to each line name a small grey number (e.g. · 11) shows the total associates currently assigned to that line — a quick headcount without pulling focus from the cells.",
            "Each cell shows assigned names. Red = shortage. The bottom of the board has Absent and Unassigned rows.",
        ],
    },
    {
        n: "05",
        title: "Search & Filter",
        icon: Search,
        body: [
            "Use the search bar at the top of the Board to find an associate by name — matches light up in yellow across the whole board.",
            "Filter by Skill or by Line to narrow the view instantly. Non-matching cells and chips dim so you can spot options at a glance.",
            "Click Clear to reset filters. Combine name + skill + line for pinpoint results.",
        ],
    },
    {
        n: "06",
        title: "Fix Shortages (with Preview)",
        icon: Sparkles,
        body: [
            "If a red banner appears, click Fill All Shortages. The tool explores every possible reshuffle and finds the arrangement that fills the most seats.",
            "A Preview dialog opens showing exactly who will be added, moved, or displaced — and how many shortages will remain (should almost always be 0).",
            "Click Confirm & Apply to commit, or Cancel to leave the board untouched.",
            "For a single cell: click it → Suggest → tick the best 2-3 candidates → Save.",
        ],
    },
    {
        n: "07",
        title: "Someone Arrived Late",
        icon: UserCheck,
        body: [
            "In the Absent row, click the green tick icon on an associate's chip to open the Late Arrival dialog.",
            "The tool suggests the best fitting open cell (marked 'BEST FIT') and lists all planned lines they're skilled for. Click Approve on any option.",
            "If the chosen cell is already full, a Conflict dialog appears — pick which existing associate to displace, or send the late arrival to the Unassigned pool.",
            "Made a mistake? Use the Undo button in the toolbar to step back — the counter next to Undo shows how many recent actions are stacked (up to the last 5).",
        ],
    },
    {
        n: "08",
        title: "Close a Line Mid-Shift",
        icon: PowerOff,
        body: [
            "Hover any line column on the Board (or tap the power icon on the mobile card) and confirm to close that line for the rest of the shift.",
            "All associates on that line move to the Unassigned pool. No other line is touched. The board removes the closed column entirely so you always see only what's running now.",
            "Closed by mistake? A toast with an 'Undo' button appears for ~10 seconds — click it to reopen the line and restore every associate back to their original cell (anyone reassigned in the meantime keeps their new spot). Beyond that window, closed lines still surface in 'Suggest another line to run' tagged 'REACTIVATE' so you can restart them fresh at any time.",
            "The closure is stamped with a timestamp and appears in Analytics ('Line Closures This Month') and as a ⏻ badge on the History calendar.",
        ],
    },
    {
        n: "09",
        title: "Start a New Line Mid-Shift",
        icon: Play,
        body: [
            "Once anyone is unassigned, click 'Suggest another line to run' below the Unassigned pool. A ranked list opens with each candidate line and the % of it your idle staff can cover.",
            "Previously closed lines still appear in the list, tagged 'REACTIVATE' — click Reactivate to restart them fresh from the current unassigned pool.",
            "The top row is tagged 'BEST FIT'. Click Start on any option — the tool auto-assigns as many unassigned associates as skill match allows.",
            "Associates who don't fit the new line stay unassigned so you can place them manually on any cell.",
        ],
    },
    {
        n: "10",
        title: "Mark Attendance Anywhere",
        icon: Users,
        body: [
            "On desktop: hover any name on the board and click the small × icon to mark that associate absent for today.",
            "The associate moves to the Absent row and their cell becomes short. The rest of the plan stays as-is.",
        ],
    },
    {
        n: "11",
        title: "On Your Phone",
        icon: Smartphone,
        body: [
            "Open the same web link on any phone — the board reshapes into a card view (one card per line) so you can read it without zooming.",
            "Every associate has a red 'mark absent' icon next to their name and a pencil icon to edit that cell — no hover needed.",
            "Use the Undo, Refresh, and Log buttons at the top; icons stay visible even on small screens.",
        ],
    },
    {
        n: "12",
        title: "Freeze & Share",
        icon: Lock,
        body: [
            "Click LOG to freeze the schedule (button turns emerald 'Logged'). This preserves the day for reports.",
            "Use Print / PDF or Snapshot for an image, Excel to download the spreadsheet, or TV Mode for a big-screen view.",
        ],
    },
    {
        n: "13",
        title: "Review the Month",
        icon: BarChart3,
        body: [
            "Analytics: pick any month from the dropdown to see three panels — Top Absenteeism (associates ranked by absences with the exact dates), Lines Hit by Absence (which lines lost the most seats when someone was off), and Line Utilisation (total runs and days each line was scheduled). A 'Line Closures This Month' section lists every mid-shift closure with its date, time, and freed count.",
            "History (calendar): jump into any past day's board. Hover a day (desktop) or tap the trash icon (mobile) to delete an incorrect record — you'll be asked to confirm, and locked schedules show an extra warning. A ⏻N badge marks days where lines were closed.",
            "Heatmap: which Area × Line pairs are fragile — pick trainees for cross-skilling.",
        ],
    },
    {
        n: "14",
        title: "Refresh Data",
        icon: Upload,
        body: [
            "When your skill matrix changes, go to Upload and pick the new .xlsx (keep both sheets: person - skill and assembly line — include a Row name column in the assembly line sheet).",
            "Uploading replaces the current persons + lines. Existing schedules keep working but should be regenerated.",
        ],
    },
];

const glossary = [
    { term: "Required", def: "How many people this cell needs today. You can override it from the edit dialog." },
    { term: "Assigned / Free / Absent", def: "Assigned = on a cell. Free = in the Unassigned pool. Absent = marked off today." },
    { term: "Fill All Shortages", def: "Explores every skill-valid reshuffle and shows a preview of the best arrangement — you Confirm or Cancel." },
    { term: "Late Arrival", def: "Bring someone back from the Absent row into a cell. Auto-suggests the best fit and warns about conflicts." },
    { term: "Undo", def: "Steps back through the last 5 mutating actions on the board (manual edits, fill shortages, mark absent, late arrival, close/reopen line, activity toggles, start line). The counter shows how many steps are stacked." },
    { term: "Search & Filter (Board)", def: "Search by name; filter by Skill or Line. Matches glow yellow, everything else dims." },
    { term: "Priority", def: "Lines with lower numbers grab specialists first when the workforce is tight." },
    { term: "Run count", def: "If a line runs 2× today, a second column '<line> #2' is created. Analytics counts total runs per line for the month." },
    { term: "Log", def: "Freezes the schedule and marks the day as recorded (shows in History and Absenteeism reports)." },
    { term: "Delete record", def: "In History, tap the trash icon on any day/shift to remove that record. Logged schedules require an extra confirmation." },
    { term: "Close a line", def: "Ends a running line mid-shift. Every associate on it moves to the Unassigned pool; the column disappears from the board. A 10-second Undo toast lets you reopen the line with associates restored to their original cells. Closure is stamped with a time in Analytics & History." },
    { term: "Suggest another line to run", def: "Ranks every idle master line by how many unassigned associates can fill it. Start the top choice to auto-fill it from the free pool in one click." },
];

export default function SopPage() {
    return (
        <div className="p-4 sm:p-6 md:p-10 max-w-5xl">
            <header className="mb-10">
                <div className="text-xs tracking-[0.25em] uppercase text-zinc-500 mb-2">
                    Standard Operating Procedure
                </div>
                <h1 className="font-chivo font-black uppercase text-4xl md:text-5xl tracking-tight leading-none">
                    How To Use This Board
                </h1>
                <p className="text-zinc-400 mt-4 text-sm max-w-2xl">
                    A one-page guide for supervisors, floor managers, and new users. Follow the steps
                    below to build, adjust, share, and review the daily schedule — on desktop or on a phone.
                </p>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10">
                {steps.map(({ n, title, icon: Icon, body }) => (
                    <div
                        key={n}
                        className="border border-white/10 bg-[#0f0f0f] p-5"
                        data-testid={`sop-step-${n}`}
                    >
                        <div className="flex items-start gap-4 mb-3">
                            <span className="font-mono-ibm text-[#B0243B] text-xs tracking-[0.25em]">
                                STEP {n}
                            </span>
                            <div className="flex-1" />
                            <Icon className="w-5 h-5 text-[#3B6AB8]" />
                        </div>
                        <h3 className="font-chivo font-bold uppercase tracking-tight text-lg mb-3">
                            {title}
                        </h3>
                        <ul className="space-y-2 text-sm text-zinc-300">
                            {body.map((line, i) => (
                                <li key={i} className="flex gap-2">
                                    <span className="text-zinc-600 mt-1">·</span>
                                    <span>{line}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                ))}
            </div>

            <section className="border border-white/10 bg-[#0f0f0f] p-6 mb-8">
                <div className="flex items-center gap-2 mb-4">
                    <ClipboardList className="w-5 h-5 text-[#3B6AB8]" />
                    <h2 className="font-chivo font-bold uppercase text-xl tracking-tight">Quick Glossary</h2>
                </div>
                <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
                    {glossary.map((g) => (
                        <div key={g.term}>
                            <dt className="text-sm font-semibold text-white">{g.term}</dt>
                            <dd className="text-xs text-zinc-400 mt-1">{g.def}</dd>
                        </div>
                    ))}
                </dl>
            </section>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <section className="border border-emerald-500/30 bg-emerald-500/5 p-6" data-testid="sop-dos">
                    <h2 className="font-chivo font-bold uppercase text-lg tracking-tight text-emerald-300 mb-3 flex items-center gap-2">
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-bold">✔</span>
                        Do
                    </h2>
                    <ul className="space-y-2 text-sm text-emerald-100/90">
                        <li className="flex gap-2"><span className="text-emerald-400 mt-0.5">✔</span><span>Mark absentees on Setup BEFORE generating so the plan is realistic.</span></li>
                        <li className="flex gap-2"><span className="text-emerald-400 mt-0.5">✔</span><span>Deselect specific line activities from Setup's 'Activities Per Line' (e.g. skip Testing on E2 only) — the board keeps that single cell visible as 'not planned' and frees its associates.</span></li>
                        <li className="flex gap-2"><span className="text-emerald-400 mt-0.5">✔</span><span>Always read the Fill Shortages preview before hitting Confirm — reshuffles are shown up-front.</span></li>
                        <li className="flex gap-2"><span className="text-emerald-400 mt-0.5">✔</span><span>Use Late Arrival (green tick on the absent chip) rather than manually clicking cells, so displacements are tracked and undoable.</span></li>
                        <li className="flex gap-2"><span className="text-emerald-400 mt-0.5">✔</span><span>LOG the schedule at end of shift so History and Absenteeism reports stay accurate.</span></li>
                        <li className="flex gap-2"><span className="text-emerald-400 mt-0.5">✔</span><span>Use the phone view to mark absentees on the shop floor without touching a laptop.</span></li>
                    </ul>
                </section>

                <section className="border border-red-500/30 bg-red-500/5 p-6" data-testid="sop-donts">
                    <h2 className="font-chivo font-bold uppercase text-lg tracking-tight text-red-300 mb-3 flex items-center gap-2">
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-red-500/20 border border-red-500/40 text-red-300 font-bold">✘</span>
                        Don't
                    </h2>
                    <ul className="space-y-2 text-sm text-red-100/90">
                        <li className="flex gap-2"><span className="text-red-400 mt-0.5">✘</span><span>Delete a Logged schedule unless you're truly correcting an error — the report loses that day.</span></li>
                        <li className="flex gap-2"><span className="text-red-400 mt-0.5">✘</span><span>Regenerate blindly after manual adjustments — your locks are respected, but a fresh Auto-Plan will discard priorities.</span></li>
                        <li className="flex gap-2"><span className="text-red-400 mt-0.5">✘</span><span>Upload a differently-shaped Excel; keep the exact two sheet names and columns.</span></li>
                    </ul>
                </section>
            </div>

            <div className="mt-10 text-center">
                <Link
                    to="/"
                    data-testid="sop-goto-setup"
                    className="inline-flex items-center gap-2 border border-[#3B6AB8] text-[#3B6AB8] hover:bg-[#3B6AB8] hover:text-white uppercase tracking-widest text-xs font-bold px-6 py-3"
                >
                    <LayoutGrid className="w-4 h-4" /> Go to Setup
                </Link>
            </div>
        </div>
    );
}
