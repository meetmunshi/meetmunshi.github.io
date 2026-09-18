import { useEffect, useMemo, useState, useRef } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { toast } from "sonner";
import html2canvas from "html2canvas";
import {
    fetchSchedule,
    exportScheduleUrl,
    fetchPersons,
    adjustCell,
    fillShortages,
    previewFillShortages,
    suggestLines,
    generateSchedule,
    markAbsentFromBoard,
    logSchedule,
    suggestReplacement,
    lateArrival,
    undoLateArrival,
    closeLine,
    suggestLineToStart,
    startLine,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Download,
    Printer,
    AlertCircle,
    Maximize2,
    ChevronLeft,
    Pencil,
    UserX,
    RotateCcw,
    RefreshCw,
    Camera,
    UserPlus,
    Sparkles,
    Lightbulb,
    Plus,
    Lock,
    CheckCircle2,
    Wand2,
    Undo2,
    UserCheck,
    PowerOff,
    Play,
} from "lucide-react";

const todayISO = () => new Date().toISOString().slice(0, 10);

// Fixed row-name display order (case-insensitive). Anything else appears after in first-seen order.
const ROW_ORDER = [
    "p&c assembly", "sub assembly - 1", "sub assembly - 2", "sub assembly - 3",
    "frame", "testing", "pre-packing", "spyder", "trolley",
];

// Small "support" lines merged into one rightmost column
const SUPPORT_LINES = ["Monkey", "KK", "Spares", "Vehicle", "Crimping", "OS", "5S+Others"];

function formatLongDate(iso) {
    if (!iso) return "";
    try {
        const d = new Date(iso + "T00:00:00");
        return d.toLocaleDateString("en-US", {
            weekday: "long", day: "2-digit", month: "long", year: "numeric",
        }).toUpperCase();
    } catch { return iso; }
}

export default function BoardPage() {
    const [params, setParams] = useSearchParams();
    const date = params.get("date") || todayISO();
    const shift = params.get("shift") || "day";
    const tvMode = params.get("tv") === "1";
    const [schedule, setSchedule] = useState(null);
    const [persons, setPersons] = useState([]);
    const [loading, setLoading] = useState(false);
    const [editCell, setEditCell] = useState(null);
    const [lastFetched, setLastFetched] = useState(null);
    const [tick, setTick] = useState(0);
    const [suggestions, setSuggestions] = useState(null);
    const [suggestOpen, setSuggestOpen] = useState(false);
    const [lateArr, setLateArr] = useState(null); // {person, best_fit, planned, not_planned}
    const [displaceConflict, setDisplaceConflict] = useState(null);
    const [fillPreview, setFillPreview] = useState(null); // {initial_shortage, remaining_shortage, filled_count, changes[]}
    const [fillApplying, setFillApplying] = useState(false);
    const [filters, setFilters] = useState({ q: "", skill: "", line: "" });
    const clearFilters = () => setFilters({ q: "", skill: "", line: "" });
    const [lineSuggest, setLineSuggest] = useState(null); // { unassigned_pool_size, suggestions[] } | null
    const [startingLine, setStartingLine] = useState(null); // line name being started
    const boardRef = useRef(null);

    const setTv = (on) => {
        const p = { date, shift };
        if (on) p.tv = "1";
        setParams(p);
    };

    const load = () => {
        setLoading(true);
        Promise.all([fetchSchedule(date, shift), fetchPersons()])
            .then(([s, p]) => { setSchedule(s); setPersons(p); setLastFetched(Date.now()); setSuggestions(null); })
            .finally(() => setLoading(false));
    };
    useEffect(load, [date, shift]);

    const loadSuggestions = async () => {
        try {
            const s = await suggestLines(date, shift);
            setSuggestions(s);
            setSuggestOpen(true);
        } catch (e) {
            toast.error(e.response?.data?.detail || e.message);
        }
    };

    const addLineToSchedule = async (line) => {
        if (!schedule) return;
        const cfgs = [...(schedule.line_configs || [])];
        const maxPrio = cfgs.reduce((m, c) => Math.max(m, c.priority || 0), 0);
        cfgs.push({ line, priority: maxPrio + 1, run_count: 1 });
        try {
            await generateSchedule({
                date,
                shift,
                line_configs: cfgs,
                absent_person_ids: schedule.absent_person_ids || [],
                overrides: schedule.overrides || {},
                unassigned_keys: schedule.unassigned_keys || [],
            });
            toast.success(`Added ${line} to today's schedule`);
            setSuggestOpen(false);
            load();
        } catch (e) {
            toast.error(e.response?.data?.detail || e.message);
        }
    };

    // "Updated N ago" ticker
    useEffect(() => {
        const t = setInterval(() => setTick((v) => v + 1), 30000);
        return () => clearInterval(t);
    }, []);

    const updatedLabel = useMemo(() => {
        if (!lastFetched) return "";
        void tick;
        const s = Math.floor((Date.now() - lastFetched) / 1000);
        if (s < 60) return "Updated just now";
        const m = Math.floor(s / 60);
        if (m < 60) return `Updated ${m} min ago`;
        const h = Math.floor(m / 60);
        return `Updated ${h}h ${m % 60}m ago`;
    }, [lastFetched, tick]);

    const takeScreenshot = async () => {
        if (!boardRef.current) return;
        try {
            const canvas = await html2canvas(boardRef.current, {
                backgroundColor: "#0a0a0a",
                scale: 2,
                useCORS: true,
            });
            canvas.toBlob((blob) => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `schedule-${date}-${shift}.png`;
                a.click();
                URL.revokeObjectURL(url);
                toast.success("Screenshot saved");
            });
        } catch (e) {
            toast.error("Screenshot failed: " + e.message);
        }
    };

    const personById = useMemo(() => {
        const m = {};
        persons.forEach((p) => (m[p.id] = p));
        return m;
    }, [persons]);

    const { rowNames, colKeys, matrix, summary, absentPersons, supportItems, plannedLines, unassignedPersons } = useMemo(() => {
        if (!schedule) return { rowNames: [], colKeys: [], matrix: {}, summary: null, absentPersons: [], supportItems: [], plannedLines: new Set(), unassignedPersons: [] };
        const closedSet = new Set(schedule.closed_line_keys || []);
        const cols = [];
        const seenCol = new Set();
        const planned = new Set();
        (schedule.line_configs || [])
            .slice()
            .sort((a, b) => a.priority - b.priority || a.line.localeCompare(b.line))
            .forEach((c) => {
                planned.add(c.line);
                if (SUPPORT_LINES.includes(c.line)) return; // handled separately
                for (let r = 1; r <= (c.run_count || 1); r++) {
                    const k = r === 1 ? c.line : `${c.line} #${r}`;
                    if (closedSet.has(k)) return; // closed lines drop off the board
                    if (!seenCol.has(k)) { cols.push(k); seenCol.add(k); }
                }
            });

        const rns = [];
        const seenR = new Set();
        const mtx = {};
        (schedule.assignments || []).forEach((a) => {
            if (SUPPORT_LINES.includes(a.line)) return;
            if (closedSet.has(a.line_key)) return; // drop assignments of closed lines
            if (!seenR.has(a.row_name)) { rns.push(a.row_name); seenR.add(a.row_name); }
            const k = a.row_name + "||" + a.line_key;
            if (!mtx[k]) mtx[k] = [];
            mtx[k].push(a);
        });
        // Apply fixed display order: preferred first, then remainder in first-seen order
        const rank = (name) => {
            const idx = ROW_ORDER.indexOf(String(name).toLowerCase().trim());
            return idx === -1 ? 999 : idx;
        };
        rns.sort((a, b) => {
            const ra = rank(a), rb = rank(b);
            if (ra !== rb) return ra - rb;
            return rns.indexOf(a) - rns.indexOf(b);
        });

        // Support column items: one entry per small line (drop closed support lines)
        const suppByLine = {};
        (schedule.assignments || []).forEach((a) => {
            if (!SUPPORT_LINES.includes(a.line)) return;
            if (closedSet.has(a.line_key)) return;
            if (!suppByLine[a.line]) suppByLine[a.line] = [];
            suppByLine[a.line].push(a);
        });
        const supp = SUPPORT_LINES
            .filter((line) => !closedSet.has(line))
            .map((line) => ({
                line,
                planned: planned.has(line),
                assignments: suppByLine[line] || [],
            }));

        const abs = (schedule.absent_person_ids || [])
            .map((id) => personById[id])
            .filter(Boolean);

        return {
            rowNames: rns, colKeys: cols, matrix: mtx,
            summary: {
                required: schedule.total_required,
                assigned: schedule.total_assigned,
                shortage: schedule.total_shortage,
            },
            absentPersons: abs,
            supportItems: supp,
            plannedLines: planned,
            unassignedPersons: (() => {
                const absentSet = new Set(schedule.absent_person_ids || []);
                const assigned = new Set();
                (schedule.assignments || []).forEach((a) =>
                    a.assigned_person_ids.forEach((id) => assigned.add(id)),
                );
                return persons
                    .filter((p) => !absentSet.has(p.id) && !assigned.has(p.id))
                    .sort((a, b) =>
                        `${a.name} ${a.surname}`.localeCompare(`${b.name} ${b.surname}`),
                    );
            })(),
        };
    }, [schedule, personById, persons]);

    // Map: person_id -> list of {row_name, line_key} they're currently assigned to
    const personLocations = useMemo(() => {
        const m = {};
        (schedule?.assignments || []).forEach((a) => {
            a.assigned_person_ids.forEach((id) => {
                if (!m[id]) m[id] = [];
                m[id].push({ row_name: a.row_name, line_key: a.line_key });
            });
        });
        return m;
    }, [schedule]);

    // All skill names available across the workforce (union of persons.skills keys where any=true)
    const skillOptions = useMemo(() => {
        const s = new Set();
        (persons || []).forEach((p) => {
            Object.entries(p.skills || {}).forEach(([k, v]) => { if (v) s.add(k); });
        });
        return Array.from(s).sort((a, b) => a.localeCompare(b));
    }, [persons]);

    const filterActive = !!(filters.q.trim() || filters.skill || filters.line);
    // Person IDs matching all active filters
    const matchedIds = useMemo(() => {
        if (!filterActive) return null;
        const q = filters.q.trim().toLowerCase();
        const ids = new Set();
        (persons || []).forEach((p) => {
            const full = `${p.name || ""} ${p.surname || ""}`.toLowerCase();
            if (q && !full.includes(q)) return;
            if (filters.skill && !p.skills?.[filters.skill]) return;
            if (filters.line) {
                const locs = personLocations[p.id] || [];
                const onLine = locs.some((l) => l.line_key === filters.line);
                // Also allow persons idle/absent who have skill matching any detail on the selected line
                if (!onLine) {
                    const lineDetails = new Set(
                        (schedule?.assignments || [])
                            .filter((a) => a.line_key === filters.line)
                            .map((a) => a.detail)
                    );
                    let hasSkill = false;
                    lineDetails.forEach((d) => { if (p.skills?.[d]) hasSkill = true; });
                    if (!hasSkill) return;
                }
            }
            ids.add(p.id);
        });
        return ids;
    }, [filters, filterActive, persons, personLocations, schedule]);

    // Column matching helper: dim columns not matching line filter
    const isColMatch = (colKey) => !filters.line || colKey === filters.line;
    // Detail matching helper: dim cells whose detail doesn't match skill filter
    const isDetailMatch = (detail) => !filters.skill || detail === filters.skill;

    // Closed line keys (from schedule doc, updated on load)
    const closedKeys = useMemo(() => new Set(schedule?.closed_line_keys || []), [schedule]);
    // Deselected areas (rows the manager toggled off in Setup)
    const disabledRows = useMemo(() => new Set(schedule?.disabled_row_names || []), [schedule]);

    if (loading) return <div className="p-12 text-zinc-500">Loading…</div>;
    if (!schedule) {
        return (
            <div className="p-12 max-w-2xl">
                <Link to="/" className="inline-flex items-center text-zinc-400 hover:text-white text-sm mb-6" data-testid="back-to-setup">
                    <ChevronLeft className="w-4 h-4 mr-1" /> Back to setup
                </Link>
                <h1 className="font-chivo font-black uppercase text-4xl">No Schedule for {date} ({shift})</h1>
                <p className="text-zinc-400 mt-3">
                    Go to <Link to="/" className="text-[#3B6AB8] underline">Setup</Link> and generate one.
                </p>
            </div>
        );
    }

    const openEdit = (item) => {
        // `item` is either a single assignment or an array of sub-detail assignments
        if (Array.isArray(item)) {
            setEditCell({ multi: true, items: item, current: item[0] });
        } else {
            setEditCell({ multi: false, items: [item], current: item });
        }
    };
    const closeEdit = () => setEditCell(null);

    const switchSubDetail = (a) => {
        setEditCell((prev) => prev ? { ...prev, current: a } : prev);
    };

    const savePicks = async (picks, requiredOverride) => {
        const cell = editCell?.current;
        if (!cell) return;
        try {
            await adjustCell(date, {
                shift,
                cell_key: `${cell.row_name}||${cell.line_key}||${cell.detail}`,
                action: "set",
                person_ids: picks,
                required: requiredOverride,
            });
            toast.success("Updated");
            closeEdit();
            load();
        } catch (e) {
            toast.error(e.response?.data?.detail || e.message);
        }
    };

    const clearCell = async () => {
        const cell = editCell?.current;
        if (!cell) return;
        try {
            await adjustCell(date, {
                shift,
                cell_key: `${cell.row_name}||${cell.line_key}||${cell.detail}`,
                action: "clear",
            });
            toast.success("Cleared");
            closeEdit();
            load();
        } catch (e) {
            toast.error(e.response?.data?.detail || e.message);
        }
    };

    const handleQuickAbsent = async (personId, name) => {
        if (!window.confirm(`Mark ${name} absent for today?\nThey'll be removed from their cells but the rest of the schedule stays.`)) return;
        try {
            await markAbsentFromBoard(date, { shift, person_id: personId });
            toast.success(`${name} marked absent`);
            load();
        } catch (e) {
            toast.error(e.response?.data?.detail || e.message);
        }
    };

    const handleCloseLine = async (lineKey) => {
        if (!window.confirm(`Close the ${lineKey} line?\nAll associates currently on this line will move to the Unassigned pool. Other lines are not touched. This action is logged.`)) return;
        try {
            const r = await closeLine(date, { shift, line_key: lineKey });
            toast.success(`${lineKey} closed · ${r.closures?.[r.closures.length - 1]?.freed_count || 0} associates freed`);
            load();
        } catch (e) {
            toast.error(e.response?.data?.detail || e.message);
        }
    };

    const openLineSuggest = async () => {
        try {
            const r = await suggestLineToStart(date, shift);
            if (!r.suggestions || r.suggestions.length === 0) {
                toast.info(r.unassigned_pool_size === 0 ? "No unassigned associates available" : "No new lines can be started with the current unassigned pool");
                return;
            }
            setLineSuggest(r);
        } catch (e) {
            toast.error(e.response?.data?.detail || e.message);
        }
    };

    const handleStartLine = async (lineName) => {
        setStartingLine(lineName);
        try {
            const r = await startLine(date, { shift, line: lineName, priority: 3, run_count: 1 });
            const assigned = r.assignments.filter(a => a.line === lineName).reduce((s, a) => s + a.assigned_person_ids.length, 0);
            const required = r.assignments.filter(a => a.line === lineName).reduce((s, a) => s + a.required, 0);
            toast.success(`${lineName} started · ${assigned}/${required} filled from unassigned pool`);
            setLineSuggest(null);
            load();
        } catch (e) {
            toast.error(e.response?.data?.detail || e.message);
        } finally {
            setStartingLine(null);
        }
    };

    const openLateArrival = async (person) => {
        try {
            const r = await lateArrival(date, { shift, person_id: person.id });
            setLateArr({ person, ...r });
        } catch (e) {
            toast.error(e.response?.data?.detail || e.message);
        }
    };

    const assignLateArrival = async (opt) => {
        if (!lateArr) return;
        try {
            const r = await lateArrival(date, {
                shift,
                person_id: lateArr.person.id,
                target: {
                    line: opt.line,
                    row_name: opt.row_name,
                    detail: opt.detail,
                    required: opt.required,
                },
            });
            if (r.displaced) {
                setDisplaceConflict({
                    displaced: r.displaced,
                    lateArrivalName: lateArr.person.name || `${lateArr.person.name} ${lateArr.person.surname}`,
                });
                setLateArr(null);
            } else {
                setLateArr(null);
                toast.success(
                    r.displaced_placed_id
                        ? "Assigned; displaced associate moved to a shortage cell"
                        : "Assigned successfully",
                );
            }
            load();
        } catch (e) {
            toast.error(e.response?.data?.detail || e.message);
        }
    };

    const resolveDisplaced = async (opt) => {
        if (!displaceConflict) return;
        try {
            await lateArrival(date, {
                shift,
                person_id: displaceConflict.displaced.id,
                target: { line: opt.line, row_name: opt.row_name, detail: opt.detail, required: 1 },
            });
            setDisplaceConflict(null);
            toast.success("Displaced associate reassigned");
            load();
        } catch (e) {
            toast.error(e.response?.data?.detail || e.message);
        }
    };

    const doUndo = async () => {
        try {
            await undoLateArrival(date, shift);
            toast.success("Undone");
            load();
        } catch (e) {
            toast.error(e.response?.data?.detail || e.message);
        }
    };

    const handleLog = async () => {
        if (!schedule) return;
        if (schedule.logged_at) {
            if (!window.confirm("This schedule is already logged. Re-log to update the timestamp?")) return;
        }
        try {
            await logSchedule(date, shift);
            toast.success("Schedule logged");
            load();
        } catch (e) {
            toast.error(e.response?.data?.detail || e.message);
        }
    };

    return (
        <div className={tvMode ? "p-4 bg-black min-h-screen" : "p-4 sm:p-6 md:p-8"} ref={boardRef}>
            <header className="flex flex-wrap items-start justify-between gap-4 mb-5 no-print">
                <div>
                    <div className="text-[10px] tracking-[0.3em] uppercase text-zinc-500 mb-1">
                        Daily Resource Scheduling Board · <span className="text-[#3B6AB8]">{shift}</span>
                        {updatedLabel && (
                            <span className="ml-3 text-zinc-600 normal-case tracking-normal">
                                · <span data-testid="updated-label">{updatedLabel}</span>
                            </span>
                        )}
                    </div>
                    <h1
                        className="font-chivo font-black uppercase tracking-tighter leading-none text-[clamp(2rem,4.5vw,5rem)]"
                        data-testid="board-date"
                    >
                        {formatLongDate(date)}
                    </h1>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <input
                        type="date"
                        value={date}
                        onChange={(e) => setParams({ date: e.target.value, shift, ...(tvMode ? {tv:"1"} : {}) })}
                        data-testid="board-date-input"
                        className="bg-[#111] border border-white/10 px-3 py-2 text-sm font-mono-ibm rounded-none text-white"
                    />
                    <select
                        value={shift}
                        onChange={(e) => setParams({ date, shift: e.target.value, ...(tvMode ? {tv:"1"} : {}) })}
                        data-testid="board-shift-select"
                        className="bg-[#111] border border-white/10 px-3 py-2 text-sm rounded-none text-white uppercase"
                    >
                        <option value="day">Day</option>
                        <option value="evening">Evening</option>
                        <option value="night">Night</option>
                    </select>
                    <Button
                        variant="outline"
                        onClick={doUndo}
                        data-testid="undo-btn"
                        title="Undo last late-arrival assignment"
                        className="rounded-none border-white/15 text-white bg-transparent hover:bg-white/10 uppercase tracking-widest text-xs"
                    >
                        <Undo2 className="w-4 h-4 mr-2" /> Undo
                    </Button>
                    <Button
                        variant="outline"
                        onClick={load}
                        data-testid="refresh-btn"
                        className="rounded-none border-white/15 text-white bg-transparent hover:bg-white/10 uppercase tracking-widest text-xs"
                    >
                        <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
                    </Button>
                    <Button
                        variant="outline"
                        onClick={() => setTv(!tvMode)}
                        data-testid="tv-mode-btn"
                        className="rounded-none border-white/15 text-white bg-transparent hover:bg-white/10 uppercase tracking-widest text-xs"
                    >
                        <Maximize2 className="w-4 h-4 sm:mr-2" />
                        <span className="hidden sm:inline">{tvMode ? "Exit TV" : "TV Mode"}</span>
                    </Button>
                    <Button
                        variant="outline"
                        onClick={takeScreenshot}
                        data-testid="screenshot-btn"
                        className="rounded-none border-white/15 text-white bg-transparent hover:bg-white/10 uppercase tracking-widest text-xs"
                    >
                        <Camera className="w-4 h-4 sm:mr-2" /> <span className="hidden sm:inline">Snapshot</span>
                    </Button>
                    <Button
                        variant="outline"
                        onClick={() => window.print()}
                        data-testid="print-btn"
                        className="rounded-none border-white/15 text-white bg-transparent hover:bg-white/10 uppercase tracking-widest text-xs"
                    >
                        <Printer className="w-4 h-4 sm:mr-2" /> <span className="hidden sm:inline">Print / PDF</span>
                    </Button>
                    <a href={exportScheduleUrl(date, shift)} data-testid="export-xlsx-btn">
                        <Button className="rounded-none bg-[#3B6AB8] hover:bg-[#3B6AB8]/85 uppercase tracking-widest text-xs">
                            <Download className="w-4 h-4 sm:mr-2" /> <span className="hidden sm:inline">Excel</span>
                        </Button>
                    </a>
                    <Button
                        onClick={handleLog}
                        data-testid="log-schedule-btn"
                        className={`rounded-none uppercase tracking-widest text-xs font-bold ${
                            schedule?.logged_at
                                ? "bg-emerald-600 hover:bg-emerald-600/85 text-white"
                                : "bg-[#B0243B] hover:bg-[#B0243B]/85 text-white"
                        }`}
                    >
                        {schedule?.logged_at ? (
                            <><CheckCircle2 className="w-4 h-4 mr-2" /> Logged</>
                        ) : (
                            <><Lock className="w-4 h-4 mr-2" /> Log</>
                        )}
                    </Button>
                </div>
            </header>

            <div className="flex flex-wrap gap-3 mb-4 no-print">
                <Chip label="Lines" value={colKeys.length} />
                <Chip label="Required" value={summary.required} />
                <Chip
                    label="Assigned"
                    value={summary.assigned}
                    accent={summary.assigned >= summary.required ? "ok" : "warn"}
                />
                <Chip
                    label="Shortage"
                    value={summary.shortage}
                    accent={summary.shortage > 0 ? "alert" : "ok"}
                />
                <Chip label="Absent" value={absentPersons.length} accent={absentPersons.length > 0 ? "alert" : "ok"} />
                <Chip label="Unassigned" value={unassignedPersons.length} accent={unassignedPersons.length > 0 ? "warn" : "ok"} />
            </div>

            {/* Search + Filter bar */}
            <div className="flex flex-wrap items-center gap-2 mb-4 no-print" data-testid="board-filter-bar">
                <div className="flex items-center border border-white/10 bg-[#111] px-3 py-2 min-w-[180px] flex-1 basis-full sm:basis-auto">
                    <svg className="w-4 h-4 text-zinc-500 mr-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
                    <input
                        type="text"
                        value={filters.q}
                        onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
                        placeholder="Search associate by name…"
                        data-testid="board-search-input"
                        className="bg-transparent flex-1 outline-none text-sm text-white placeholder:text-zinc-600"
                    />
                </div>
                <select
                    value={filters.skill}
                    onChange={(e) => setFilters((f) => ({ ...f, skill: e.target.value }))}
                    data-testid="board-filter-skill"
                    className="bg-[#111] border border-white/10 px-3 py-2 text-sm rounded-none text-white uppercase tracking-wide flex-1 sm:flex-none sm:min-w-[180px] min-w-0"
                >
                    <option value="">All skills</option>
                    {skillOptions.map((s) => (
                        <option key={s} value={s}>{s}</option>
                    ))}
                </select>
                <select
                    value={filters.line}
                    onChange={(e) => setFilters((f) => ({ ...f, line: e.target.value }))}
                    data-testid="board-filter-line"
                    className="bg-[#111] border border-white/10 px-3 py-2 text-sm rounded-none text-white uppercase tracking-wide flex-1 sm:flex-none sm:min-w-[160px] min-w-0"
                >
                    <option value="">All lines</option>
                    {colKeys.map((k) => (
                        <option key={k} value={k}>{k}</option>
                    ))}
                </select>
                {filterActive && (
                    <>
                        <span
                            className="text-[10px] uppercase tracking-widest text-yellow-400 border border-yellow-400/40 bg-yellow-400/10 px-2 py-1"
                            data-testid="board-filter-count"
                        >
                            {matchedIds ? matchedIds.size : 0} match
                        </span>
                        <Button
                            variant="outline"
                            onClick={clearFilters}
                            data-testid="board-filter-clear"
                            className="rounded-none border-white/15 text-white bg-transparent hover:bg-white/10 uppercase tracking-widest text-xs"
                        >
                            Clear
                        </Button>
                    </>
                )}
            </div>

            {summary.shortage > 0 && (
                <div className="flex flex-wrap items-center gap-3 border border-red-500 bg-red-950/30 text-red-400 px-4 py-3 mb-4 no-print">
                    <AlertCircle className="w-5 h-5 animate-pulse" />
                    <span className="text-sm uppercase tracking-widest flex-1">
                        Critical: {summary.shortage} positions unfilled
                    </span>
                    <Button
                        onClick={async () => {
                            try {
                                const p = await previewFillShortages(date, shift);
                                if (!p.changes || p.changes.length === 0) {
                                    toast.info("No free skilled staff available for remaining shortages");
                                    return;
                                }
                                setFillPreview(p);
                            } catch (e) {
                                toast.error(e.response?.data?.detail || e.message);
                            }
                        }}
                        data-testid="fill-shortages-btn"
                        className="rounded-none bg-emerald-500 hover:bg-emerald-500/85 text-black uppercase tracking-widest text-xs font-bold"
                    >
                        <Sparkles className="w-4 h-4 mr-2" /> Fill All Shortages
                    </Button>
                </div>
            )}

            {/* Matrix */}
            {/* Matrix — desktop / print */}
            <div className="hidden md:block overflow-x-auto print-board" data-testid="schedule-matrix">
                <table className="w-full border-collapse" style={{ minWidth: colKeys.length * 170 + 240 }}>
                    <thead>
                        <tr>
                            <th className="sticky left-0 bg-[#0a0a0a] z-20 grid-cell px-4 py-3 text-left text-[11px] uppercase tracking-[0.25em] text-zinc-400 font-bold w-[220px]">
                                Area
                            </th>
                            {colKeys.map((k) => {
                                const isClosed = closedKeys.has(k);
                                return (
                                <th
                                    key={k}
                                    className={`grid-cell px-4 py-3 text-left font-chivo uppercase font-bold text-base md:text-lg tracking-tight bg-[#111] group ${isClosed ? "opacity-60" : ""}`}
                                    data-testid={`col-header-${k}`}
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <span>{k}</span>
                                        {isClosed ? (
                                            <span
                                                className="text-[9px] uppercase tracking-widest font-bold text-red-300 bg-red-500/15 border border-red-500/40 px-1.5 py-0.5"
                                                data-testid={`col-closed-${k}`}
                                            >
                                                Closed
                                            </span>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={() => handleCloseLine(k)}
                                                title={`Close ${k} line`}
                                                aria-label={`Close ${k} line`}
                                                data-testid={`close-line-btn-${k}`}
                                                className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 border border-red-500/30 hover:border-red-500 bg-red-500/5 hover:bg-red-500/15 p-1 no-print"
                                            >
                                                <PowerOff className="w-3 h-3" />
                                            </button>
                                        )}
                                    </div>
                                </th>
                            );})}
                            <th
                                className="grid-cell px-4 py-3 text-left font-chivo uppercase font-bold text-base md:text-lg tracking-tight bg-[#111] w-[260px]"
                                data-testid="col-header-support"
                            >
                                Support Ops
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {rowNames.map((rn, rIdx) => {
                            const rowDisabled = disabledRows.has(rn);
                            return (
                            <tr key={rn} className={rowDisabled ? "opacity-60" : ""}>
                                <th
                                    className="sticky left-0 bg-[#0a0a0a] z-10 grid-cell px-4 py-3 text-left text-sm font-bold text-zinc-100 uppercase tracking-wide"
                                    data-testid={`row-header-${rn}`}
                                >
                                    <div className="flex items-center gap-2">
                                        <span>{rn.toUpperCase()}</span>
                                        {rowDisabled && (
                                            <span
                                                className="text-[9px] uppercase tracking-widest font-bold text-zinc-400 border border-white/15 bg-white/5 px-1.5 py-0.5"
                                                data-testid={`row-disabled-badge-${rn}`}
                                            >
                                                Not Planned
                                            </span>
                                        )}
                                    </div>
                                </th>
                                {colKeys.map((k) => {
                                    if (rowDisabled) {
                                        return (
                                            <td
                                                key={k}
                                                className="grid-cell px-3 py-2 align-top bg-[#0a0a0a]/50"
                                                data-testid={`cell-${rn}-${k}-not-planned`}
                                            >
                                                <span className="text-zinc-500 text-xs italic">not planned today</span>
                                            </td>
                                        );
                                    }
                                    const items = matrix[rn + "||" + k];
                                    if (!items || items.length === 0) {
                                        return (
                                            <td
                                                key={k}
                                                className="grid-cell px-3 py-2 align-top bg-[#0a0a0a]"
                                                data-testid={`cell-${rn}-${k}-empty`}
                                            >
                                                <span className="text-zinc-700 text-xs">—</span>
                                            </td>
                                        );
                                    }
                                    const totalReq = items.reduce((s, a) => s + a.required, 0);
                                    // Dedupe person IDs across sub-details (safety — should already be unique per invariant)
                                    const seenPid = new Set();
                                    const allIds = [];
                                    const allNames = [];
                                    items.forEach((a) => {
                                        a.assigned_person_ids.forEach((pid, i) => {
                                            if (seenPid.has(pid)) return;
                                            seenPid.add(pid);
                                            allIds.push(pid);
                                            allNames.push(a.assigned_person_names[i]);
                                        });
                                    });
                                    const totalShort = items.reduce((s, a) => s + a.shortage, 0);
                                    const shortage = totalShort > 0;
                                    const openCellEdit = () => openEdit(items.length === 1 ? items[0] : items);
                                    // Filter dimming
                                    const cellDetailMatch = items.some((a) => isDetailMatch(a.detail));
                                    const cellColMatch = isColMatch(k);
                                    const cellHasMatchedPerson = allIds.some((id) => matchedIds && matchedIds.has(id));
                                    const cellDim = filterActive && (
                                        !cellColMatch ||
                                        !cellDetailMatch ||
                                        (filters.q.trim() && !cellHasMatchedPerson)
                                    );
                                    return (
                                        <td
                                            key={k}
                                            className={`grid-cell px-3 py-2 align-top group cursor-pointer transition-opacity ${
                                                shortage ? "grid-cell-shortage" : "bg-[#0a0a0a]"
                                            } ${cellDim ? "opacity-25" : ""}`}
                                            data-testid={`cell-${rn}-${k}`}
                                            onClick={openCellEdit}
                                        >
                                            <div className="flex flex-col gap-1">
                                                {allNames.length === 0 && (
                                                    <span className="text-zinc-600 text-xs italic">unassigned</span>
                                                )}
                                                {allNames.map((n, i) => {
                                                    const isMatch = matchedIds && matchedIds.has(allIds[i]);
                                                    return (
                                                    <div key={i} className="text-sm font-semibold text-white leading-tight flex items-center justify-between group/name">
                                                        <span
                                                            className={
                                                                filterActive && isMatch
                                                                    ? "bg-yellow-400/25 ring-1 ring-yellow-400 px-1 -mx-1"
                                                                    : (filterActive && !isMatch ? "opacity-40" : "")
                                                            }
                                                            data-testid={`associate-name-${allIds[i]}${filterActive && isMatch ? "-match" : ""}`}
                                                        >
                                                            {n}
                                                        </span>
                                                        <button
                                                            type="button"
                                                            onClick={(e) => { e.stopPropagation(); handleQuickAbsent(allIds[i], n); }}
                                                            title="Mark absent from today"
                                                            className="ml-2 opacity-0 group-hover/name:opacity-100 text-red-400 hover:text-red-300 no-print"
                                                            data-testid={`quick-absent-${allIds[i]}`}
                                                        >
                                                            <UserX className="w-3 h-3" />
                                                        </button>
                                                    </div>
                                                );})}
                                                {shortage && (
                                                    <span className="mt-1 inline-flex items-center gap-1 text-red-400 text-[10px] uppercase tracking-widest font-bold animate-pulse">
                                                        <AlertCircle className="w-3 h-3" /> Short by {totalShort}
                                                    </span>
                                                )}
                                                <div className="flex items-center justify-between mt-0.5">
                                                    <span className="text-[10px] text-zinc-500 font-mono-ibm">
                                                        {allIds.length}/{totalReq}
                                                        {items.length > 1 && (
                                                            <span className="ml-1 text-zinc-600">
                                                                · {items.length} tasks
                                                            </span>
                                                        )}
                                                    </span>
                                                    <Pencil className="w-3 h-3 text-zinc-600 opacity-0 group-hover:opacity-100 no-print" />
                                                </div>
                                            </div>
                                        </td>
                                    );
                                })}
                                {rIdx === 0 && (
                                    <td
                                        rowSpan={rowNames.length}
                                        className="grid-cell px-3 py-2 align-top bg-[#0a0a0a] w-[260px]"
                                        data-testid="support-cell"
                                    >
                                        <div className="flex flex-col divide-y divide-white/10">
                                            {supportItems.map((s) => (
                                                <SupportBlock
                                                    key={s.line}
                                                    item={s}
                                                    onEdit={(a) => openEdit(a)}
                                                    onQuickAbsent={handleQuickAbsent}
                                                    filterActive={filterActive}
                                                    matchedIds={matchedIds}
                                                    isColMatch={isColMatch}
                                                    isDetailMatch={isDetailMatch}
                                                    nameQuery={filters.q}
                                                />
                                            ))}
                                        </div>
                                    </td>
                                )}
                            </tr>
                        );})}
                        {/* Absent row */}
                        <tr>
                            <th
                                className="sticky left-0 bg-red-950/40 z-10 grid-cell px-4 py-3 text-left text-sm font-bold text-red-300 uppercase tracking-widest"
                                data-testid="absent-row-label"
                            >
                                <div className="flex items-center gap-2">
                                    <UserX className="w-4 h-4" /> Absent
                                </div>
                            </th>
                            <td
                                colSpan={colKeys.length + 1}
                                className="grid-cell px-3 py-3 bg-red-950/20"
                                data-testid="absent-row-cell"
                            >
                                {absentPersons.length === 0 ? (
                                    <span className="text-zinc-500 text-sm italic">
                                        Full attendance today
                                    </span>
                                ) : (
                                    <div className="flex flex-wrap gap-1.5">
                                        {absentPersons.map((p) => {
                                            const isMatch = matchedIds && matchedIds.has(p.id);
                                            const dim = filterActive && !isMatch;
                                            return (
                                            <span
                                                key={p.id}
                                                data-testid={`absent-chip-${p.id}${filterActive && isMatch ? "-match" : ""}`}
                                                className={`inline-flex items-center gap-1 border text-xs px-2 py-1 font-medium transition-opacity ${
                                                    filterActive && isMatch
                                                        ? "border-yellow-400 bg-yellow-400/20 text-yellow-100 ring-1 ring-yellow-400"
                                                        : "border-red-500/40 bg-red-500/10 text-red-200"
                                                } ${dim ? "opacity-25" : ""}`}
                                            >
                                                {p.name} {p.surname}
                                                <button
                                                    type="button"
                                                    onClick={() => openLateArrival(p)}
                                                    title="Mark arrived late & assign"
                                                    data-testid={`late-arrival-${p.id}`}
                                                    className="ml-1 text-emerald-400 hover:text-emerald-300 border-l border-red-500/30 pl-1.5"
                                                >
                                                    <UserCheck className="w-3 h-3" />
                                                </button>
                                            </span>
                                        );})}
                                    </div>
                                )}
                            </td>
                        </tr>
                        {/* Unassigned pool row */}
                        <tr>
                            <th
                                className="sticky left-0 bg-amber-950/40 z-10 grid-cell px-4 py-3 text-left text-sm font-bold text-amber-300 uppercase tracking-widest"
                                data-testid="unassigned-row-label"
                            >
                                <div className="flex flex-col">
                                    <div className="flex items-center gap-2">
                                        <UserPlus className="w-4 h-4" /> Unassigned
                                    </div>
                                    <div className="text-[9px] font-normal normal-case text-amber-400/70 tracking-normal mt-1">
                                        Free pool · click any cell to add
                                    </div>
                                    {unassignedPersons.length > 0 && (
                                        <button
                                            onClick={loadSuggestions}
                                            data-testid="suggest-lines-btn"
                                            className="mt-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-amber-200 hover:text-white border border-amber-500/40 hover:border-amber-500 px-2 py-1 bg-amber-500/10 hover:bg-amber-500/20 font-bold no-print w-fit"
                                        >
                                            <Lightbulb className="w-3 h-3" />
                                            What else can we run?
                                        </button>
                                    )}
                                    {unassignedPersons.length > 0 && (
                                        <button
                                            onClick={openLineSuggest}
                                            data-testid="suggest-start-line-btn"
                                            className="mt-1 inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-emerald-200 hover:text-white border border-emerald-500/40 hover:border-emerald-500 px-2 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 font-bold no-print w-fit"
                                        >
                                            <Play className="w-3 h-3" />
                                            Suggest best line to run
                                        </button>
                                    )}
                                </div>
                            </th>
                            <td
                                colSpan={colKeys.length + 1}
                                className="grid-cell px-3 py-3 bg-amber-950/20"
                                data-testid="unassigned-row-cell"
                            >
                                {unassignedPersons.length === 0 ? (
                                    <span className="text-zinc-500 text-sm italic">
                                        Everyone is allocated
                                    </span>
                                ) : (
                                    <div className="flex flex-wrap gap-1.5">
                                        {unassignedPersons.map((p) => {
                                            const isMatch = matchedIds && matchedIds.has(p.id);
                                            const dim = filterActive && !isMatch;
                                            return (
                                            <span
                                                key={p.id}
                                                data-testid={`unassigned-chip-${p.id}${filterActive && isMatch ? "-match" : ""}`}
                                                className={`inline-flex items-center border text-xs px-2 py-1 font-medium transition-opacity ${
                                                    filterActive && isMatch
                                                        ? "border-yellow-400 bg-yellow-400/20 text-yellow-100 ring-1 ring-yellow-400"
                                                        : "border-amber-500/40 bg-amber-500/10 text-amber-200"
                                                } ${dim ? "opacity-25" : ""}`}
                                                title={`${Object.values(p.skills || {}).filter(Boolean).length} skills`}
                                            >
                                                {p.name} {p.surname}
                                            </span>
                                        );})}
                                    </div>
                                )}
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            {/* Matrix — mobile card view */}
            <div className="md:hidden space-y-3" data-testid="schedule-mobile">
                {colKeys.map((k) => {
                    const cellsInCol = rowNames
                        .map((rn) => {
                            const items = matrix[rn + "||" + k];
                            if (!items || items.length === 0) return null;
                            const ids = [];
                            const names = [];
                            const seen = new Set();
                            items.forEach((a) => {
                                a.assigned_person_ids.forEach((pid, i) => {
                                    if (seen.has(pid)) return;
                                    seen.add(pid);
                                    ids.push(pid);
                                    names.push(a.assigned_person_names[i]);
                                });
                            });
                            const required = items.reduce((s, a) => s + a.required, 0);
                            const shortage = items.reduce((s, a) => s + a.shortage, 0);
                            const detailMatch = items.some((a) => isDetailMatch(a.detail));
                            return { rn, items, ids, names, required, shortage, detailMatch };
                        })
                        .filter(Boolean);
                    const colMatch = isColMatch(k);
                    if (filterActive && !colMatch) return null;
                    const colShortage = cellsInCol.reduce((s, c) => s + c.shortage, 0);
                    const colAssigned = cellsInCol.reduce((s, c) => s + c.ids.length, 0);
                    const colRequired = cellsInCol.reduce((s, c) => s + c.required, 0);
                    return (
                        <div key={k} className={`border border-white/10 bg-[#0a0a0a] ${closedKeys.has(k) ? "opacity-60" : ""}`} data-testid={`mobile-line-${k}`}>
                            <div className="px-3 py-2 bg-[#111] border-b border-white/10 flex items-center justify-between gap-2">
                                <div className="font-chivo font-bold uppercase tracking-tight text-lg flex items-center gap-2">
                                    <span>{k}</span>
                                    {closedKeys.has(k) && (
                                        <span
                                            className="text-[9px] uppercase tracking-widest font-bold text-red-300 bg-red-500/15 border border-red-500/40 px-1.5 py-0.5"
                                            data-testid={`mobile-col-closed-${k}`}
                                        >
                                            Closed
                                        </span>
                                    )}
                                </div>
                                <div className="text-[10px] uppercase tracking-widest text-zinc-400 flex items-center gap-2">
                                    <span>{colAssigned}/{colRequired}</span>
                                    {colShortage > 0 && (
                                        <span className="text-red-400 border border-red-500/50 bg-red-500/10 px-1.5 py-0.5">
                                            −{colShortage}
                                        </span>
                                    )}
                                    {!closedKeys.has(k) && (
                                        <button
                                            type="button"
                                            onClick={() => handleCloseLine(k)}
                                            title={`Close ${k}`}
                                            aria-label={`Close ${k}`}
                                            data-testid={`mobile-close-line-${k}`}
                                            className="text-red-400 border border-red-500/40 bg-red-500/5 p-1"
                                        >
                                            <PowerOff className="w-3 h-3" />
                                        </button>
                                    )}
                                </div>
                            </div>
                            <div className="divide-y divide-white/5">
                                {cellsInCol.map(({ rn, items, ids, names, required, shortage, detailMatch }) => {
                                    const hasMatchedPerson = ids.some((id) => matchedIds && matchedIds.has(id));
                                    const cellDim = filterActive && (!detailMatch || (filters.q.trim() && !hasMatchedPerson));
                                    const rowDisabled = disabledRows.has(rn);
                                    if (rowDisabled) {
                                        return (
                                            <div
                                                key={rn}
                                                className="w-full px-3 py-2 text-left opacity-60"
                                                data-testid={`mobile-cell-${rn}-${k}-not-planned`}
                                            >
                                                <div className="text-[10px] uppercase tracking-widest text-zinc-500 flex items-center gap-2">
                                                    {rn}
                                                    <span className="text-[9px] font-bold text-zinc-400 border border-white/15 bg-white/5 px-1 py-0.5">
                                                        Not Planned
                                                    </span>
                                                </div>
                                                <div className="text-xs italic text-zinc-600 mt-0.5">not planned today</div>
                                            </div>
                                        );
                                    }
                                    return (
                                        <div
                                            key={rn}
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => openEdit(items.length === 1 ? items[0] : items)}
                                            className={`w-full text-left px-3 py-2.5 flex items-start justify-between gap-2 active:bg-white/5 cursor-pointer ${
                                                shortage > 0 ? "bg-red-950/25" : ""
                                            } ${cellDim ? "opacity-25" : ""}`}
                                            data-testid={`mobile-cell-${rn}-${k}`}
                                        >
                                            <div className="flex-1 min-w-0">
                                                <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-0.5">{rn}</div>
                                                {names.length === 0 ? (
                                                    <div className="text-sm italic text-zinc-600">unassigned</div>
                                                ) : (
                                                    <div className="flex flex-col gap-1">
                                                        {names.map((n, i) => {
                                                            const isMatch = matchedIds && matchedIds.has(ids[i]);
                                                            return (
                                                                <div key={i} className="flex items-center justify-between gap-2">
                                                                    <span
                                                                        className={`text-sm font-semibold ${
                                                                            filterActive && isMatch
                                                                                ? "bg-yellow-400/25 ring-1 ring-yellow-400 px-1"
                                                                                : (filterActive && !isMatch ? "text-white/40" : "text-white")
                                                                        }`}
                                                                    >
                                                                        {n}
                                                                    </span>
                                                                    <button
                                                                        type="button"
                                                                        onClick={(e) => { e.stopPropagation(); handleQuickAbsent(ids[i], n); }}
                                                                        title="Mark absent"
                                                                        aria-label={`Mark ${n} absent`}
                                                                        data-testid={`mobile-quick-absent-${ids[i]}`}
                                                                        className="shrink-0 p-1.5 text-red-400 active:bg-red-500/20 border border-red-500/40 bg-red-500/5"
                                                                    >
                                                                        <UserX className="w-3.5 h-3.5" />
                                                                    </button>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                                {shortage > 0 && (
                                                    <div className="mt-1 text-[10px] uppercase tracking-widest text-red-400 font-bold flex items-center gap-1">
                                                        <AlertCircle className="w-3 h-3" /> Short by {shortage}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex flex-col items-end gap-1 shrink-0">
                                                <span className="text-[10px] font-mono-ibm text-zinc-500">{ids.length}/{required}</span>
                                                <span
                                                    aria-label="Edit cell"
                                                    data-testid={`mobile-cell-edit-${rn}-${k}`}
                                                    className="inline-flex items-center justify-center border border-white/20 bg-white/5 text-zinc-200 p-1.5"
                                                >
                                                    <Pencil className="w-3.5 h-3.5" />
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                                {cellsInCol.length === 0 && (
                                    <div className="px-3 py-3 text-xs italic text-zinc-600">No details for this line</div>
                                )}
                            </div>
                        </div>
                    );
                })}

                {/* Support Ops on mobile */}
                {supportItems.some((s) => s.planned) && (
                    <div className="border border-white/10 bg-[#0a0a0a]" data-testid="mobile-support-block">
                        <div className="px-3 py-2 bg-[#111] border-b border-white/10 font-chivo font-bold uppercase tracking-tight text-lg">
                            Support Ops
                        </div>
                        <div className="p-2 space-y-2">
                            {supportItems.filter((s) => s.planned).map((s) => (
                                <div key={s.line}>
                                    <div className="text-[11px] font-chivo font-bold uppercase tracking-widest text-[#3B6AB8] mb-1">{s.line}</div>
                                    <div className="space-y-1">
                                        {s.assignments.map((a) => {
                                            const hasMatchedPerson = (a.assigned_person_ids || []).some((id) => matchedIds && matchedIds.has(id));
                                            const detailMatch = isDetailMatch(a.detail);
                                            const dim = filterActive && (!detailMatch || (filters.q.trim() && !hasMatchedPerson));
                                            return (
                                                <div
                                                    key={a.row_name + "||" + a.detail}
                                                    role="button"
                                                    tabIndex={0}
                                                    onClick={() => openEdit(a)}
                                                    className={`w-full text-left px-2 py-1.5 border cursor-pointer flex items-start justify-between gap-2 ${a.shortage > 0 ? "border-red-500 bg-red-950/25" : "border-white/5"} active:bg-white/5 ${dim ? "opacity-25" : ""}`}
                                                    data-testid={`mobile-support-cell-${a.line}-${a.row_name}`}
                                                >
                                                    <div className="flex-1 min-w-0">
                                                        <div className="text-[10px] uppercase tracking-widest text-zinc-500">{a.row_name}</div>
                                                        {a.assigned_person_names.length === 0 ? (
                                                            <div className="text-sm italic text-zinc-600">unassigned</div>
                                                        ) : (
                                                            <div className="flex flex-col gap-1">
                                                                {a.assigned_person_names.map((n, i) => {
                                                                    const pid = a.assigned_person_ids[i];
                                                                    const isMatch = matchedIds && matchedIds.has(pid);
                                                                    return (
                                                                        <div key={i} className="flex items-center justify-between gap-2">
                                                                            <span className={`text-sm font-semibold ${
                                                                                filterActive && isMatch
                                                                                    ? "bg-yellow-400/25 ring-1 ring-yellow-400 px-1"
                                                                                    : (filterActive && !isMatch ? "text-white/40" : "text-white")
                                                                            }`}>{n}</span>
                                                                            <button
                                                                                type="button"
                                                                                onClick={(e) => { e.stopPropagation(); handleQuickAbsent(pid, n); }}
                                                                                title="Mark absent"
                                                                                aria-label={`Mark ${n} absent`}
                                                                                data-testid={`mobile-support-quick-absent-${pid}`}
                                                                                className="shrink-0 p-1.5 text-red-400 active:bg-red-500/20 border border-red-500/40 bg-red-500/5"
                                                                            >
                                                                                <UserX className="w-3.5 h-3.5" />
                                                                            </button>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        )}
                                                        {a.shortage > 0 && (
                                                            <div className="text-[10px] uppercase tracking-widest text-red-400 font-bold mt-0.5">Short by {a.shortage}</div>
                                                        )}
                                                    </div>
                                                    <span
                                                        aria-label="Edit cell"
                                                        data-testid={`mobile-support-cell-edit-${a.line}-${a.row_name}`}
                                                        className="shrink-0 inline-flex items-center justify-center border border-white/20 bg-white/5 text-zinc-200 p-1.5"
                                                    >
                                                        <Pencil className="w-3.5 h-3.5" />
                                                    </span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Absent on mobile */}
                <div className="border border-red-500/40 bg-red-950/20" data-testid="mobile-absent-block">
                    <div className="px-3 py-2 bg-red-950/40 border-b border-red-500/30 flex items-center gap-2 text-red-200 uppercase tracking-widest text-xs font-bold">
                        <UserX className="w-4 h-4" /> Absent · {absentPersons.length}
                    </div>
                    <div className="p-2">
                        {absentPersons.length === 0 ? (
                            <div className="text-xs italic text-zinc-500">Full attendance today</div>
                        ) : (
                            <div className="flex flex-wrap gap-1.5">
                                {absentPersons.map((p) => {
                                    const isMatch = matchedIds && matchedIds.has(p.id);
                                    const dim = filterActive && !isMatch;
                                    return (
                                        <span
                                            key={p.id}
                                            className={`inline-flex items-center gap-1 border text-xs px-2 py-1 ${
                                                filterActive && isMatch
                                                    ? "border-yellow-400 bg-yellow-400/20 text-yellow-100"
                                                    : "border-red-500/40 bg-red-500/10 text-red-200"
                                            } ${dim ? "opacity-25" : ""}`}
                                        >
                                            {p.name} {p.surname}
                                            <button
                                                type="button"
                                                onClick={() => openLateArrival(p)}
                                                title="Arrived late"
                                                data-testid={`mobile-late-arrival-${p.id}`}
                                                className="ml-1 text-emerald-400 border-l border-red-500/30 pl-1.5"
                                            >
                                                <UserCheck className="w-3 h-3" />
                                            </button>
                                        </span>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>

                {/* Unassigned on mobile */}
                <div className="border border-amber-500/40 bg-amber-950/20" data-testid="mobile-unassigned-block">
                    <div className="px-3 py-2 bg-amber-950/40 border-b border-amber-500/30 flex items-center gap-2 text-amber-200 uppercase tracking-widest text-xs font-bold">
                        <UserPlus className="w-4 h-4" /> Unassigned · {unassignedPersons.length}
                    </div>
                    <div className="p-2">
                        {unassignedPersons.length === 0 ? (
                            <div className="text-xs italic text-zinc-500">Everyone allocated</div>
                        ) : (
                            <>
                                <button
                                    onClick={openLineSuggest}
                                    data-testid="mobile-suggest-start-line-btn"
                                    className="mb-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-emerald-200 border border-emerald-500/40 px-2 py-1 bg-emerald-500/10 font-bold"
                                >
                                    <Play className="w-3 h-3" /> Suggest best line to run
                                </button>
                                <div className="flex flex-wrap gap-1.5">
                                    {unassignedPersons.map((p) => {
                                        const isMatch = matchedIds && matchedIds.has(p.id);
                                        const dim = filterActive && !isMatch;
                                        return (
                                            <span
                                                key={p.id}
                                                className={`inline-flex items-center border text-xs px-2 py-1 ${
                                                    filterActive && isMatch
                                                        ? "border-yellow-400 bg-yellow-400/20 text-yellow-100"
                                                        : "border-amber-500/40 bg-amber-500/10 text-amber-200"
                                                } ${dim ? "opacity-25" : ""}`}
                                            >
                                                {p.name} {p.surname}
                                            </span>
                                        );
                                    })}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Suggestions Dialog */}
            <Dialog open={suggestOpen} onOpenChange={setSuggestOpen}>
                <DialogContent
                    className="rounded-none bg-[#111] border-white/15 text-white max-w-2xl"
                    data-testid="suggestions-dialog"
                >
                    <DialogHeader>
                        <DialogTitle className="font-chivo uppercase tracking-tight flex items-center gap-2">
                            <Lightbulb className="w-5 h-5 text-amber-400" />
                            Lines you could also run
                        </DialogTitle>
                        <DialogDescription className="text-xs text-zinc-500">
                            {suggestions?.free_pool_size || 0} free people available · sorted by coverage
                        </DialogDescription>
                    </DialogHeader>
                    <div className="max-h-96 overflow-y-auto -mx-6 px-6">
                        {(!suggestions || suggestions.suggestions.length === 0) && (
                            <div className="p-8 text-center text-zinc-500 text-sm">
                                All lines are already running today.
                            </div>
                        )}
                        {suggestions?.suggestions.map((s) => (
                            <SuggestionRow key={s.line} s={s} onAdd={() => addLineToSchedule(s.line)} />
                        ))}
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setSuggestOpen(false)}
                            data-testid="suggest-close-btn"
                            className="rounded-none border-white/15 text-white bg-transparent hover:bg-white/10 uppercase text-xs tracking-widest"
                        >
                            Close
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Late Arrival dialog */}
            <Dialog open={!!lateArr} onOpenChange={(o) => !o && setLateArr(null)}>
                <DialogContent
                    className="rounded-none bg-[#111] border-emerald-500/30 text-white max-w-2xl"
                    data-testid="late-arrival-dialog"
                >
                    <DialogHeader>
                        <DialogTitle className="font-chivo uppercase tracking-tight flex items-center gap-2">
                            <UserCheck className="w-5 h-5 text-emerald-400" />
                            {lateArr?.person?.name} {lateArr?.person?.surname || ""} · Arrived Late
                        </DialogTitle>
                        <DialogDescription className="text-xs text-zinc-500">
                            Best-fit highlighted first. Planned tasks show current status; not-planned tasks will be added to today's schedule if selected.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="max-h-[420px] overflow-y-auto -mx-6 px-6 space-y-1.5">
                        {lateArr?.best_fit && (
                            <div
                                data-testid="late-arrival-best"
                                className="border-2 border-emerald-500 bg-emerald-500/10 p-3 mb-2 flex items-center justify-between"
                            >
                                <div>
                                    <div className="text-[10px] uppercase tracking-widest text-emerald-300">Best Fit</div>
                                    <div className="font-chivo uppercase font-bold text-sm">{lateArr.best_fit.line} · {lateArr.best_fit.row_name}</div>
                                    <div className="text-[11px] text-zinc-400">{lateArr.best_fit.detail} · {lateArr.best_fit.shortage > 0 ? `short by ${lateArr.best_fit.shortage}` : `${lateArr.best_fit.assigned_count}/${lateArr.best_fit.required}`}</div>
                                </div>
                                <Button
                                    onClick={() => assignLateArrival(lateArr.best_fit)}
                                    data-testid="late-arrival-approve"
                                    className="rounded-none bg-emerald-500 hover:bg-emerald-500/85 text-black uppercase tracking-widest text-xs font-bold"
                                >
                                    Approve
                                </Button>
                            </div>
                        )}
                        {lateArr?.planned?.slice(1).map((o) => (
                            <OptionRow key={o.line + "||" + o.detail} opt={o} onPick={assignLateArrival} testid={`late-planned-${o.line}-${o.detail}`} />
                        ))}
                        {lateArr?.not_planned?.length > 0 && (
                            <div className="text-[10px] uppercase tracking-widest text-zinc-500 pt-2 border-t border-white/10">
                                Not planned for today
                            </div>
                        )}
                        {lateArr?.not_planned?.map((o) => (
                            <OptionRow key={"np-" + o.line + "||" + o.detail} opt={o} onPick={assignLateArrival} notPlanned testid={`late-notplanned-${o.line}-${o.detail}`} />
                        ))}
                        {lateArr && lateArr.planned.length === 0 && lateArr.not_planned.length === 0 && (
                            <div className="text-center text-zinc-500 py-6 text-sm">No skill-matching tasks available today.</div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setLateArr(null)} data-testid="late-arrival-cancel" className="rounded-none border-white/15 text-white bg-transparent hover:bg-white/10 uppercase text-xs tracking-widest">
                            Cancel
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Displaced conflict dialog */}
            <Dialog open={!!displaceConflict} onOpenChange={(o) => !o && setDisplaceConflict(null)}>
                <DialogContent className="rounded-none bg-[#111] border-red-500/40 text-white max-w-2xl" data-testid="conflict-dialog">
                    <DialogHeader>
                        <DialogTitle className="font-chivo uppercase tracking-tight flex items-center gap-2 text-red-300">
                            <AlertCircle className="w-5 h-5" /> Conflict — {displaceConflict?.displaced?.name} Needs A New Spot
                        </DialogTitle>
                        <DialogDescription className="text-xs text-zinc-400">
                            No auto-match found. Pick a task below to reassign, or Undo to revert.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="max-h-[380px] overflow-y-auto -mx-6 px-6 space-y-1.5">
                        {displaceConflict?.displaced?.options?.length === 0 && (
                            <div className="text-center text-zinc-500 py-6 text-sm">No skill-matching tasks left. Consider Undo.</div>
                        )}
                        {displaceConflict?.displaced?.options?.map((o) => (
                            <OptionRow key={"c-" + o.line + "||" + o.detail} opt={o} onPick={resolveDisplaced} testid={`conflict-opt-${o.line}-${o.detail}`} />
                        ))}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => { setDisplaceConflict(null); doUndo(); }} data-testid="conflict-undo" className="rounded-none border-white/15 text-white bg-transparent hover:bg-white/10 uppercase text-xs tracking-widest">
                            <Undo2 className="w-4 h-4 mr-2" /> Undo Late Arrival
                        </Button>
                        <Button variant="outline" onClick={() => setDisplaceConflict(null)} data-testid="conflict-close" className="rounded-none border-white/15 text-white bg-transparent hover:bg-white/10 uppercase text-xs tracking-widest">
                            Close
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Edit Dialog */}
            <Dialog open={!!editCell} onOpenChange={(o) => !o && closeEdit()}>
                <DialogContent
                    className="rounded-none bg-[#111] border-white/15 text-white max-w-lg"
                    data-testid="edit-cell-dialog"
                >
                    <DialogHeader>
                        <DialogTitle className="font-chivo uppercase tracking-tight">
                            Adjust · {editCell?.current?.row_name} × {editCell?.current?.line_key}
                        </DialogTitle>
                        <DialogDescription className="text-xs text-zinc-500">
                            Skill required: <span className="text-zinc-300">{editCell?.current?.detail}</span> ·{" "}
                            Required: {editCell?.current?.required}
                        </DialogDescription>
                    </DialogHeader>
                    {editCell?.multi && editCell.items.length > 1 && (
                        <div className="flex flex-wrap gap-1.5 mb-2 border-b border-white/10 pb-3">
                            <span className="text-[10px] uppercase tracking-widest text-zinc-500 mr-1 self-center">
                                Sub-task:
                            </span>
                            {editCell.items.map((it) => (
                                <button
                                    key={it.detail}
                                    onClick={() => switchSubDetail(it)}
                                    data-testid={`sub-task-tab-${it.detail}`}
                                    className={`text-[10px] uppercase tracking-widest px-2 py-1 border ${
                                        editCell.current?.detail === it.detail
                                            ? "border-[#3B6AB8] bg-[#3B6AB8]/20 text-white"
                                            : "border-white/10 text-zinc-400 hover:bg-white/5"
                                    }`}
                                >
                                    {it.detail} <span className="text-zinc-500 ml-1">{it.assigned_person_ids.length}/{it.required}</span>
                                </button>
                            ))}
                        </div>
                    )}
                    {editCell?.current && (
                        <PersonPicker
                            key={editCell.current.detail}
                            detail={editCell.current.detail}
                            required={editCell.current.required}
                            initialIds={editCell.current.assigned_person_ids}
                            persons={persons}
                            personLocations={personLocations}
                            currentCellKey={`${editCell.current.row_name}||${editCell.current.line_key}||${editCell.current.detail}`}
                            date={date}
                            shift={shift}
                            absentIds={new Set(schedule.absent_person_ids || [])}
                            onSave={savePicks}
                            onClear={clearCell}
                            onCancel={closeEdit}
                        />
                    )}
                </DialogContent>
            </Dialog>

            {/* Suggest-a-Line Dialog (start a line using unassigned pool) */}
            <Dialog open={!!lineSuggest} onOpenChange={(o) => !o && !startingLine && setLineSuggest(null)}>
                <DialogContent className="rounded-none border-zinc-800 bg-[#0f0f0f] text-zinc-100 max-w-xl max-h-[85vh] overflow-hidden flex flex-col" data-testid="suggest-start-line-dialog">
                    <DialogHeader>
                        <DialogTitle className="font-chivo uppercase tracking-tight text-2xl">
                            Suggest a Line to Start
                        </DialogTitle>
                        <DialogDescription className="text-zinc-400">
                            {lineSuggest?.unassigned_pool_size ?? 0} associates are unassigned. Ranked by how many of them fit each line's skill needs.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="overflow-y-auto flex-1 divide-y divide-white/5 border border-zinc-800">
                        {(lineSuggest?.suggestions || []).map((s, i) => {
                            const isBest = i === 0;
                            return (
                                <div key={s.line} className="px-4 py-3 flex items-center justify-between gap-3" data-testid={`suggest-line-row-${s.line}`}>
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="font-chivo font-bold uppercase tracking-tight">{s.line}</span>
                                            {isBest && (
                                                <span className="text-[9px] uppercase tracking-widest text-black bg-emerald-400 px-1.5 py-0.5 font-bold">Best Fit</span>
                                            )}
                                        </div>
                                        <div className="text-xs text-zinc-500 mt-0.5">
                                            {s.assignable_count}/{s.required} associates match · {s.coverage_pct}% coverage
                                        </div>
                                        <div className="h-1.5 bg-white/5 mt-1 w-40">
                                            <div className="h-full bg-emerald-500/70" style={{ width: `${s.coverage_pct}%` }} />
                                        </div>
                                    </div>
                                    <Button
                                        onClick={() => handleStartLine(s.line)}
                                        disabled={!!startingLine || s.assignable_count === 0}
                                        data-testid={`start-line-btn-${s.line}`}
                                        className="rounded-none bg-emerald-500 hover:bg-emerald-500/85 text-black uppercase tracking-widest text-[10px] font-bold px-3 py-2"
                                    >
                                        <Play className="w-3 h-3 mr-1" />
                                        {startingLine === s.line ? "Starting…" : "Start"}
                                    </Button>
                                </div>
                            );
                        })}
                    </div>
                    <DialogFooter className="mt-3">
                        <Button
                            variant="outline"
                            className="rounded-none border-zinc-700 text-zinc-300 hover:bg-zinc-900 uppercase tracking-widest text-xs"
                            disabled={!!startingLine}
                            onClick={() => setLineSuggest(null)}
                            data-testid="suggest-start-line-cancel"
                        >
                            Close
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Fill Shortages Preview Dialog */}
            <Dialog open={!!fillPreview} onOpenChange={(o) => !o && !fillApplying && setFillPreview(null)}>
                <DialogContent className="rounded-none border-zinc-800 bg-[#0f0f0f] text-zinc-100 max-w-3xl max-h-[85vh] overflow-hidden flex flex-col" data-testid="fill-preview-dialog">
                    <DialogHeader>
                        <DialogTitle className="font-chivo uppercase tracking-tight text-2xl">
                            Fill Shortages — Preview
                        </DialogTitle>
                        <DialogDescription className="text-zinc-400">
                            Review proposed changes before applying. Nothing on the board changes until you confirm.
                        </DialogDescription>
                    </DialogHeader>

                    {fillPreview && (
                        <>
                            <div className="grid grid-cols-3 gap-3 mb-3">
                                <div className="border border-zinc-800 px-4 py-3">
                                    <div className="text-[10px] uppercase tracking-widest text-zinc-500">Starting shortage</div>
                                    <div className="text-2xl font-bold" data-testid="fill-preview-initial">{fillPreview.initial_shortage}</div>
                                </div>
                                <div className="border border-emerald-800 bg-emerald-950/20 px-4 py-3">
                                    <div className="text-[10px] uppercase tracking-widest text-emerald-500">Will be filled</div>
                                    <div className="text-2xl font-bold text-emerald-400" data-testid="fill-preview-filled">{fillPreview.filled_count}</div>
                                </div>
                                <div className={`border px-4 py-3 ${fillPreview.remaining_shortage > 0 ? "border-red-800 bg-red-950/20" : "border-zinc-800"}`}>
                                    <div className="text-[10px] uppercase tracking-widest text-zinc-500">Still short</div>
                                    <div className={`text-2xl font-bold ${fillPreview.remaining_shortage > 0 ? "text-red-400" : ""}`} data-testid="fill-preview-remaining">{fillPreview.remaining_shortage}</div>
                                </div>
                            </div>

                            <div className="overflow-y-auto border border-zinc-800 flex-1" data-testid="fill-preview-changes">
                                <table className="w-full text-sm">
                                    <thead className="sticky top-0 bg-[#111] z-10">
                                        <tr>
                                            <th className="text-left px-3 py-2 text-[10px] uppercase tracking-widest text-zinc-400">Cell</th>
                                            <th className="text-left px-3 py-2 text-[10px] uppercase tracking-widest text-emerald-400">Assign</th>
                                            <th className="text-left px-3 py-2 text-[10px] uppercase tracking-widest text-orange-400">Displaced from cell</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {fillPreview.changes.map((c, idx) => (
                                            <tr key={idx} className="border-t border-zinc-800 align-top" data-testid={`fill-preview-row-${idx}`}>
                                                <td className="px-3 py-2">
                                                    <div className="font-bold uppercase tracking-wide text-xs text-zinc-200">{c.line_key}</div>
                                                    <div className="text-zinc-400 text-xs">{c.row_name} · {c.detail}</div>
                                                    {c.now_short && (
                                                        <div className="text-red-400 text-[10px] uppercase mt-1">Still short by {c.shortage_after}</div>
                                                    )}
                                                </td>
                                                <td className="px-3 py-2">
                                                    {c.added.length === 0 ? <span className="text-zinc-600">—</span> : (
                                                        <ul className="space-y-1">
                                                            {c.added.map((p) => (
                                                                <li key={p.id} className="text-emerald-300 text-xs">+ {p.name}</li>
                                                            ))}
                                                        </ul>
                                                    )}
                                                </td>
                                                <td className="px-3 py-2">
                                                    {c.removed.length === 0 ? <span className="text-zinc-600">—</span> : (
                                                        <ul className="space-y-1">
                                                            {c.removed.map((p) => (
                                                                <li key={p.id} className="text-orange-300 text-xs">− {p.name}</li>
                                                            ))}
                                                        </ul>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}

                    <DialogFooter className="mt-3">
                        <Button
                            variant="outline"
                            className="rounded-none border-zinc-700 text-zinc-300 hover:bg-zinc-900 uppercase tracking-widest text-xs"
                            disabled={fillApplying}
                            onClick={() => setFillPreview(null)}
                            data-testid="fill-preview-cancel"
                        >
                            Cancel
                        </Button>
                        <Button
                            className="rounded-none bg-emerald-500 hover:bg-emerald-500/85 text-black uppercase tracking-widest text-xs font-bold"
                            disabled={fillApplying || !fillPreview || fillPreview.filled_count === 0}
                            onClick={async () => {
                                setFillApplying(true);
                                try {
                                    const r = await fillShortages(date, shift);
                                    const filled = (fillPreview?.initial_shortage || 0) - (r.total_shortage || 0);
                                    if (filled > 0) toast.success(`Filled ${filled} of ${fillPreview.initial_shortage} shortages`);
                                    else toast.info("No shortages were filled");
                                    setFillPreview(null);
                                    load();
                                } catch (e) {
                                    toast.error(e.response?.data?.detail || e.message);
                                } finally {
                                    setFillApplying(false);
                                }
                            }}
                            data-testid="fill-preview-confirm"
                        >
                            <CheckCircle2 className="w-4 h-4 mr-2" /> {fillApplying ? "Applying…" : "Confirm & Apply"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function PersonPicker({
    detail, required, initialIds, persons, personLocations, currentCellKey,
    date, shift, absentIds, onSave, onClear, onCancel,
}) {
    const [picks, setPicks] = useState(new Set(initialIds));
    const [search, setSearch] = useState("");
    const [reqOverride, setReqOverride] = useState(required);
    const [suggestions, setSuggestions] = useState(null);

    const eligible = useMemo(() => {
        const q = search.trim().toLowerCase();
        return persons.filter((p) => {
            if (absentIds.has(p.id)) return false;
            if (!p.skills?.[detail]) return false;
            if (q && !`${p.name} ${p.surname}`.toLowerCase().includes(q)) return false;
            return true;
        });
    }, [persons, detail, absentIds, search]);

    const toggle = (id) => {
        const ns = new Set(picks);
        ns.has(id) ? ns.delete(id) : ns.add(id);
        setPicks(ns);
    };

    const runSuggest = async () => {
        try {
            const s = await suggestReplacement(date, currentCellKey, shift, 3);
            setSuggestions(s);
            // Auto-tick the top free candidates up to remaining need
            const need = Math.max(0, reqOverride - picks.size);
            if (need > 0 && s.free.length > 0) {
                const ns = new Set(picks);
                s.free.slice(0, need).forEach((c) => ns.add(c.id));
                setPicks(ns);
            }
        } catch (e) {
            /* silent */
        }
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2">
                <input
                    type="text"
                    placeholder="Search skilled staff…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    data-testid="edit-search"
                    className="flex-1 bg-[#0a0a0a] border border-white/10 px-3 py-2 text-sm outline-none focus:border-[#3B6AB8]"
                />
                <button
                    type="button"
                    onClick={runSuggest}
                    data-testid="edit-suggest-btn"
                    className="inline-flex items-center gap-1 border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-200 uppercase tracking-widest text-[10px] px-3 py-2 font-bold"
                >
                    <Wand2 className="w-3.5 h-3.5" /> Suggest
                </button>
            </div>
            {suggestions && (
                <div className="border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs">
                    <div className="text-[10px] uppercase tracking-widest text-emerald-300 mb-1">
                        Recommended · {suggestions.free.length} free, {suggestions.borrowable.length} borrowable
                    </div>
                    {suggestions.free.length === 0 && suggestions.borrowable.length === 0 && (
                        <div className="text-zinc-500 italic">No candidates — this skill needs training investment.</div>
                    )}
                    <div className="flex flex-wrap gap-1.5 mt-1">
                        {suggestions.free.map((c) => (
                            <button
                                key={c.id}
                                type="button"
                                onClick={() => toggle(c.id)}
                                data-testid={`suggest-free-${c.id}`}
                                className={`text-[11px] border px-2 py-0.5 ${
                                    picks.has(c.id)
                                        ? "border-emerald-400 bg-emerald-500/20 text-white"
                                        : "border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/10"
                                }`}
                                title={`${c.skills} skills · free`}
                            >
                                ✓ {c.name}
                            </button>
                        ))}
                        {suggestions.borrowable.map((c) => (
                            <button
                                key={c.id}
                                type="button"
                                onClick={() => toggle(c.id)}
                                data-testid={`suggest-borrow-${c.id}`}
                                className={`text-[11px] border px-2 py-0.5 ${
                                    picks.has(c.id)
                                        ? "border-amber-400 bg-amber-500/20 text-white"
                                        : "border-amber-500/40 text-amber-200 hover:bg-amber-500/10"
                                }`}
                                title={`Currently on ${c.current.line_key} · ${c.current.row_name}`}
                            >
                                ↺ {c.name}
                            </button>
                        ))}
                    </div>
                </div>
            )}
            <div className="text-[10px] uppercase tracking-widest text-zinc-500 flex items-center gap-3">
                <span>Picked {picks.size}</span>
                <span className="flex items-center gap-1">
                    · Required
                    <input
                        type="number"
                        min={0}
                        value={reqOverride}
                        onChange={(e) => setReqOverride(Math.max(0, Number(e.target.value)))}
                        data-testid="required-override-input"
                        className="w-14 ml-1 bg-[#0a0a0a] border border-white/10 px-1 py-0.5 text-white text-xs text-center rounded-none"
                    />
                </span>
                <span>· {eligible.length} eligible</span>
                {picks.size > reqOverride && (
                    <span className="text-emerald-400">
                        (+{picks.size - reqOverride} extra)
                    </span>
                )}
                {picks.size < reqOverride && (
                    <span className="text-amber-400">
                        (short by {reqOverride - picks.size})
                    </span>
                )}
            </div>
            <div className="max-h-72 overflow-y-auto border border-white/10">
                {eligible.length === 0 && (
                    <div className="p-6 text-center text-zinc-500 text-sm">
                        No skilled staff match the search.
                    </div>
                )}
                {eligible.map((p) => {
                    const checked = picks.has(p.id);
                    const locs = (personLocations[p.id] || []).filter(
                        (l) => `${l.row_name}||${l.line_key}` !== currentCellKey,
                    );
                    const busy = locs.length > 0;
                    const free = !busy;
                    return (
                        <label
                            key={p.id}
                            className={`flex items-center gap-3 px-3 py-2 border-b border-white/5 cursor-pointer ${
                                checked ? "bg-[#3B6AB8]/15"
                                    : busy ? "bg-amber-500/5"
                                    : "bg-emerald-500/5 hover:bg-emerald-500/10"
                            }`}
                            data-testid={`pick-row-${p.id}`}
                        >
                            <Checkbox
                                checked={checked}
                                onCheckedChange={() => toggle(p.id)}
                                data-testid={`pick-cb-${p.id}`}
                                className="border-white/20 data-[state=checked]:bg-[#3B6AB8] rounded-none mt-0.5"
                            />
                            <div className="flex-1 min-w-0">
                                <div className="text-sm flex items-center gap-2">
                                    {p.name} {p.surname}
                                    {free && (
                                        <span className="text-[9px] uppercase tracking-widest text-emerald-400 font-bold">
                                            free
                                        </span>
                                    )}
                                </div>
                                {busy && (
                                    <div className="text-[10px] text-amber-400 mt-0.5">
                                        Currently on:{" "}
                                        {locs.map((l, i) => (
                                            <span key={i}>
                                                <span className="font-semibold">{l.line_key}</span>
                                                <span className="text-amber-500/70"> · {l.row_name}</span>
                                                {i < locs.length - 1 ? ", " : ""}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <span
                                className="text-[10px] font-mono-ibm text-zinc-500 whitespace-nowrap"
                                title="Total skills this person has"
                            >
                                {Object.values(p.skills || {}).filter(Boolean).length} skills
                            </span>
                        </label>
                    );
                })}
            </div>
            <DialogFooter className="flex gap-2 flex-wrap">
                <Button
                    variant="outline"
                    onClick={onClear}
                    data-testid="edit-clear-btn"
                    className="rounded-none border-red-500/40 text-red-300 bg-transparent hover:bg-red-500/10 uppercase text-xs tracking-widest"
                >
                    <RotateCcw className="w-4 h-4 mr-2" /> Unassign
                </Button>
                <div className="flex-1" />
                <Button
                    variant="outline"
                    onClick={onCancel}
                    data-testid="edit-cancel-btn"
                    className="rounded-none border-white/15 text-white bg-transparent hover:bg-white/10 uppercase text-xs tracking-widest"
                >
                    Cancel
                </Button>
                <Button
                    onClick={() => onSave(Array.from(picks), reqOverride)}
                    data-testid="edit-save-btn"
                    className="rounded-none bg-[#3B6AB8] hover:bg-[#3B6AB8]/85 uppercase text-xs tracking-widest"
                >
                    Save
                </Button>
            </DialogFooter>
        </div>
    );
}

function OptionRow({ opt, onPick, notPlanned, testid }) {
    const short = opt.shortage > 0;
    return (
        <div
            className={`flex items-center justify-between border ${short ? "border-red-500/40 bg-red-500/5" : notPlanned ? "border-zinc-700 bg-zinc-500/5" : "border-white/10"} px-3 py-2`}
            data-testid={testid}
        >
            <div className="min-w-0">
                <div className="text-sm font-semibold">
                    {opt.line} <span className="text-zinc-500">· {opt.row_name}</span>
                </div>
                <div className="text-[11px] text-zinc-400 truncate">{opt.detail}</div>
                <div className="text-[10px] uppercase tracking-widest mt-0.5">
                    {short ? <span className="text-red-400">Short by {opt.shortage}</span> : (
                        <span className="text-zinc-500">{opt.assigned_count}/{opt.required}</span>
                    )}
                    {notPlanned && <span className="ml-2 text-amber-400">· Not planned for today</span>}
                </div>
            </div>
            <Button
                onClick={() => onPick(opt)}
                className="rounded-none bg-[#3B6AB8] hover:bg-[#3B6AB8]/85 uppercase text-xs tracking-widest"
                data-testid={`${testid}-btn`}
            >
                Assign
            </Button>
        </div>
    );
}

function SuggestionRow({ s, onAdd }) {
    const color =
        s.fully_covered ? "border-emerald-500 text-emerald-300"
        : s.coverage_pct >= 60 ? "border-amber-500 text-amber-300"
        : "border-red-500/50 text-red-300";
    const barColor =
        s.fully_covered ? "bg-emerald-500"
        : s.coverage_pct >= 60 ? "bg-amber-500"
        : "bg-red-500";
    return (
        <div
            className={`border ${color} border-l-4 bg-[#0a0a0a] px-4 py-3 mb-2`}
            data-testid={`suggestion-${s.line}`}
        >
            <div className="flex items-center justify-between gap-3 mb-2">
                <div>
                    <div className="font-chivo font-bold uppercase text-lg tracking-tight text-white">
                        {s.line}
                    </div>
                    <div className="text-[10px] uppercase tracking-widest text-zinc-500 mt-0.5">
                        {s.fillable}/{s.required} slots · {s.coverage_pct}%
                        {s.fully_covered && " · fully covered"}
                    </div>
                </div>
                <Button
                    onClick={onAdd}
                    disabled={s.fillable === 0}
                    data-testid={`suggestion-add-${s.line}`}
                    className={`rounded-none uppercase text-xs tracking-widest font-bold ${
                        s.fully_covered ? "bg-emerald-500 hover:bg-emerald-500/85 text-black"
                        : "bg-white/10 hover:bg-white/20 text-white"
                    }`}
                >
                    <Plus className="w-4 h-4 mr-1" /> Add
                </Button>
            </div>
            <div className="h-1.5 bg-white/5">
                <div
                    className={`h-full ${barColor}`}
                    style={{ width: `${Math.min(100, s.coverage_pct)}%` }}
                />
            </div>
            {!s.fully_covered && s.cells.filter((c) => c.shortage > 0).length > 0 && (
                <div className="mt-2 text-[10px] text-zinc-500">
                    Gap: {s.cells.filter((c) => c.shortage > 0).map((c) => (
                        `${c.row_name} (${c.shortage} short)`
                    )).join(" · ")}
                </div>
            )}
        </div>
    );
}

function SupportBlock({ item, onEdit, onQuickAbsent, filterActive, matchedIds, isColMatch, isDetailMatch, nameQuery }) {
    if (!item.planned) {
        return (
            <div
                className="py-2.5"
                data-testid={`support-line-${item.line}-not-planned`}
            >
                <div className="text-sm font-chivo uppercase font-bold tracking-tight text-zinc-500">
                    {item.line}
                </div>
                <div className="text-xs italic text-zinc-600 mt-1">
                    not planned today
                </div>
            </div>
        );
    }
    const lineColMatch = !isColMatch || isColMatch(item.line);
    return (
        <div className={`py-2.5 ${filterActive && !lineColMatch ? "opacity-25" : ""}`} data-testid={`support-line-${item.line}`}>
            <div className="text-sm font-chivo uppercase font-bold tracking-tight text-[#3B6AB8]">
                {item.line}
            </div>
            {item.assignments.map((a) => {
                const shortage = a.shortage > 0;
                const detailMatch = !isDetailMatch || isDetailMatch(a.detail);
                const hasMatchedPerson = a.assigned_person_ids.some((id) => matchedIds && matchedIds.has(id));
                const cellDim = filterActive && (!lineColMatch || !detailMatch || ((nameQuery || "").trim() && !hasMatchedPerson));
                return (
                    <div
                        key={a.line_key + "||" + a.row_name + "||" + a.detail}
                        onClick={() => onEdit(a)}
                        className={`w-full text-left mt-1.5 px-2 py-1.5 group cursor-pointer transition-opacity ${
                            shortage
                                ? "border border-red-500 bg-red-950/30"
                                : "hover:bg-white/5 border border-transparent"
                        } ${cellDim ? "opacity-25" : ""}`}
                        data-testid={`support-cell-${a.line}-${a.row_name}`}
                    >
                        <div className="text-[10px] uppercase tracking-widest text-zinc-500 flex items-center justify-between">
                            <span>{a.row_name.toUpperCase()}</span>
                            <Pencil className="w-3 h-3 text-zinc-600 opacity-0 group-hover:opacity-100 no-print" />
                        </div>
                        {a.assigned_person_names.length === 0 ? (
                            <div className="text-sm italic text-zinc-600">unassigned</div>
                        ) : (
                            a.assigned_person_names.map((n, i) => {
                                const pid = a.assigned_person_ids[i];
                                const isMatch = matchedIds && matchedIds.has(pid);
                                return (
                                <div key={i} className="text-sm font-semibold text-white leading-snug flex items-center justify-between group/name">
                                    <span className={
                                        filterActive && isMatch
                                            ? "bg-yellow-400/25 ring-1 ring-yellow-400 px-1 -mx-1"
                                            : (filterActive && !isMatch ? "opacity-40" : "")
                                    }>{n}</span>
                                    <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); onQuickAbsent(pid, n); }}
                                        title="Mark absent from today"
                                        className="ml-2 opacity-0 group-hover/name:opacity-100 text-red-400 hover:text-red-300 no-print"
                                        data-testid={`support-quick-absent-${pid}`}
                                    >
                                        <UserX className="w-3 h-3" />
                                    </button>
                                </div>
                            );})
                        )}
                        {shortage && (
                            <div className="text-[10px] text-red-400 uppercase tracking-widest font-bold mt-0.5">
                                Short by {a.shortage}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

function Chip({ label, value, accent }) {
    const color =
        accent === "alert" ? "border-red-500 text-red-400"
        : accent === "warn" ? "border-amber-500 text-amber-400"
        : accent === "ok" ? "border-emerald-500 text-emerald-400"
        : "border-white/15 text-white";
    return (
        <div
            className={`border ${color} px-4 py-2 flex items-center gap-3`}
            data-testid={`chip-${label.toLowerCase().replace(/\s+/g, "-")}`}
        >
            <span className="text-[10px] uppercase tracking-[0.25em] text-zinc-500">{label}</span>
            <span className="font-chivo font-black text-lg">{value}</span>
        </div>
    );
}
