import { useEffect, useMemo, useState } from "react";
import { fetchSkillCoverage } from "@/lib/api";
import { GraduationCap, Search } from "lucide-react";

export default function SkillCoveragePage() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [q, setQ] = useState("");

    useEffect(() => {
        fetchSkillCoverage()
            .then(setData)
            .finally(() => setLoading(false));
    }, []);

    const rows = data?.rows || [];
    const total = data?.total_associates || 0;

    const filtered = useMemo(() => {
        const needle = q.trim().toLowerCase();
        if (!needle) return rows;
        return rows.filter((r) => r.skill.toLowerCase().includes(needle));
    }, [rows, q]);

    const barColor = (count) => {
        if (total === 0) return "bg-zinc-700";
        const pct = count / total;
        if (pct === 0) return "bg-red-500/80";
        if (pct < 0.15) return "bg-red-500/60";
        if (pct < 0.4) return "bg-amber-500/70";
        if (pct < 0.7) return "bg-emerald-500/60";
        return "bg-emerald-500/85";
    };

    return (
        <div className="p-6 md:p-8 max-w-4xl" data-testid="skill-coverage-page">
            <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
                <div>
                    <div className="text-xs tracking-[0.25em] uppercase text-zinc-500 mb-2">
                        Roster · Training signal
                    </div>
                    <h1 className="font-chivo font-black uppercase text-4xl md:text-5xl tracking-tight leading-none flex items-center gap-3">
                        <GraduationCap className="w-10 h-10 text-emerald-400" />
                        Skill Coverage
                    </h1>
                    <p className="text-sm text-zinc-500 mt-3 max-w-xl">
                        How many associates are trained on each skill. Counted directly from the
                        Yes / No columns of the uploaded skill matrix.
                    </p>
                </div>
                <div className="text-right">
                    <div className="text-[10px] uppercase tracking-widest text-zinc-500">Roster size</div>
                    <div className="font-mono-ibm text-3xl text-white" data-testid="skill-total-associates">
                        {total}
                    </div>
                </div>
            </header>

            <div className="mb-4 flex items-center gap-2 border border-white/10 bg-[#111] px-3 py-2 w-full md:w-96">
                <Search className="w-4 h-4 text-zinc-500" />
                <input
                    type="text"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Filter by skill name…"
                    data-testid="skill-filter"
                    className="w-full bg-transparent text-sm focus:outline-none placeholder:text-zinc-600"
                />
                {q && (
                    <button
                        onClick={() => setQ("")}
                        className="text-[10px] uppercase tracking-widest text-zinc-500 hover:text-white"
                    >
                        Clear
                    </button>
                )}
            </div>

            <div className="border border-white/10 bg-[#111]">
                <div className="grid grid-cols-[1fr_120px] md:grid-cols-[1fr_180px_120px] px-4 py-2 border-b border-white/10 text-[10px] uppercase tracking-widest text-zinc-500 font-bold">
                    <div>Skill</div>
                    <div className="hidden md:block">Coverage</div>
                    <div className="text-right">Trained</div>
                </div>

                {loading && (
                    <div className="p-6 text-sm text-zinc-500">Loading skill coverage…</div>
                )}

                {!loading && filtered.length === 0 && (
                    <div className="p-6 text-sm text-zinc-500" data-testid="skill-empty">
                        {rows.length === 0
                            ? "No skills in the roster yet. Upload a skill matrix to populate this view."
                            : `No skills match "${q}".`}
                    </div>
                )}

                <div className="divide-y divide-white/5">
                    {filtered.map((r) => {
                        const pct = total === 0 ? 0 : Math.round((r.trained_count / total) * 100);
                        return (
                            <div
                                key={r.skill}
                                className="grid grid-cols-[1fr_120px] md:grid-cols-[1fr_180px_120px] items-center px-4 py-3 hover:bg-white/5"
                                data-testid={`skill-row-${r.skill}`}
                            >
                                <div className="font-chivo font-bold uppercase tracking-tight text-sm text-white">
                                    {r.skill}
                                </div>
                                <div className="hidden md:flex items-center gap-2">
                                    <div className="h-1.5 bg-white/5 w-full">
                                        <div
                                            className={`h-full ${barColor(r.trained_count)}`}
                                            style={{ width: `${Math.min(100, pct)}%` }}
                                        />
                                    </div>
                                    <span className="font-mono-ibm text-[10px] text-zinc-500 w-10 text-right">
                                        {pct}%
                                    </span>
                                </div>
                                <div className="text-right">
                                    <span
                                        className="font-mono-ibm text-xl text-white"
                                        data-testid={`skill-count-${r.skill}`}
                                    >
                                        {r.trained_count}
                                    </span>
                                    <span className="font-mono-ibm text-xs text-zinc-500 ml-1">
                                        / {total}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
