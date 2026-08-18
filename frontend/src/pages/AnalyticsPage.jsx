import { useEffect, useState } from "react";
import { fetchMonthlyAnalytics } from "@/lib/api";
import { UserX, AlertTriangle, Activity } from "lucide-react";

function monthLabel(ym) {
    if (!ym) return "";
    const [y, m] = ym.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" }).toUpperCase();
}

function formatDate(iso) {
    if (!iso) return "";
    return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { day: "2-digit", month: "short" });
}

export default function AnalyticsPage() {
    const [month, setMonth] = useState("");
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        setLoading(true);
        fetchMonthlyAnalytics(month || undefined)
            .then((d) => {
                setData(d);
                if (!month && d.month) setMonth(d.month);
            })
            .finally(() => setLoading(false));
    }, [month]);

    if (loading && !data) return <div className="p-8 text-zinc-500">Loading…</div>;
    if (!data) return <div className="p-8">No data</div>;

    const maxAbs = Math.max(1, ...(data.top_absentees || []).map((a) => a.count));
    const maxLineHit = Math.max(1, ...(data.lines_hit_by_absence || []).map((l) => l.shortage_days));
    const maxUtil = Math.max(1, ...(data.line_utilisation || []).map((l) => l.total_runs || 0));

    return (
        <div className="p-4 sm:p-6 md:p-8">
            {/* Header + month selector */}
            <header className="flex flex-wrap items-end justify-between gap-4 mb-8">
                <div>
                    <div className="text-xs tracking-[0.25em] uppercase text-zinc-500 mb-2">
                        Monthly Insights · {data.days_with_schedule} scheduled day{data.days_with_schedule === 1 ? "" : "s"}
                    </div>
                    <h1
                        className="font-chivo font-black uppercase text-4xl md:text-5xl tracking-tight leading-none"
                        data-testid="analytics-month-label"
                    >
                        {monthLabel(data.month)}
                    </h1>
                </div>
                <div>
                    <label className="block text-[10px] uppercase tracking-widest text-zinc-500 mb-1">Month</label>
                    <select
                        value={data.month}
                        onChange={(e) => setMonth(e.target.value)}
                        data-testid="analytics-month-select"
                        className="bg-[#111] border border-white/10 px-3 py-2 text-sm rounded-none text-white uppercase tracking-wide min-w-[180px]"
                    >
                        {(data.months_available || []).map((m) => (
                            <option key={m} value={m}>{monthLabel(m)}</option>
                        ))}
                        {/* Ensure current selection appears even if not in list */}
                        {!(data.months_available || []).includes(data.month) && (
                            <option value={data.month}>{monthLabel(data.month)}</option>
                        )}
                    </select>
                </div>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* 1. Top absenteeism */}
                <section className="border border-white/10 bg-[#111]" data-testid="card-top-absentees">
                    <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
                        <UserX className="w-4 h-4 text-red-400" />
                        <h3 className="font-chivo uppercase font-bold tracking-tight text-sm">Top Absenteeism</h3>
                    </div>
                    {(data.top_absentees || []).length === 0 ? (
                        <div className="p-8 text-center text-zinc-500 text-sm">Full attendance this month.</div>
                    ) : (
                        <div className="divide-y divide-white/5">
                            {data.top_absentees.map((a) => (
                                <div
                                    key={a.person_id}
                                    className="px-4 py-3"
                                    data-testid={`absentee-${a.person_id}`}
                                >
                                    <div className="flex items-center justify-between mb-1.5">
                                        <span className="text-sm font-semibold text-white">{a.name}</span>
                                        <span className="font-mono-ibm text-red-400 text-sm" data-testid={`absentee-count-${a.person_id}`}>
                                            {a.count}
                                        </span>
                                    </div>
                                    <div className="h-1.5 bg-white/5 mb-2">
                                        <div className="h-full bg-red-500/70" style={{ width: `${(a.count / maxAbs) * 100}%` }} />
                                    </div>
                                    <div className="flex flex-wrap gap-1">
                                        {a.dates.map((d) => (
                                            <span
                                                key={d}
                                                className="text-[10px] font-mono-ibm text-red-300/80 border border-red-500/25 bg-red-500/5 px-1.5 py-0.5"
                                            >
                                                {formatDate(d)}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>

                {/* 2. Lines suffering from absence */}
                <section className="border border-white/10 bg-[#111]" data-testid="card-lines-hit">
                    <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-400" />
                        <h3 className="font-chivo uppercase font-bold tracking-tight text-sm">Lines Hit by Absence</h3>
                    </div>
                    {(data.lines_hit_by_absence || []).length === 0 ? (
                        <div className="p-8 text-center text-zinc-500 text-sm">
                            No shortage-days recorded on absentee days this month.
                        </div>
                    ) : (
                        <div className="p-4 space-y-3">
                            {data.lines_hit_by_absence.map((l) => (
                                <div key={l.line} data-testid={`line-hit-${l.line}`}>
                                    <div className="flex justify-between text-xs mb-1">
                                        <span className="text-zinc-200 font-semibold uppercase tracking-wide">{l.line}</span>
                                        <span className="font-mono-ibm text-amber-400">
                                            {l.shortage_days} day{l.shortage_days === 1 ? "" : "s"} · −{l.shortage_total}
                                        </span>
                                    </div>
                                    <div className="h-2 bg-white/5">
                                        <div
                                            className="h-full bg-amber-500/70"
                                            style={{ width: `${(l.shortage_days / maxLineHit) * 100}%` }}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>

                {/* 3. Line utilisation */}
                <section className="border border-white/10 bg-[#111]" data-testid="card-line-util">
                    <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
                        <Activity className="w-4 h-4 text-emerald-400" />
                        <h3 className="font-chivo uppercase font-bold tracking-tight text-sm">Line Utilisation</h3>
                    </div>
                    {(data.line_utilisation || []).length === 0 ? (
                        <div className="p-8 text-center text-zinc-500 text-sm">No schedules generated this month.</div>
                    ) : (
                        <div className="p-4 space-y-3">
                            {data.line_utilisation.map((l) => (
                                <div key={l.line} data-testid={`line-util-${l.line}`}>
                                    <div className="flex justify-between text-xs mb-1">
                                        <span className="text-zinc-200 font-semibold uppercase tracking-wide">{l.line}</span>
                                        <span className="font-mono-ibm text-emerald-400">
                                            {l.total_runs} run{l.total_runs === 1 ? "" : "s"}
                                            <span className="text-zinc-500"> · {l.days_run} day{l.days_run === 1 ? "" : "s"}</span>
                                        </span>
                                    </div>
                                    <div className="h-2 bg-white/5">
                                        <div
                                            className="h-full bg-emerald-500/70"
                                            style={{ width: `${(l.total_runs / maxUtil) * 100}%` }}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
}
