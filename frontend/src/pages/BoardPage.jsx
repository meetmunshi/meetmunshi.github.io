import { useEffect, useMemo, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { toast } from "sonner";
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
} from "lucide-react";

const todayISO = () => new Date().toISOString().slice(0, 10);

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
    const [schedule, setSchedule] = useState(null);
    const [persons, setPersons] = useState([]);
    const [loading, setLoading] = useState(false);
    const [tvMode, setTvMode] = useState(false);
    const [editCell, setEditCell] = useState(null);

    const load = () => {
        setLoading(true);
        Promise.all([fetchSchedule(date, shift), fetchPersons()])
            .then(([s, p]) => { setSchedule(s); setPersons(p); })
            .finally(() => setLoading(false));
    };
    useEffect(load, [date, shift]);

    const personById = useMemo(() => {
        const m = {};
        persons.forEach((p) => (m[p.id] = p));
        return m;
    }, [persons]);

    const { rowNames, colKeys, matrix, summary, absentPersons } = useMemo(() => {
        if (!schedule) return { rowNames: [], colKeys: [], matrix: {}, summary: null, absentPersons: [] };
        const cols = [];
        const seenCol = new Set();
        (schedule.line_configs || [])
            .slice()
            .sort((a, b) => a.priority - b.priority || a.line.localeCompare(b.line))
            .forEach((c) => {
                for (let r = 1; r <= (c.run_count || 1); r++) {
                    const k = r === 1 ? c.line : `${c.line} #${r}`;
                    if (!seenCol.has(k)) { cols.push(k); seenCol.add(k); }
                }
            });

        const rns = [];
        const seenR = new Set();
        const mtx = {};
        (schedule.assignments || []).forEach((a) => {
            if (!seenR.has(a.row_name)) { rns.push(a.row_name); seenR.add(a.row_name); }
            mtx[a.row_name + "||" + a.line_key] = a;
        });

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
        };
    }, [schedule, personById]);

    const busyPersonIds = useMemo(() => {
        const s = new Set();
        (schedule?.assignments || []).forEach((a) =>
            a.assigned_person_ids.forEach((id) => s.add(id)),
        );
        return s;
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
        <div className={tvMode ? "p-4 bg-black min-h-screen" : "p-6 md:p-8"}>
            <header className="flex flex-wrap items-start justify-between gap-4 mb-5 no-print">
                <div>
                    <div className="text-[10px] tracking-[0.3em] uppercase text-zinc-500 mb-1">
                        Production Board · <span className="text-[#007AFF]">{shift}</span>
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
                        onChange={(e) => setParams({ date: e.target.value, shift })}
                        data-testid="board-date-input"
                        className="bg-[#111] border border-white/10 px-3 py-2 text-sm font-mono-ibm rounded-none text-white"
                    />
                    <select
                        value={shift}
                        onChange={(e) => setParams({ date, shift: e.target.value })}
                        data-testid="board-shift-select"
                        className="bg-[#111] border border-white/10 px-3 py-2 text-sm rounded-none text-white uppercase"
                    >
                        <option value="day">Day</option>
                        <option value="evening">Evening</option>
                        <option value="night">Night</option>
                    </select>
                    <Button
                        variant="outline"
                        onClick={() => setTvMode((v) => !v)}
                        data-testid="tv-mode-btn"
                        className="rounded-none border-white/15 text-white bg-transparent hover:bg-white/10 uppercase tracking-widest text-xs"
                    >
                        <Maximize2 className="w-4 h-4 mr-2" />
                        {tvMode ? "Exit TV" : "TV Mode"}
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
                                Row Name
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
                        </tr>
                    </thead>
                    <tbody>
                        {rowNames.map((rn) => (
                            <tr key={rn}>
                                <th
                                    className="sticky left-0 bg-[#0a0a0a] z-10 grid-cell px-4 py-3 text-left text-sm font-semibold text-zinc-200"
                                    data-testid={`row-header-${rn}`}
                                >
                                    {rn}
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
                                colSpan={colKeys.length}
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
                        <div className="text-xs text-zinc-500">
                            Skill required: <span className="text-zinc-300">{editCell?.detail}</span> ·{" "}
                            Required: {editCell?.required}
                        </div>
                    </DialogHeader>
                    {editCell && (
                        <PersonPicker
                            detail={editCell.detail}
                            required={editCell.required}
                            initialIds={editCell.assigned_person_ids}
                            persons={persons}
                            busyPersonIds={busyPersonIds}
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
    detail, required, initialIds, persons, busyPersonIds, absentIds, onSave, onClear, onCancel,
}) {
    const [picks, setPicks] = useState(new Set(initialIds));
    const [search, setSearch] = useState("");
    const initialSet = useMemo(() => new Set(initialIds), [initialIds]);

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
                Picked {picks.size}/{required} · {eligible.length} eligible
            </div>
            <div className="max-h-72 overflow-y-auto border border-white/10">
                {eligible.length === 0 && (
                    <div className="p-6 text-center text-zinc-500 text-sm">
                        No skilled staff match the search.
                    </div>
                )}
                {eligible.map((p) => {
                    const checked = picks.has(p.id);
                    const busy = busyPersonIds.has(p.id) && !initialSet.has(p.id);
                    return (
                        <label
                            key={p.id}
                            className={`flex items-center gap-3 px-3 py-2 border-b border-white/5 cursor-pointer ${
                                checked ? "bg-[#007AFF]/15" : busy ? "bg-amber-500/5" : "hover:bg-white/5"
                            }`}
                            data-testid={`pick-row-${p.id}`}
                        >
                            <Checkbox
                                checked={checked}
                                onCheckedChange={() => toggle(p.id)}
                                data-testid={`pick-cb-${p.id}`}
                                className="border-white/20 data-[state=checked]:bg-[#007AFF] rounded-none"
                            />
                            <span className="flex-1 text-sm">{p.name} {p.surname}</span>
                            {busy && (
                                <span className="text-[9px] uppercase tracking-widest text-amber-400">
                                    on other line
                                </span>
                            )}
                            <span className="text-[10px] font-mono-ibm text-zinc-500">
                                {Object.values(p.skills || {}).filter(Boolean).length} sk
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
