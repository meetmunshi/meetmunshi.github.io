import { Link } from "react-router-dom";
import {
    ClipboardList, Users, LayoutGrid, PlayCircle,
    Sparkles, Lock, Upload, Monitor, CalendarDays, BarChart3, Flame,
} from "lucide-react";

const steps = [
    {
        n: "01",
        title: "Set Up Today's Plan",
        icon: LayoutGrid,
        body: [
            "Open Setup (left menu).",
            "Pick today's date and shift.",
            "Tick the assembly lines that will run today. Set their Priority (1 = highest, gets people first) and Runs (how many times a line runs today).",
            "In 'Mark Absent', tick every person who is not coming in today.",
        ],
    },
    {
        n: "02",
        title: "Build the Board",
        icon: PlayCircle,
        body: [
            "Click Generate Schedule to make the board using your ticked lines.",
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
            "Columns = Assembly lines (X-Smart, E2, SK300, GX300, etc.). Support Ops on the right groups the small lines (Monkey, KK, Spares, Vehicle, Crimping, OS, 5S+Others).",
            "Each cell shows the assigned person names. Red = shortage. Bottom of the board has Absent and Unassigned rows.",
        ],
    },
    {
        n: "04",
        title: "Fix Shortages",
        icon: Sparkles,
        body: [
            "If a red banner appears, click Fill All Shortages — the tool tries the free pool, then borrows from cells with extras, then swaps chains.",
            "For a single cell: click it → in the dialog click Suggest to see the best 2-3 candidates → tick and Save.",
            "You can also add extra hands beyond required or reduce required from the same dialog.",
        ],
    },
    {
        n: "05",
        title: "Handle Late Absences",
        icon: Users,
        body: [
            "Hover any name on the board and click the small × to mark them absent for today.",
            "They move to the Absent row. Their cell becomes short. The rest of the plan stays as-is.",
        ],
    },
    {
        n: "06",
        title: "Freeze & Share",
        icon: Lock,
        body: [
            "Click LOG to freeze the schedule (button turns emerald 'Logged').",
            "Use Print / PDF or Snapshot to save an image, Excel to download a spreadsheet, or TV Mode for a big-screen view.",
        ],
    },
    {
        n: "07",
        title: "Review & Analyse",
        icon: BarChart3,
        body: [
            "History: monthly calendar. Download the Absenteeism report (per-person totals with dates) for the month.",
            "Analytics: top shortage details/lines and daily history trend.",
            "Heatmap: which Area × Line pairs are fragile — pick trainees for cross-skilling.",
        ],
    },
    {
        n: "08",
        title: "Refresh Data",
        icon: Upload,
        body: [
            "When your skill matrix changes, go to Upload and pick the new .xlsx (keep the two sheets: person - skill, assembly line — with a Row name column in the assembly line sheet).",
            "Uploading replaces the current persons + lines. Existing schedules keep working but should be regenerated.",
        ],
    },
];

const glossary = [
    { term: "Required", def: "How many people this cell needs today. You can override it from the edit dialog." },
    { term: "Assigned / Free / Absent", def: "Assigned = on a cell. Free = in the Unassigned pool (available). Absent = marked off today." },
    { term: "Fill All Shortages", def: "Three-pass auto-fix: FREE pool → BORROW from cells that have extras → SWAP chain via a replaceable person." },
    { term: "Priority", def: "Lines with lower numbers grab specialists first when the workforce is tight." },
    { term: "Run count", def: "If you run the same line 2× in a day, it creates a second column '<line> #2'." },
    { term: "Log", def: "Freezes the schedule and marks the day as recorded (shows in History and Absenteeism reports)." },
];

export default function SopPage() {
    return (
        <div className="p-6 md:p-10 max-w-5xl">
            <header className="mb-10">
                <div className="text-xs tracking-[0.25em] uppercase text-zinc-500 mb-2">
                    Standard Operating Procedure
                </div>
                <h1 className="font-chivo font-black uppercase text-4xl md:text-5xl tracking-tight leading-none">
                    How To Use This Board
                </h1>
                <p className="text-zinc-400 mt-4 text-sm max-w-2xl">
                    A one-page guide for supervisors and new users. Follow the 8 steps below to build,
                    adjust, and log the daily schedule.
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
                    <li>✔ Use Auto-Plan when in a hurry; use Setup when you need specific lines.</li>
                    <li>✔ LOG the schedule at end of shift so the History and reports are accurate.</li>
                    <li>✘ Don't regenerate blindly after manually adjusting cells — your locks are respected, but a fresh Auto-Plan will discard priority and runs.</li>
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
