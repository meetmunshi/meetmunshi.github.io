// Weighted trainee ranking: skill priority 40, availability 30, multi-skill gap 20, tenure 10.
export const WEIGHTS = { priority: 40, availability: 30, gap: 20, tenure: 10 };
const SEVERITY = { red: 1, amber: 0.5 };
const GAP_POINTS = { red: 2, amber: 1 };

export const severityOf = (v) => {
    if (!v || v.required <= 0) return null;
    if (v.count === 0 || v.ratio < 1) return "red";
    if (v.ratio < 2) return "amber";
    return null;
};

const dailyHash = (id, day) => {
    let h = 0;
    const s = `${day}|${id}`;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return h;
};

const tenureDays = (doj, now) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(doj || "")) return 0;
    return Math.max(0, (now - new Date(doj).getTime()) / 86400000);
};

// gapSkills: {detail: "red"|"amber"} for every fragile skill on the heatmap.
export const buildTraineeRanker = (persons, gapSkills, absenceStats) => {
    const now = Date.now();
    const day = new Date().toISOString().slice(0, 10);
    const base = persons.map((p) => {
        const gaps = Object.entries(gapSkills).filter(([sk]) => !p.skills?.[sk]);
        return {
            p,
            gapPoints: gaps.reduce((s, [, sev]) => s + GAP_POINTS[sev], 0),
            gapCount: gaps.length,
            tenure: tenureDays(p.date_of_joining, now),
            absenceRate: absenceStats?.[p.id]?.rate || 0,
            tiebreak: dailyHash(p.id, day),
        };
    });
    const maxGap = Math.max(1, ...base.map((b) => b.gapPoints));
    const maxTenure = Math.max(1, ...base.map((b) => b.tenure));

    return (detail, severity, limit = 5) =>
        base
            .filter((b) => !b.p.skills?.[detail])
            .map((b) => {
                const score =
                    WEIGHTS.priority * SEVERITY[severity] +
                    WEIGHTS.availability * (1 - b.absenceRate) +
                    WEIGHTS.gap * (b.gapPoints / maxGap) +
                    WEIGHTS.tenure * (b.tenure / maxTenure);
                return { ...b, score: Math.round(score * 10) / 10 };
            })
            .sort((a, b) => b.score - a.score || a.tiebreak - b.tiebreak)
            .slice(0, limit);
};
