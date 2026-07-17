import { useEffect, useMemo, useState, useRef } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { toast } from "sonner";
import html2canvas from "html2canvas";
import {
    fetchSchedule,
    exportScheduleUrl,
    fetchPersons,
    adjustCell,
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
} from "lucide-react";

const todayISO = () => new Date().toISOString().slice(0, 10);

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
    const boardRef = useRef(null);

    const setTv = (on) => {
        const p = { date, shift };
        if (on) p.tv = "1";
        setParams(p);
    };

    const load = () => {
        setLoading(true);
        Promise.all([fetchSchedule(date, shift), fetchPersons()])
            .then(([s, p]) => { setSchedule(s); setPersons(p); setLastFetched(Date.now()); })
            .finally(() => setLoading(false));
    };
    useEffect(load, [date, shift]);

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
                    if (!seenCol.has(k)) { cols.push(k); seenCol.add(k); }
                }
            });

        const rns = [];
        const seenR = new Set();
        const mtx = {};
        (schedule.assignments || []).forEach((a) => {
            if (SUPPORT_LINES.includes(a.line)) return;
            if (!seenR.has(a.row_name)) { rns.push(a.row_name); seenR.add(a.row_name); }
            mtx[a.row_name + "||" + a.line_key] = a;
        });

        // Support column items: one entry per small line
        const suppByLine = {};
        (schedule.assignments || []).forEach((a) => {
            if (!SUPPORT_LINES.includes(a.line)) return;
            if (!suppByLine[a.line]) suppByLine[a.line] = [];
            suppByLine[a.line].push(a);
        });
        const supp = SUPPORT_LINES.map((line) => ({
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

    if (loading) return <div className="p-12 text-zinc-500">Loading…</div>;
    if (!schedule) {
        return (
            <div className="p-12 max-w-2xl">
                <Link to="/" className="inline-flex items-center text-zinc-400 hover:text-white text-sm mb-6" data-testid="back-to-setup">
                    <ChevronLeft className="w-4 h-4 mr-1" /> Back to setup
                </Link>
                <h1 className="font-chivo font-black uppercase text-4xl">No Schedule for {date} ({shift})</h1>
                <p className="text-zinc-400 mt-3">
                    Go to <Link to="/" className="text-[#007AFF] underline">Setup</Link> and generate one.
                </p>
            </div>
        );
    }

    const openEdit = (a) => setEditCell(a);
    const closeEdit = () => setEditCell(null);

    const savePicks = async (picks) => {
        try {
            await adjustCell(date, {
                shift,
                cell_key: `${editCell.row_name}||${editCell.line_key}`,
                action: "set",
                person_ids: picks,
            });
            toast.success("Updated");
            closeEdit();
            load();
        } catch (e) {
            toast.error(e.response?.data?.detail || e.message);
        }
    };

    const clearCell = async () => {
        try {
            await adjustCell(date, {
                shift,
                cell_key: `${editCell.row_name}||${editCell.line_key}`,
                action: "clear",
            });
            toast.success("Cleared");
            closeEdit();
            load();
        } catch (e) {
            toast.error(e.response?.data?.detail || e.message);
        }
    };

    return (
        <div className={tvMode ? "p-4 bg-black min-h-screen" : "p-6 md:p-8"} ref={boardRef}>
            <header className="flex flex-wrap items-start justify-between gap-4 mb-5 no-print">
                <div>
                    <div className="text-[10px] tracking-[0.3em] uppercase text-zinc-500 mb-1">
                        Daily Resource Scheduling Board · <span className="text-[#007AFF]">{shift}</span>
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
                        <Maximize2 className="w-4 h-4 mr-2" />
                        {tvMode ? "Exit TV" : "TV Mode"}
                    </Button>
                    <Button
                        variant="outline"
                        onClick={takeScreenshot}
                        data-testid="screenshot-btn"
                        className="rounded-none border-white/15 text-white bg-transparent hover:bg-white/10 uppercase tracking-widest text-xs"
                    >
                        <Camera className="w-4 h-4 mr-2" /> Snapshot
                    </Button>
                    <Button
                        variant="outline"
                        onClick={() => window.print()}
                        data-testid="print-btn"
                        className="rounded-none border-white/15 text-white bg-transparent hover:bg-white/10 uppercase tracking-widest text-xs"
                    >
                        <Printer className="w-4 h-4 mr-2" /> Print / PDF
                    </Button>
                    <a href={exportScheduleUrl(date, shift)} data-testid="export-xlsx-btn">
                        <Button className="rounded-none bg-[#007AFF] hover:bg-[#007AFF]/85 uppercase tracking-widest text-xs">
                            <Download className="w-4 h-4 mr-2" /> Excel
                        </Button>
                    </a>
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

            {summary.shortage > 0 && (
                <div className="flex items-center gap-3 border border-red-500 bg-red-950/30 text-red-400 px-4 py-3 mb-4 no-print">
                    <AlertCircle className="w-5 h-5 animate-pulse" />
                    <span className="text-sm uppercase tracking-widest">
                        Critical: {summary.shortage} positions unfilled — click any cell to reassign.
                    </span>
                </div>
            )}

            {/* Matrix */}
            <div className="overflow-x-auto print-board" data-testid="schedule-matrix">
                <table className="w-full border-collapse" style={{ minWidth: colKeys.length * 170 + 240 }}>
                    <thead>
                        <tr>
                            <th className="sticky left-0 bg-[#0a0a0a] z-20 grid-cell px-4 py-3 text-left text-[11px] uppercase tracking-[0.25em] text-zinc-400 font-bold w-[220px]">
                                Area
                            </th>
                            {colKeys.map((k) => (
                                <th
                                    key={k}
                                    className="grid-cell px-4 py-3 text-left font-chivo uppercase font-bold text-base md:text-lg tracking-tight bg-[#111]"
                                    data-testid={`col-header-${k}`}
                                >
                                    {k}
                                </th>
                            ))}
                            <th
                                className="grid-cell px-4 py-3 text-left font-chivo uppercase font-bold text-base md:text-lg tracking-tight bg-[#111] w-[260px]"
                                data-testid="col-header-support"
                            >
                                Support Ops
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {rowNames.map((rn, rIdx) => (
                            <tr key={rn}>
                                <th
                                    className="sticky left-0 bg-[#0a0a0a] z-10 grid-cell px-4 py-3 text-left text-sm font-bold text-zinc-100 uppercase tracking-wide"
                                    data-testid={`row-header-${rn}`}
                                >
                                    {rn.toUpperCase()}
                                </th>
                                {colKeys.map((k) => {
                                    const a = matrix[rn + "||" + k];
                                    if (!a) {
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
                                    const shortage = a.shortage > 0;
                                    return (
                                        <td
                                            key={k}
                                            className={`grid-cell px-3 py-2 align-top group cursor-pointer ${
                                                shortage ? "grid-cell-shortage" : "bg-[#0a0a0a]"
                                            }`}
                                            data-testid={`cell-${rn}-${k}`}
                                            onClick={() => openEdit(a)}
                                        >
                                            <div className="flex flex-col gap-1">
                                                {a.assigned_person_names.length === 0 && (
                                                    <span className="text-zinc-600 text-xs italic">unassigned</span>
                                                )}
                                                {a.assigned_person_names.map((n, i) => (
                                                    <span
                                                        key={i}
                                                        className="text-sm font-semibold text-white leading-tight"
                                                    >
                                                        {n}
                                                    </span>
                                                ))}
                                                {shortage && (
                                                    <span className="mt-1 inline-flex items-center gap-1 text-red-400 text-[10px] uppercase tracking-widest font-bold animate-pulse">
                                                        <AlertCircle className="w-3 h-3" /> Short by {a.shortage}
                                                    </span>
                                                )}
                                                <div className="flex items-center justify-between mt-0.5">
                                                    <span className="text-[10px] text-zinc-500 font-mono-ibm">
                                                        {a.assigned_person_names.length}/{a.required}
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
                                                />
                                            ))}
                                        </div>
                                    </td>
                                )}
                            </tr>
                        ))}
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
                                        {absentPersons.map((p) => (
                                            <span
                                                key={p.id}
                                                className="inline-flex items-center border border-red-500/40 bg-red-500/10 text-red-200 text-xs px-2 py-1 font-medium"
                                            >
                                                {p.name} {p.surname}
                                            </span>
                                        ))}
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
                                        {unassignedPersons.map((p) => (
                                            <span
                                                key={p.id}
                                                data-testid={`unassigned-chip-${p.id}`}
                                                className="inline-flex items-center border border-amber-500/40 bg-amber-500/10 text-amber-200 text-xs px-2 py-1 font-medium"
                                                title={`${Object.values(p.skills || {}).filter(Boolean).length} skills`}
                                            >
                                                {p.name} {p.surname}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            {/* Edit Dialog */}
            <Dialog open={!!editCell} onOpenChange={(o) => !o && closeEdit()}>
                <DialogContent
                    className="rounded-none bg-[#111] border-white/15 text-white max-w-lg"
                    data-testid="edit-cell-dialog"
                >
                    <DialogHeader>
                        <DialogTitle className="font-chivo uppercase tracking-tight">
                            Adjust · {editCell?.row_name} × {editCell?.line_key}
                        </DialogTitle>
                        <DialogDescription className="text-xs text-zinc-500">
                            Skill required: <span className="text-zinc-300">{editCell?.detail}</span> ·{" "}
                            Required: {editCell?.required}
                        </DialogDescription>
                    </DialogHeader>
                    {editCell && (
                        <PersonPicker
                            detail={editCell.detail}
                            required={editCell.required}
                            initialIds={editCell.assigned_person_ids}
                            persons={persons}
                            personLocations={personLocations}
                            currentCellKey={`${editCell.row_name}||${editCell.line_key}`}
                            absentIds={new Set(schedule.absent_person_ids || [])}
                            onSave={savePicks}
                            onClear={clearCell}
                            onCancel={closeEdit}
                        />
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}

function PersonPicker({
    detail, required, initialIds, persons, personLocations, currentCellKey,
    absentIds, onSave, onClear, onCancel,
}) {
    const [picks, setPicks] = useState(new Set(initialIds));
    const [search, setSearch] = useState("");

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

    return (
        <div className="space-y-3">
            <input
                type="text"
                placeholder="Search skilled staff…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="edit-search"
                className="w-full bg-[#0a0a0a] border border-white/10 px-3 py-2 text-sm outline-none focus:border-[#007AFF]"
            />
            <div className="text-[10px] uppercase tracking-widest text-zinc-500">
                Picked {picks.size} · Required {required} · {eligible.length} eligible
                {picks.size > required && (
                    <span className="ml-2 text-emerald-400">
                        (+{picks.size - required} extra hand{picks.size - required > 1 ? "s" : ""})
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
                                checked ? "bg-[#007AFF]/15"
                                    : busy ? "bg-amber-500/5"
                                    : "bg-emerald-500/5 hover:bg-emerald-500/10"
                            }`}
                            data-testid={`pick-row-${p.id}`}
                        >
                            <Checkbox
                                checked={checked}
                                onCheckedChange={() => toggle(p.id)}
                                data-testid={`pick-cb-${p.id}`}
                                className="border-white/20 data-[state=checked]:bg-[#007AFF] rounded-none mt-0.5"
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
                    onClick={() => onSave(Array.from(picks))}
                    data-testid="edit-save-btn"
                    className="rounded-none bg-[#007AFF] hover:bg-[#007AFF]/85 uppercase text-xs tracking-widest"
                >
                    Save
                </Button>
            </DialogFooter>
        </div>
    );
}

function SupportBlock({ item, onEdit }) {
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
    return (
        <div className="py-2.5" data-testid={`support-line-${item.line}`}>
            <div className="text-sm font-chivo uppercase font-bold tracking-tight text-[#007AFF]">
                {item.line}
            </div>
            {item.assignments.map((a) => {
                const shortage = a.shortage > 0;
                return (
                    <button
                        type="button"
                        key={a.line_key + "||" + a.row_name}
                        onClick={() => onEdit(a)}
                        className={`w-full text-left mt-1.5 px-2 py-1.5 group ${
                            shortage
                                ? "border border-red-500 bg-red-950/30"
                                : "hover:bg-white/5 border border-transparent"
                        }`}
                        data-testid={`support-cell-${a.line}-${a.row_name}`}
                    >
                        <div className="text-[10px] uppercase tracking-widest text-zinc-500">
                            {a.row_name.toUpperCase()}
                        </div>
                        {a.assigned_person_names.length === 0 ? (
                            <div className="text-sm italic text-zinc-600">unassigned</div>
                        ) : (
                            a.assigned_person_names.map((n, i) => (
                                <div key={i} className="text-sm font-semibold text-white leading-snug">
                                    {n}
                                </div>
                            ))
                        )}
                        {shortage && (
                            <div className="text-[10px] text-red-400 uppercase tracking-widest font-bold mt-0.5">
                                Short by {a.shortage}
                            </div>
                        )}
                    </button>
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
