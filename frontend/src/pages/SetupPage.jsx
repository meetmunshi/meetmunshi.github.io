import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
    fetchLines,
    fetchPersons,
    fetchSchedule,
    generateSchedule,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Calendar,
    Search,
    AlertTriangle,
    PlayCircle,
    Minus,
    Plus,
} from "lucide-react";

const todayISO = () => new Date().toISOString().slice(0, 10);
const DEFAULT_PRIORITY = 5;

export default function SetupPage() {
    const navigate = useNavigate();
    const [date, setDate] = useState(todayISO());
    const [shift, setShift] = useState("day");
    const [lines, setLines] = useState([]);
    const [persons, setPersons] = useState([]);
    const [configs, setConfigs] = useState({}); // line -> {enabled, priority, run_count}
    const [absentIds, setAbsentIds] = useState(new Set());
    const [search, setSearch] = useState("");
    const [loading, setLoading] = useState(false);
    const [generating, setGenerating] = useState(false);

    useEffect(() => {
        setLoading(true);
        Promise.all([fetchLines(), fetchPersons()])
            .then(([linesData, personsData]) => {
                setLines(linesData.lines || []);
                setPersons(personsData || []);
                const init = {};
                (linesData.lines || []).forEach((l, idx) => {
                    init[l.line] = {
                        enabled: true,
                        priority: idx < 3 ? idx + 1 : DEFAULT_PRIORITY,
                        run_count: 1,
                    };
                });
                setConfigs(init);
            })
            .catch((e) => toast.error("Failed: " + e.message))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        if (!date) return;
        fetchSchedule(date, shift).then((sched) => {
            if (sched) {
                const cfgMap = {};
                (sched.line_configs || []).forEach((c) => {
                    cfgMap[c.line] = {
                        enabled: true,
                        priority: c.priority,
                        run_count: c.run_count,
                    };
                });
                setConfigs((prev) => {
                    const next = { ...prev };
                    Object.keys(next).forEach((k) => (next[k].enabled = false));
                    Object.entries(cfgMap).forEach(([k, v]) => (next[k] = v));
                    return next;
                });
                setAbsentIds(new Set(sched.absent_person_ids || []));
            }
        });
    }, [date, shift]);

    const setCfg = (line, patch) =>
        setConfigs((prev) => ({ ...prev, [line]: { ...prev[line], ...patch } }));

    const filteredPersons = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return persons;
        return persons.filter((p) =>
            `${p.name} ${p.surname}`.toLowerCase().includes(q),
        );
    }, [persons, search]);

    const activeLines = Object.entries(configs).filter(([, c]) => c.enabled);
    const totalRequired = useMemo(() => {
        return activeLines.reduce((acc, [lineName, cfg]) => {
            const l = lines.find((x) => x.line === lineName);
            if (!l) return acc;
            const sum = l.details.reduce((s, d) => s + (d.persons_required || 0), 0);
            return acc + sum * (cfg.run_count || 1);
        }, 0);
    }, [activeLines, lines]);

    const availableCount = persons.length - absentIds.size;

    const handleGenerate = async () => {
        const line_configs = activeLines.map(([line, c]) => ({
            line,
            priority: Number(c.priority) || DEFAULT_PRIORITY,
            run_count: Number(c.run_count) || 1,
        }));
        if (line_configs.length === 0) {
            toast.error("Enable at least one assembly line");
            return;
        }
        setGenerating(true);
        try {
            await generateSchedule({
                date,
                shift,
                line_configs,
                absent_person_ids: Array.from(absentIds),
                overrides: {},
                unassigned_keys: [],
            });
            toast.success("Schedule generated");
            navigate(`/board?date=${date}&shift=${shift}`);
        } catch (e) {
            toast.error("Failed: " + (e.response?.data?.detail || e.message));
        } finally {
            setGenerating(false);
        }
    };

    return (
        <div className="p-6 md:p-8 max-w-[1600px]">
            <header className="mb-8">
                <div className="text-xs tracking-[0.25em] uppercase text-zinc-500 mb-2">
                    Step 01 / Configure
                </div>
                <h1
                    className="font-chivo font-black uppercase text-4xl md:text-6xl tracking-tight leading-none"
                    data-testid="setup-title"
                >
                    Daily Setup
                </h1>
                <p className="text-zinc-400 mt-3 max-w-2xl text-sm">
                    Pick the date + shift, set priority per line (1 = highest — gets people first),
                    run-count for repeated batches, mark absentees. System assigns specialists first.
                </p>
            </header>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-white/10 border border-white/10 mb-8">
                <Stat label="Active Lines" value={activeLines.length} />
                <Stat label="Required" value={totalRequired} />
                <Stat label="Absent" value={absentIds.size} accent="alert" />
                <Stat label="Available" value={availableCount} accent="ok" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <section>
                    <SectionTitle index="A" title="Date · Shift" />
                    <div className="border border-white/10 bg-[#111] p-4 flex flex-wrap items-center gap-4 mb-6">
                        <div className="flex items-center gap-3">
                            <Calendar className="w-4 h-4 text-zinc-400" />
                            <Input
                                type="date"
                                value={date}
                                onChange={(e) => setDate(e.target.value)}
                                data-testid="setup-date-input"
                                className="bg-[#0a0a0a] border-white/10 text-white font-mono-ibm rounded-none w-fit"
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Shift</span>
                            <Select value={shift} onValueChange={setShift}>
                                <SelectTrigger
                                    className="rounded-none border-white/10 bg-[#0a0a0a] w-32"
                                    data-testid="setup-shift-select"
                                >
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="rounded-none bg-[#111] border-white/10 text-white">
                                    <SelectItem value="day">Day</SelectItem>
                                    <SelectItem value="evening">Evening</SelectItem>
                                    <SelectItem value="night">Night</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <SectionTitle index="B" title="Assembly Lines · Priority · Runs" />
                    <div className="border border-white/10">
                        <div className="grid grid-cols-12 gap-2 px-4 py-2 bg-[#111] border-b border-white/10 text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                            <div className="col-span-5">Line</div>
                            <div className="col-span-3 text-center">Priority</div>
                            <div className="col-span-3 text-center">Runs</div>
                            <div className="col-span-1 text-right">On</div>
                        </div>
                        {loading ? (
                            <div className="p-8 text-center text-zinc-500">Loading…</div>
                        ) : (
                            lines.map((l) => {
                                const cfg = configs[l.line] || {
                                    enabled: false,
                                    priority: DEFAULT_PRIORITY,
                                    run_count: 1,
                                };
                                const totalReq = l.details.reduce((s, d) => s + (d.persons_required || 0), 0);
                                return (
                                    <div
                                        key={l.line}
                                        className={`grid grid-cols-12 gap-2 items-center px-4 py-2 border-b border-white/5 last:border-b-0 ${
                                            cfg.enabled ? "bg-[#007AFF]/5" : "bg-transparent"
                                        }`}
                                        data-testid={`line-row-${l.line}`}
                                    >
                                        <div className="col-span-5 flex items-center gap-3">
                                            <span
                                                className={`w-2 h-2 ${cfg.enabled ? "bg-[#007AFF]" : "bg-white/15"}`}
                                            />
                                            <span className="font-chivo uppercase font-bold text-base">
                                                {l.line}
                                            </span>
                                            <span className="text-[10px] text-zinc-500 uppercase tracking-widest">
                                                {totalReq}p
                                            </span>
                                        </div>
                                        <div className="col-span-3">
                                            <Input
                                                type="number"
                                                min={1}
                                                max={20}
                                                value={cfg.priority}
                                                onChange={(e) =>
                                                    setCfg(l.line, { priority: Number(e.target.value) })
                                                }
                                                data-testid={`line-priority-${l.line}`}
                                                className="rounded-none bg-[#0a0a0a] border-white/10 text-center h-8"
                                                disabled={!cfg.enabled}
                                            />
                                        </div>
                                        <div className="col-span-3 flex items-center justify-center gap-1">
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    setCfg(l.line, {
                                                        run_count: Math.max(1, (cfg.run_count || 1) - 1),
                                                    })
                                                }
                                                className="w-7 h-7 border border-white/10 hover:bg-white/10 flex items-center justify-center disabled:opacity-30"
                                                disabled={!cfg.enabled}
                                                data-testid={`line-run-minus-${l.line}`}
                                            >
                                                <Minus className="w-3 h-3" />
                                            </button>
                                            <span
                                                className="font-mono-ibm text-sm w-6 text-center"
                                                data-testid={`line-run-count-${l.line}`}
                                            >
                                                {cfg.run_count || 1}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    setCfg(l.line, {
                                                        run_count: Math.min(10, (cfg.run_count || 1) + 1),
                                                    })
                                                }
                                                className="w-7 h-7 border border-white/10 hover:bg-white/10 flex items-center justify-center disabled:opacity-30"
                                                disabled={!cfg.enabled}
                                                data-testid={`line-run-plus-${l.line}`}
                                            >
                                                <Plus className="w-3 h-3" />
                                            </button>
                                        </div>
                                        <div className="col-span-1 flex justify-end">
                                            <Checkbox
                                                checked={cfg.enabled}
                                                onCheckedChange={(v) => setCfg(l.line, { enabled: !!v })}
                                                data-testid={`line-enable-${l.line}`}
                                                className="border-white/20 data-[state=checked]:bg-[#007AFF] data-[state=checked]:border-[#007AFF] rounded-none"
                                            />
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </section>

                <section>
                    <SectionTitle index="C" title="Mark Absent" />
                    <div className="border border-white/10 bg-[#111]">
                        <div className="flex items-center gap-3 border-b border-white/10 p-3">
                            <Search className="w-4 h-4 text-zinc-500" />
                            <input
                                type="text"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Search…"
                                data-testid="absent-search-input"
                                className="bg-transparent outline-none flex-1 text-sm placeholder:text-zinc-600"
                            />
                            {absentIds.size > 0 && (
                                <button
                                    onClick={() => setAbsentIds(new Set())}
                                    data-testid="absent-clear-btn"
                                    className="text-[10px] uppercase tracking-widest text-zinc-400 hover:text-white"
                                >
                                    Clear ({absentIds.size})
                                </button>
                            )}
                        </div>
                        <div className="max-h-[520px] overflow-y-auto">
                            {filteredPersons.map((p) => {
                                const checked = absentIds.has(p.id);
                                return (
                                    <label
                                        key={p.id}
                                        className={`flex items-center gap-3 px-4 py-2 border-b border-white/5 cursor-pointer ${
                                            checked ? "bg-red-500/10" : "hover:bg-white/5"
                                        }`}
                                        data-testid={`absent-row-${p.id}`}
                                    >
                                        <Checkbox
                                            checked={checked}
                                            onCheckedChange={() => {
                                                const ns = new Set(absentIds);
                                                ns.has(p.id) ? ns.delete(p.id) : ns.add(p.id);
                                                setAbsentIds(ns);
                                            }}
                                            data-testid={`absent-cb-${p.id}`}
                                            className="border-white/20 data-[state=checked]:bg-red-500 data-[state=checked]:border-red-500 rounded-none"
                                        />
                                        <span
                                            className={`flex-1 text-sm ${
                                                checked ? "line-through text-red-300" : "text-zinc-200"
                                            }`}
                                        >
                                            {p.sn ? `${p.sn}. ` : ""}
                                            {p.name} {p.surname}
                                        </span>
                                        <Badge
                                            variant="outline"
                                            className="rounded-none border-white/15 text-[10px] uppercase tracking-wider text-zinc-500"
                                        >
                                            {p.employee_type || "—"}
                                        </Badge>
                                    </label>
                                );
                            })}
                            {filteredPersons.length === 0 && (
                                <div className="p-8 text-center text-zinc-500 text-sm">No matches.</div>
                            )}
                        </div>
                    </div>
                </section>
            </div>

            <div className="sticky bottom-0 mt-10 -mx-6 md:-mx-8 px-6 md:px-8 py-4 bg-[#0a0a0a] border-t border-white/10 flex flex-wrap items-center gap-4 no-print">
                {totalRequired > availableCount && (
                    <div className="flex items-center gap-2 text-amber-400 text-xs">
                        <AlertTriangle className="w-4 h-4" />
                        Required {totalRequired} exceeds available {availableCount} — shortages expected.
                    </div>
                )}
                <div className="flex-1" />
                <Button
                    onClick={handleGenerate}
                    disabled={generating || activeLines.length === 0}
                    data-testid="generate-schedule-btn"
                    className="bg-[#007AFF] hover:bg-[#007AFF]/85 text-white rounded-none uppercase tracking-widest font-bold px-8 py-6 text-base"
                >
                    <PlayCircle className="w-5 h-5 mr-2" />
                    {generating ? "Generating…" : "Generate Schedule"}
                </Button>
            </div>
        </div>
    );
}

function Stat({ label, value, accent }) {
    const color =
        accent === "alert" ? "text-[#FF3B30]" : accent === "ok" ? "text-[#34C759]" : "text-white";
    return (
        <div className="bg-[#0a0a0a] px-5 py-4">
            <div className="text-[10px] uppercase tracking-[0.25em] text-zinc-500">{label}</div>
            <div
                className={`font-chivo font-black text-3xl mt-1 ${color}`}
                data-testid={`stat-${label.toLowerCase().replace(/\s+/g, "-")}`}
            >
                {value}
            </div>
        </div>
    );
}

function SectionTitle({ index, title }) {
    return (
        <div className="flex items-baseline gap-3 mb-3">
            <span className="text-[10px] uppercase tracking-[0.3em] text-zinc-500 font-mono-ibm">
                {index}
            </span>
            <h3 className="font-chivo font-bold uppercase tracking-tight text-lg">{title}</h3>
        </div>
    );
}
