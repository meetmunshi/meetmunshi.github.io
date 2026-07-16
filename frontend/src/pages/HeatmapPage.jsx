import { useEffect, useMemo, useState } from "react";
import { fetchPersons, fetchDetails } from "@/lib/api";
import { Flame, GraduationCap } from "lucide-react";

const SUPPORT_LINES = ["Monkey", "KK", "Spares", "Vehicle", "Crimping", "OS", "5S+Others"];

export default function HeatmapPage() {
    const [persons, setPersons] = useState([]);
    const [details, setDetails] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        Promise.all([fetchPersons(), fetchDetails()])
            .then(([p, d]) => { setPersons(p); setDetails(d); })
            .finally(() => setLoading(false));
    }, []);

    const { rows, lines, matrix, coverage, trainingOps } = useMemo(() => {
        const rns = [];
        const lns = [];
        const seenR = new Set();
        const seenL = new Set();
        const mtx = {}; // {row||line: {count, detail, required, gap}}
        for (const d of details) {
            if (!seenR.has(d.row_name)) { rns.push(d.row_name); seenR.add(d.row_name); }
            if (!seenL.has(d.line)) { lns.push(d.line); seenL.add(d.line); }
            const count = persons.filter((p) => p.skills?.[d.detail]).length;
            mtx[d.row_name + "||" + d.line] = {
                count,
                detail: d.detail,
                required: d.persons_required,
                gap: Math.max(0, d.persons_required - count),
                ratio: d.persons_required > 0 ? count / d.persons_required : count,
            };
        }
        // Coverage %: overall
        const totalCells = Object.keys(mtx).length;
        const wellCovered = Object.values(mtx).filter((v) => v.ratio >= 2).length;
        const fragile = Object.values(mtx).filter((v) => v.ratio < 2 && v.count > 0);
        const critical = Object.values(mtx).filter((v) => v.count === 0);

        // Training opportunities: cells with ratio<2 and required>0, sorted by lowest ratio, then highest required
        const training = Object.entries(mtx)
            .map(([k, v]) => ({ key: k, ...v, row_name: k.split("||")[0], line: k.split("||")[1] }))
            .filter((v) => v.required > 0 && v.ratio < 2)
            .sort((a, b) => a.ratio - b.ratio || b.required - a.required)
            .slice(0, 15);

        return {
            rows: rns,
            lines: lns,
            matrix: mtx,
            coverage: { totalCells, wellCovered, fragile: fragile.length, critical: critical.length },
            trainingOps: training,
        };
    }, [persons, details]);

    const cellClass = (v) => {
        if (!v) return "bg-[#0a0a0a] text-zinc-700";
        if (v.count === 0) return "bg-red-600 text-white font-bold";
        if (v.ratio < 1) return "bg-red-500/70 text-white font-bold";
        if (v.ratio < 2) return "bg-amber-500/50 text-white font-semibold";
        if (v.ratio < 4) return "bg-emerald-500/30 text-white";
        return "bg-emerald-500/60 text-white font-semibold";
    };

    // Candidates to train for a training opportunity: persons who lack this skill but have any related skill in same row_name
    const candidatesFor = (detail) => {
        return persons
            .filter((p) => !p.skills?.[detail])
            .map((p) => ({ p, existing: Object.values(p.skills || {}).filter(Boolean).length }))
            .sort((a, b) => b.existing - a.existing)
            .slice(0, 3);
    };

    if (loading) return <div className="p-8 text-zinc-500">Loading heatmap…</div>;

    return (
        <div className="p-6 md:p-8">
            <header className="mb-6">
                <div className="text-xs tracking-[0.25em] uppercase text-zinc-500 mb-2">
                    Workforce Coverage Map
                </div>
                <h1 className="font-chivo font-black uppercase text-4xl md:text-5xl tracking-tight leading-none">
                    Skill Heatmap
                </h1>
                <p className="text-zinc-400 mt-3 text-sm max-w-2xl">
                    How many skilled people cover each Area × Line combination? Red = zero, amber = fragile (single-point-of-failure), green = resilient.
                </p>
            </header>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-white/10 border border-white/10 mb-6">
                <Stat label="Cells" value={coverage.totalCells} />
                <Stat label="Well Covered" value={coverage.wellCovered} accent="ok" />
                <Stat label="Fragile" value={coverage.fragile} accent="warn" />
                <Stat label="Critical" value={coverage.critical} accent="alert" />
            </div>

            <div className="overflow-x-auto mb-8" data-testid="heatmap-grid">
                <table className="border-collapse w-full" style={{ minWidth: lines.length * 90 + 220 }}>
                    <thead>
                        <tr>
                            <th className="sticky left-0 bg-[#0a0a0a] z-10 grid-cell px-3 py-2 text-left text-[10px] uppercase tracking-[0.25em] text-zinc-400 w-[200px]">
                                Area
                            </th>
                            {lines.map((l) => (
                                <th
                                    key={l}
                                    className={`grid-cell px-2 py-2 text-center font-chivo uppercase font-bold text-xs tracking-tight bg-[#111] ${
                                        SUPPORT_LINES.includes(l) ? "text-zinc-500" : "text-white"
                                    }`}
                                >
                                    {l}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((rn) => (
                            <tr key={rn}>
                                <th className="sticky left-0 bg-[#0a0a0a] z-10 grid-cell px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-zinc-100">
                                    {rn.toUpperCase()}
                                </th>
                                {lines.map((l) => {
                                    const v = matrix[rn + "||" + l];
                                    return (
                                        <td
                                            key={l}
                                            className={`grid-cell px-2 py-2 text-center text-xs ${cellClass(v)}`}
                                            title={v ? `${v.detail}: ${v.count} skilled / ${v.required} required` : "—"}
                                        >
                                            {v ? `${v.count}/${v.required}` : "—"}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div>
                <div className="flex items-center gap-2 mb-4">
                    <GraduationCap className="w-5 h-5 text-amber-400" />
                    <h2 className="font-chivo uppercase font-bold text-2xl tracking-tight">
                        Top Training Opportunities
                    </h2>
                </div>
                <p className="text-xs text-zinc-500 mb-4">
                    These roles have the fewest skilled people. Train the suggested candidates (most cross-skilled first) to eliminate future shortages.
                </p>
                <div className="border border-white/10">
                    <div className="grid grid-cols-12 px-4 py-3 border-b border-white/10 bg-[#111] text-[10px] uppercase tracking-[0.25em] text-zinc-500">
                        <div className="col-span-3">Area</div>
                        <div className="col-span-2">Line</div>
                        <div className="col-span-3">Skill (Detail)</div>
                        <div className="col-span-1 text-center">Skilled</div>
                        <div className="col-span-3">Suggested trainees</div>
                    </div>
                    {trainingOps.length === 0 && (
                        <div className="p-6 text-center text-zinc-500 text-sm">
                            Excellent coverage — no fragile spots detected.
                        </div>
                    )}
                    {trainingOps.map((t) => {
                        const cands = candidatesFor(t.detail);
                        return (
                            <div
                                key={t.key}
                                className="grid grid-cols-12 px-4 py-3 border-b border-white/5 text-sm items-start"
                                data-testid={`training-row-${t.key}`}
                            >
                                <div className="col-span-3 font-semibold uppercase text-xs">{t.row_name}</div>
                                <div className="col-span-2 text-zinc-300 text-xs uppercase font-mono-ibm">{t.line}</div>
                                <div className="col-span-3 text-zinc-400 text-xs">{t.detail}</div>
                                <div className="col-span-1 text-center">
                                    <span
                                        className={`inline-flex items-center gap-1 font-mono-ibm text-sm ${
                                            t.count === 0 ? "text-red-400" : "text-amber-400"
                                        }`}
                                    >
                                        {t.count === 0 && <Flame className="w-3 h-3" />}
                                        {t.count}/{t.required}
                                    </span>
                                </div>
                                <div className="col-span-3 flex flex-wrap gap-1">
                                    {cands.map((c) => (
                                        <span
                                            key={c.p.id}
                                            className="text-[11px] border border-emerald-500/30 bg-emerald-500/5 text-emerald-300 px-2 py-0.5"
                                            title={`Already has ${c.existing} skills`}
                                        >
                                            {c.p.name} {c.p.surname}
                                            <span className="ml-1 text-emerald-500/60">({c.existing})</span>
                                        </span>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

function Stat({ label, value, accent }) {
    const color =
        accent === "alert" ? "text-red-400"
        : accent === "warn" ? "text-amber-400"
        : accent === "ok" ? "text-emerald-400"
        : "text-white";
    return (
        <div className="bg-[#0a0a0a] px-5 py-4">
            <div className="text-[10px] uppercase tracking-[0.25em] text-zinc-500">{label}</div>
            <div className={`font-chivo font-black text-3xl mt-1 ${color}`}>{value}</div>
        </div>
    );
}
