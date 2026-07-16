import { useEffect, useState } from "react";
import { fetchShortageAnalytics } from "@/lib/api";
import { TrendingDown, AlertCircle } from "lucide-react";

export default function AnalyticsPage() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        fetchShortageAnalytics(30).then(setData).finally(() => setLoading(false));
    }, []);

    if (loading) return <div className="p-8 text-zinc-500">Loading…</div>;
    if (!data) return <div className="p-8">No data</div>;

    const maxDetail = Math.max(1, ...data.top_short_details.map(([, v]) => v));
    const maxLine = Math.max(1, ...data.top_short_lines.map(([, v]) => v));

    return (
        <div className="p-6 md:p-8">
            <header className="mb-8">
                <div className="text-xs tracking-[0.25em] uppercase text-zinc-500 mb-2">
                    Insights · Last 30 Schedules
                </div>
                <h1 className="font-chivo font-black uppercase text-4xl md:text-5xl tracking-tight leading-none">
                    Shortage Analytics
                </h1>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card title="Top Shortage Details" data={data.top_short_details} max={maxDetail} />
                <Card title="Top Shortage Lines" data={data.top_short_lines} max={maxLine} />
            </div>

            <div className="mt-8">
                <h2 className="font-chivo uppercase tracking-tight font-bold text-2xl mb-4">
                    History
                </h2>
                {data.history.length === 0 ? (
                    <div className="border border-white/10 p-8 text-center text-zinc-500 text-sm">
                        No schedules generated yet.
                    </div>
                ) : (
                    <div className="border border-white/10">
                        <div className="grid grid-cols-12 px-4 py-3 border-b border-white/10 bg-[#111] text-[10px] uppercase tracking-[0.25em] text-zinc-500">
                            <div className="col-span-3">Date</div>
                            <div className="col-span-2">Shift</div>
                            <div className="col-span-2 text-right">Required</div>
                            <div className="col-span-2 text-right">Assigned</div>
                            <div className="col-span-3 text-right">Shortage</div>
                        </div>
                        {data.history.map((h) => (
                            <div
                                key={h.date + h.shift}
                                className="grid grid-cols-12 px-4 py-2 border-b border-white/5 text-sm hover:bg-white/5"
                                data-testid={`hist-${h.date}-${h.shift}`}
                            >
                                <div className="col-span-3 font-mono-ibm">{h.date}</div>
                                <div className="col-span-2 uppercase text-xs text-zinc-400">{h.shift}</div>
                                <div className="col-span-2 text-right font-mono-ibm">{h.required}</div>
                                <div className="col-span-2 text-right font-mono-ibm">{h.assigned}</div>
                                <div
                                    className={`col-span-3 text-right font-mono-ibm ${
                                        h.shortage > 0 ? "text-red-400" : "text-emerald-400"
                                    }`}
                                >
                                    {h.shortage > 0 && <AlertCircle className="w-3 h-3 inline mr-1" />}
                                    {h.shortage}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function Card({ title, data, max }) {
    return (
        <div className="border border-white/10 bg-[#111]">
            <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-red-400" />
                <h3 className="font-chivo uppercase font-bold tracking-tight text-sm">{title}</h3>
            </div>
            {data.length === 0 ? (
                <div className="p-8 text-center text-zinc-500 text-sm">No shortages recorded.</div>
            ) : (
                <div className="p-4 space-y-3">
                    {data.map(([label, val]) => (
                        <div key={label}>
                            <div className="flex justify-between text-xs mb-1">
                                <span className="text-zinc-300">{label}</span>
                                <span className="font-mono-ibm text-red-400">{val}</span>
                            </div>
                            <div className="h-2 bg-white/5">
                                <div
                                    className="h-full bg-red-500/70"
                                    style={{ width: `${(val / max) * 100}%` }}
                                />
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
