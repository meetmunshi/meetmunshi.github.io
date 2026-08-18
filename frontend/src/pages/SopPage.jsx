import { Link } from "react-router-dom";
import {
    ClipboardList, Users, LayoutGrid, PlayCircle,
    Sparkles, Lock, Upload, Monitor, BarChart3, Flame,
    UserCheck, Undo2, Search, Smartphone, Trash2, CalendarDays, Eye,
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
            "In 'Mark Absent', tick everyone who is not coming in today.",
        ],
    },
    {
        n: "02",
        title: "Build the Board",
        icon: PlayCircle,
        body: [
            "Click Generate Schedule to build the board from your ticked lines.",
            "Or click Auto-Plan From Absentees to let the tool pick the best set of lines automatically for today's headcount.",
            "You'll land on the Board page with everyone assigned.",
        ],
    },
    {
        n: "03",
        title: "Read the Board",
        icon: Monitor,
        body: [
            "Rows = Areas (P&C ASSEMBLY, SUB ASSEMBLY-1/2/3, FRAME, TESTING, PRE-PACKING, SPYDER, TROLLEY).",
            "Columns = Assembly lines (X-Smart, E2, SK300, GX300…). Support Ops on the right groups small lines (Monkey, KK, Spares, Vehicle, Crimping, OS, 5S+Others).",
            "Each cell shows assigned names. Red = shortage. The bottom of the board has Absent and Unassigned rows.",
        ],
    },
    {
        n: "04",
        title: "Search & Filter",
        icon: Search,
        body: [
            "Use the search bar at the top of the Board to find an associate by name — matches light up in yellow across the whole board.",
            "Filter by Skill or by Line to narrow the view instantly. Non-matching cells and chips dim so you can spot options at a glance.",
            "Click Clear to reset filters. Combine name + skill + line for pinpoint results.",
        ],
    },
    {
        n: "05",
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
        n: "06",
        title: "Someone Arrived Late",
        icon: UserCheck,
        body: [
            "In the Absent row, click the green tick icon on an associate's chip to open the Late Arrival dialog.",
            "The tool suggests the best fitting open cell (marked 'BEST FIT') and lists all planned lines they're skilled for. Click Approve on any option.",
            "If the chosen cell is already full, a Conflict dialog appears — pick which existing associate to displace, or send the late arrival to the Unassigned pool.",
            "Made a mistake? Click Undo in the toolbar to roll back the last late-arrival action.",
        ],
    },
    {
        n: "07",
        title: "Mark Attendance Anywhere",
        icon: Users,
        body: [
            "On desktop: hover any name on the board and click the small × icon to mark that associate absent for today.",
            "The associate moves to the Absent row and their cell becomes short. The rest of the plan stays as-is.",
        ],
    },
    {
        n: "08",
        title: "On Your Phone",
        icon: Smartphone,
        body: [
            "Open the same web link on any phone — the board reshapes into a card view (one card per line) so you can read it without zooming.",
            "Every associate has a red 'mark absent' icon next to their name and a pencil icon to edit that cell — no hover needed.",
            "Use the Undo, Refresh, and Log buttons at the top; icons stay visible even on small screens.",
        ],
    },
    {
        n: "09",
        title: "Freeze & Share",
        icon: Lock,
        body: [
            "Click LOG to freeze the schedule (button turns emerald 'Logged'). This preserves the day for reports.",
            "Use Print / PDF or Snapshot for an image, Excel to download the spreadsheet, or TV Mode for a big-screen view.",
        ],
    },
    {
        n: "10",
        title: "Review the Month",
        icon: BarChart3,
        body: [
            "Analytics: pick any month from the dropdown to see three panels — Top Absenteeism (associates ranked by absences with the exact dates), Lines Hit by Absence (which lines lost the most seats when someone was off), and Line Utilisation (total runs and days each line was scheduled).",
            "History (calendar): jump into any past day's board. Hover a day (desktop) or tap the trash icon (mobile) to delete an incorrect record — you'll be asked to confirm, and locked schedules show an extra warning.",
            "Heatmap: which Area × Line pairs are fragile — pick trainees for cross-skilling.",
        ],
    },
    {
        n: "11",
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
    { term: "Undo", def: "Reverts the last Late Arrival (one step back). Toast confirms once done." },
    { term: "Search & Filter (Board)", def: "Search by name; filter by Skill or Line. Matches glow yellow, everything else dims." },
    { term: "Priority", def: "Lines with lower numbers grab specialists first when the workforce is tight." },
    { term: "Run count", def: "If a line runs 2× today, a second column '<line> #2' is created. Analytics counts total runs per line for the month." },
    { term: "Log", def: "Freezes the schedule and marks the day as recorded (shows in History and Absenteeism reports)." },
    { term: "Delete record", def: "In History, tap the trash icon on any day/shift to remove that record. Logged schedules require an extra confirmation." },
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

            <section className="border border-emerald-500/30 bg-emerald-500/5 p-6">
                <h2 className="font-chivo font-bold uppercase text-lg tracking-tight text-emerald-300 mb-2">
                    Do & Don't
                </h2>
                <ul className="space-y-2 text-sm text-zinc-300">
                    <li>✔ Mark absentees on Setup BEFORE generating so the plan is realistic.</li>
                    <li>✔ Always read the Fill Shortages preview before hitting Confirm — reshuffles are shown up-front.</li>
                    <li>✔ Use Late Arrival (green tick on the absent chip) rather than manually clicking cells, so displacements are tracked and undoable.</li>
                    <li>✔ LOG the schedule at end of shift so History and Absenteeism reports stay accurate.</li>
                    <li>✔ Use the phone view to mark absentees on the shop floor without touching a laptop.</li>
                    <li>✘ Don't delete a Logged schedule unless you're truly correcting an error — the report loses that day.</li>
                    <li>✘ Don't regenerate blindly after manual adjustments — your locks are respected, but a fresh Auto-Plan will discard priorities.</li>
                    <li>✘ Don't upload a differently-shaped Excel; keep the exact two sheet names and columns.</li>
                </ul>
            </section>

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
