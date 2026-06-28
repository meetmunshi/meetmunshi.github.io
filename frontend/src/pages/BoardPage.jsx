import { useEffect, useMemo, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { fetchSchedule, exportScheduleUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
    Download,
    Printer,
    AlertCircle,
    Maximize2,
    ChevronLeft,
} from "lucide-react";

function todayISO() {
    return new Date().toISOString().slice(0, 10);
}

function formatLongDate(iso) {
    if (!iso) return "";
    try {
        const d = new Date(iso + "T00:00:00");
        return d
            .toLocaleDateString("en-US", {
                weekday: "long",
                day: "2-digit",
                month: "long",
                year: "numeric",
            })
            .toUpperCase();
    } catch {
        return iso;
    }
}

export default function BoardPage() {
    const [params, setParams] = useSearchParams();
    const date = params.get("date") || todayISO();
    const [schedule, setSchedule] = useState(null);
    const [loading, setLoading] = useState(false);
    const [tvMode, setTvMode] = useState(false);

    useEffect(() => {
        setLoading(true);
        fetchSchedule(date)
            .then(setSchedule)
            .finally(() => setLoading(false));
    }, [date]);

    const { detailOrder, lines, matrix, summary } = useMemo(() => {
        if (!schedule)
            return { detailOrder: [], lines: [], matrix: {}, summary: null };
        const lns = schedule.selected_lines || [];
        const dOrder = [];
        const seen = new Set();
        const mtx = {};
        for (const a of schedule.assignments || []) {
            if (!seen.has(a.detail)) {
                dOrder.push(a.detail);
                seen.add(a.detail);
            }
            mtx[a.detail + "||" + a.line] = a;
        }
        return {
            detailOrder: dOrder,
            lines: lns,
            matrix: mtx,
            summary: {
                required: schedule.total_required,
                assigned: schedule.total_assigned,
                shortage: schedule.total_shortage,
            },
        };
    }, [schedule]);

    if (loading)
        return <div className="p-12 text-zinc-500">Loading board…</div>;

    if (!schedule) {
        return (
            <div className="p-12 max-w-2xl">
                <Link to="/" className="inline-flex items-center text-zinc-400 hover:text-white text-sm mb-6" data-testid="back-to-setup">
                    <ChevronLeft className="w-4 h-4 mr-1" /> Back to setup
                </Link>
                <h1 className="font-chivo font-black uppercase text-4xl">
                    No Schedule for {date}
                </h1>
                <p className="text-zinc-400 mt-3">
                    Go to <Link to="/" className="text-[#007AFF] underline">Setup</Link> and
                    generate one.
                </p>
            </div>
        );
    }

    return (
        <div className={tvMode ? "p-6 bg-black min-h-screen" : "p-8"}>
            {/* Header */}
            <header className="flex items-start justify-between mb-6 no-print">
                <div>
                    <div className="text-[10px] tracking-[0.3em] uppercase text-zinc-500 mb-1">
                        Live Production Board
                    </div>
                    <h1
                        className="font-chivo font-black uppercase tracking-tighter leading-none text-[clamp(2.5rem,5vw,5.5rem)]"
                        data-testid="board-date"
                    >
                        {formatLongDate(date)}
                    </h1>
                </div>
                <div className="flex items-center gap-2">
                    <input
                        type="date"
                        value={date}
                        onChange={(e) => setParams({ date: e.target.value })}
                        data-testid="board-date-input"
                        className="bg-[#111] border border-white/10 px-3 py-2 text-sm font-mono-ibm rounded-none text-white"
                    />
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
                        <Printer className="w-4 h-4 mr-2" />
                        Print
                    </Button>
                    <a
                        href={exportScheduleUrl(date)}
                        data-testid="export-xlsx-btn"
                    >
                        <Button className="rounded-none bg-[#007AFF] hover:bg-[#007AFF]/85 uppercase tracking-widest text-xs">
                            <Download className="w-4 h-4 mr-2" /> Excel
                        </Button>
                    </a>
                </div>
            </header>

            {/* Summary chips */}
            <div className="flex flex-wrap gap-3 mb-6 no-print">
                <Chip label="Lines Active" value={lines.length} />
                <Chip label="Required" value={summary.required} />
                <Chip
                    label="Assigned"
                    value={summary.assigned}
                    accent={
                        summary.assigned >= summary.required ? "ok" : "warn"
                    }
                />
                <Chip
                    label="Shortage"
                    value={summary.shortage}
                    accent={summary.shortage > 0 ? "alert" : "ok"}
                />
            </div>

            {summary.shortage > 0 && (
                <div className="flex items-center gap-3 border border-red-500 bg-red-950/30 text-red-400 px-4 py-3 mb-6 no-print">
                    <AlertCircle className="w-5 h-5 animate-pulse" />
                    <span className="text-sm uppercase tracking-widest">
                        Critical: {summary.shortage} positions unfilled — assign
                        substitutes or revisit absentees.
                    </span>
                </div>
            )}

            {/* Matrix */}
            <div className="overflow-x-auto print-board" data-testid="schedule-matrix">
                <table
                    className="w-full border-collapse"
                    style={{ minWidth: lines.length * 160 + 280 }}
                >
                    <thead>
                        <tr>
                            <th className="sticky left-0 bg-[#0a0a0a] z-20 grid-cell px-4 py-4 text-left text-[11px] uppercase tracking-[0.25em] text-zinc-400 font-bold w-[260px]">
                                Detail / Sub-task
                            </th>
                            {lines.map((l) => (
                                <th
                                    key={l}
                                    className="grid-cell px-4 py-4 text-left font-chivo uppercase font-bold text-xl tracking-tight bg-[#111]"
                                    data-testid={`col-header-${l}`}
                                >
                                    {l}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {detailOrder.map((det) => (
                            <tr key={det}>
                                <th
                                    className="sticky left-0 bg-[#0a0a0a] z-10 grid-cell px-4 py-3 text-left text-sm font-semibold text-zinc-200"
                                    data-testid={`row-header-${det}`}
                                >
                                    {det}
                                </th>
                                {lines.map((l) => {
                                    const a = matrix[det + "||" + l];
                                    if (!a)
                                        return (
                                            <td
                                                key={l}
                                                className="grid-cell px-3 py-3 align-top bg-[#0a0a0a]"
                                                data-testid={`cell-${det}-${l}-empty`}
                                            >
                                                <span className="text-zinc-700 text-xs">—</span>
                                            </td>
                                        );
                                    const shortage = a.shortage > 0;
                                    return (
                                        <td
                                            key={l}
                                            className={`grid-cell px-3 py-3 align-top ${
                                                shortage ? "grid-cell-shortage" : "bg-[#0a0a0a]"
                                            }`}
                                            data-testid={`cell-${det}-${l}`}
                                        >
                                            <div className="flex flex-col gap-1">
                                                {a.assigned_person_names.length === 0 && (
                                                    <span className="text-zinc-600 text-xs italic">
                                                        unassigned
                                                    </span>
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
                                                        <AlertCircle className="w-3 h-3" /> Short by{" "}
                                                        {a.shortage}
                                                    </span>
                                                )}
                                                <span className="text-[10px] text-zinc-500 mt-0.5 font-mono-ibm">
                                                    {a.assigned_person_names.length}/{a.required}
                                                </span>
                                            </div>
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function Chip({ label, value, accent }) {
    const color =
        accent === "alert"
            ? "border-red-500 text-red-400"
            : accent === "warn"
                ? "border-amber-500 text-amber-400"
                : accent === "ok"
                    ? "border-emerald-500 text-emerald-400"
                    : "border-white/15 text-white";
    return (
        <div
            className={`border ${color} px-4 py-2 flex items-center gap-3`}
            data-testid={`chip-${label.toLowerCase().replace(/\s+/g, "-")}`}
        >
            <span className="text-[10px] uppercase tracking-[0.25em] text-zinc-500">
                {label}
            </span>
            <span className="font-chivo font-black text-xl">{value}</span>
        </div>
    );
}
