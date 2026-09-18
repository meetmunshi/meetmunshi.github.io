import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { fetchSchedules, absenteeismReportUrl, deleteSchedule } from "@/lib/api";
import { ChevronLeft, ChevronRight, CalendarDays, Download, Lock, Trash2 } from "lucide-react";

export default function HistoryPage() {
    const [items, setItems] = useState([]);
    const [month, setMonth] = useState(() => {
        const d = new Date();
        return { y: d.getFullYear(), m: d.getMonth() };
    });

    const load = () => fetchSchedules().then(setItems);
    useEffect(() => { load(); }, []);

    const handleDelete = async (date, shift, logged) => {
        const warn = logged
            ? `⚠ This schedule is LOGGED (frozen for absenteeism reporting).\n\nDelete ${date} · ${shift.toUpperCase()} anyway? This cannot be undone.`
            : `Delete ${date} · ${shift.toUpperCase()} schedule?\n\nThis removes all assignments, absentees, and logs for this day/shift.`;
        if (!window.confirm(warn)) return;
        try {
            await deleteSchedule(date, shift);
            toast.success(`Deleted ${date} · ${shift}`);
            load();
        } catch (e) {
            toast.error(e.response?.data?.detail || e.message);
        }
    };

    const byDate = useMemo(() => {
        const m = {};
        items.forEach((i) => {
            if (!m[i.date]) m[i.date] = [];
            m[i.date].push(i);
        });
        return m;
    }, [items]);

    const daysInMonth = new Date(month.y, month.m + 1, 0).getDate();
    const firstDay = new Date(month.y, month.m, 1).getDay();
    const monthName = new Date(month.y, month.m, 1).toLocaleDateString("en-US", {
        month: "long", year: "numeric",
    });

    const navMonth = (delta) => {
        const nd = new Date(month.y, month.m + delta, 1);
        setMonth({ y: nd.getFullYear(), m: nd.getMonth() });
    };

    const monthStartISO = `${month.y}-${String(month.m + 1).padStart(2, "0")}-01`;
    const monthEndISO = `${month.y}-${String(month.m + 1).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`;

    const cells = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
        const iso = `${month.y}-${String(month.m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        cells.push({ d, iso, schedules: byDate[iso] || [] });
    }

    return (
        <div className="p-6 md:p-8 max-w-5xl">
            <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
                <div>
                    <div className="text-xs tracking-[0.25em] uppercase text-zinc-500 mb-2">
                        Calendar · Weekly & Monthly View
                    </div>
                    <h1 className="font-chivo font-black uppercase text-4xl md:text-5xl tracking-tight leading-none">
                        Schedule History
                    </h1>
                </div>
                <div className="flex gap-2">
                    <a href={absenteeismReportUrl(monthStartISO, monthEndISO, false)} data-testid="absenteeism-report-btn">
                        <button className="border border-white/15 hover:bg-white/10 uppercase tracking-widest text-xs font-bold px-4 py-2 flex items-center gap-2">
                            <Download className="w-4 h-4" /> Absenteeism · Month
                        </button>
                    </a>
                    <a href={absenteeismReportUrl(monthStartISO, monthEndISO, true)} data-testid="absenteeism-logged-btn">
                        <button className="border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 uppercase tracking-widest text-xs font-bold px-4 py-2 flex items-center gap-2">
                            <Lock className="w-4 h-4" /> Logged only
                        </button>
                    </a>
                </div>
            </header>

            <div className="border border-white/10 bg-[#111]">
                <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
                    <button
                        onClick={() => navMonth(-1)}
                        data-testid="history-prev-month"
                        className="w-9 h-9 border border-white/10 hover:bg-white/10 flex items-center justify-center"
                    >
                        <ChevronLeft className="w-4 h-4" />
                    </button>
                    <h2 className="font-chivo uppercase font-bold text-2xl tracking-tight">
                        {monthName}
                    </h2>
                    <button
                        onClick={() => navMonth(1)}
                        data-testid="history-next-month"
                        className="w-9 h-9 border border-white/10 hover:bg-white/10 flex items-center justify-center"
                    >
                        <ChevronRight className="w-4 h-4" />
                    </button>
                </div>
                <div className="grid grid-cols-7 border-b border-white/10">
                    {["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map((d) => (
                        <div
                            key={d}
                            className="px-3 py-2 text-[10px] uppercase tracking-[0.25em] text-zinc-500 text-center border-r border-white/5 last:border-r-0"
                        >
                            {d}
                        </div>
                    ))}
                </div>
                <div className="grid grid-cols-7">
                    {cells.map((c, i) => {
                        if (!c) return <div key={i} className="min-h-24 border-r border-b border-white/5 bg-[#0a0a0a]/50" />;
                        const has = c.schedules.length > 0;
                        return (
                            <div
                                key={i}
                                data-testid={`cal-cell-${c.iso}`}
                                className={`min-h-24 border-r border-b border-white/5 p-2 flex flex-col ${
                                    has ? "bg-[#3B6AB8]/5" : "bg-[#0a0a0a]"
                                }`}
                            >
                                <div className="flex items-center justify-between mb-1">
                                    <Link
                                        to={`/board?date=${c.iso}&shift=${c.schedules[0]?.shift || "day"}`}
                                        className="font-mono-ibm text-sm text-zinc-300 hover:text-white"
                                        data-testid={`cal-cell-date-${c.iso}`}
                                    >
                                        {c.d}
                                    </Link>
                                    {has && <CalendarDays className="w-3 h-3 text-[#3B6AB8]" />}
                                </div>
                                {c.schedules.map((s) => (
                                    <div
                                        key={s.shift}
                                        className="text-[10px] uppercase tracking-widest text-zinc-400 mb-0.5 flex items-center justify-between gap-1 group"
                                        data-testid={`cal-shift-${c.iso}-${s.shift}`}
                                    >
                                        <Link
                                            to={`/board?date=${c.iso}&shift=${s.shift}`}
                                            className="flex items-center gap-1 flex-1 min-w-0 hover:text-white"
                                        >
                                            <span className="text-[#3B6AB8]">{s.shift}</span>
                                            {s.logged_at && <Lock className="w-2.5 h-2.5 text-emerald-400" />}
                                            {s.total_shortage > 0 && (
                                                <span className="ml-1 text-red-400">−{s.total_shortage}</span>
                                            )}
                                            {(s.closures?.length || 0) > 0 && (
                                                <span
                                                    className="ml-1 text-red-300 border border-red-500/40 bg-red-500/10 px-1"
                                                    title={`${s.closures.length} line closure${s.closures.length === 1 ? "" : "s"}`}
                                                    data-testid={`cal-closures-${c.iso}-${s.shift}`}
                                                >
                                                    ⏻{s.closures.length}
                                                </span>
                                            )}
                                        </Link>
                                        <button
                                            type="button"
                                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDelete(c.iso, s.shift, !!s.logged_at); }}
                                            title={`Delete ${c.iso} ${s.shift}`}
                                            aria-label={`Delete ${c.iso} ${s.shift}`}
                                            data-testid={`delete-schedule-${c.iso}-${s.shift}`}
                                            className="opacity-60 md:opacity-0 md:group-hover:opacity-100 hover:opacity-100 text-red-400 hover:text-red-300 border border-red-500/30 hover:border-red-500 bg-red-500/5 hover:bg-red-500/15 p-0.5"
                                        >
                                            <Trash2 className="w-3 h-3" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
