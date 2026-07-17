import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchSchedules } from "@/lib/api";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";

export default function HistoryPage() {
    const [items, setItems] = useState([]);
    const [month, setMonth] = useState(() => {
        const d = new Date();
        return { y: d.getFullYear(), m: d.getMonth() };
    });

    useEffect(() => {
        fetchSchedules().then(setItems);
    }, []);

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

    const cells = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
        const iso = `${month.y}-${String(month.m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        cells.push({ d, iso, schedules: byDate[iso] || [] });
    }

    return (
        <div className="p-6 md:p-8 max-w-5xl">
            <header className="mb-8">
                <div className="text-xs tracking-[0.25em] uppercase text-zinc-500 mb-2">
                    Calendar · Weekly & Monthly View
                </div>
                <h1 className="font-chivo font-black uppercase text-4xl md:text-5xl tracking-tight leading-none">
                    Schedule History
                </h1>
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
                            <Link
                                key={i}
                                to={`/board?date=${c.iso}&shift=${c.schedules[0]?.shift || "day"}`}
                                data-testid={`cal-cell-${c.iso}`}
                                className={`min-h-24 border-r border-b border-white/5 p-2 hover:bg-white/5 transition ${
                                    has ? "bg-[#3B6AB8]/5" : "bg-[#0a0a0a]"
                                }`}
                            >
                                <div className="flex items-center justify-between mb-1">
                                    <span className="font-mono-ibm text-sm text-zinc-300">{c.d}</span>
                                    {has && (
                                        <CalendarDays className="w-3 h-3 text-[#3B6AB8]" />
                                    )}
                                </div>
                                {c.schedules.map((s) => (
                                    <div
                                        key={s.shift}
                                        className="text-[10px] uppercase tracking-widest text-zinc-400 mb-0.5"
                                    >
                                        <span className="text-[#3B6AB8]">{s.shift}</span>
                                        {s.total_shortage > 0 && (
                                            <span className="ml-1 text-red-400">−{s.total_shortage}</span>
                                        )}
                                    </div>
                                ))}
                            </Link>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
