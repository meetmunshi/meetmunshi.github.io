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
import { Calendar, Search, AlertTriangle, PlayCircle } from "lucide-react";

function todayISO() {
    const d = new Date();
    return d.toISOString().slice(0, 10);
}

export default function SetupPage() {
    const navigate = useNavigate();
    const [date, setDate] = useState(todayISO());
    const [lines, setLines] = useState([]);
    const [persons, setPersons] = useState([]);
    const [selectedLines, setSelectedLines] = useState(new Set());
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
                // Pre-select all lines by default
                setSelectedLines(new Set((linesData.lines || []).map((l) => l.line)));
            })
            .catch((e) => toast.error("Failed to load data: " + e.message))
            .finally(() => setLoading(false));
    }, []);

    // When date changes, try to load existing schedule
    useEffect(() => {
        if (!date) return;
        fetchSchedule(date).then((sched) => {
            if (sched) {
                setSelectedLines(new Set(sched.selected_lines));
                setAbsentIds(new Set(sched.absent_person_ids));
            }
        });
    }, [date]);

    const toggleLine = (line) => {
        const ns = new Set(selectedLines);
        ns.has(line) ? ns.delete(line) : ns.add(line);
        setSelectedLines(ns);
    };
    const toggleAbsent = (id) => {
        const ns = new Set(absentIds);
        ns.has(id) ? ns.delete(id) : ns.add(id);
        setAbsentIds(ns);
    };

    const filteredPersons = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return persons;
        return persons.filter((p) =>
            `${p.name} ${p.surname}`.toLowerCase().includes(q),
        );
    }, [persons, search]);

    const totalRequired = useMemo(
        () =>
            lines
                .filter((l) => selectedLines.has(l.line))
                .reduce(
                    (acc, l) =>
                        acc + l.details.reduce((s, d) => s + (d.persons_required || 0), 0),
                    0,
                ),
        [lines, selectedLines],
    );

    const availableCount = persons.length - absentIds.size;

    const handleGenerate = async () => {
        if (selectedLines.size === 0) {
            toast.error("Select at least one assembly line");
            return;
        }
        setGenerating(true);
        try {
            await generateSchedule({
                date,
                selected_lines: Array.from(selectedLines),
                absent_person_ids: Array.from(absentIds),
            });
            toast.success("Schedule generated");
            navigate("/board?date=" + date);
        } catch (e) {
            toast.error("Failed: " + (e.response?.data?.detail || e.message));
        } finally {
            setGenerating(false);
        }
    };

    return (
        <div className="p-8 max-w-[1500px]">
            <header className="mb-10">
                <div className="text-xs tracking-[0.25em] uppercase text-zinc-500 mb-2">
                    Step 01 / Configure
                </div>
                <h1
                    className="font-chivo font-black uppercase text-5xl md:text-6xl tracking-tight leading-none"
                    data-testid="setup-title"
                >
                    Daily Setup
                </h1>
                <p className="text-zinc-400 mt-3 max-w-2xl">
                    Pick the date, choose which lines run, mark absentees. The system
                    auto-assigns specialists first.
                </p>
            </header>

            {/* Top status row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-white/10 border border-white/10 mb-10">
                <Stat label="Selected Lines" value={selectedLines.size} />
                <Stat label="Required Headcount" value={totalRequired} />
                <Stat label="Absent" value={absentIds.size} accent="alert" />
                <Stat label="Available" value={availableCount} accent="ok" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                {/* Left: date + lines */}
                <section>
                    <SectionTitle index="A" title="Date" />
                    <div className="border border-white/10 bg-[#111] p-5 flex items-center gap-4 mb-8">
                        <Calendar className="w-5 h-5 text-zinc-400" />
                        <Input
                            type="date"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                            data-testid="setup-date-input"
                            className="bg-[#0a0a0a] border-white/10 text-white text-lg font-mono-ibm rounded-none w-fit"
                        />
                    </div>

                    <SectionTitle index="B" title="Assembly Lines" />
                    <div className="border border-white/10">
                        {loading ? (
                            <div className="p-8 text-center text-zinc-500">Loading…</div>
                        ) : (
                            lines.map((l) => {
                                const active = selectedLines.has(l.line);
                                const totalDetailReq = l.details.reduce(
                                    (s, d) => s + (d.persons_required || 0),
                                    0,
                                );
                                return (
                                    <button
                                        key={l.line}
                                        type="button"
                                        onClick={() => toggleLine(l.line)}
                                        data-testid={`line-toggle-${l.line}`}
                                        className={`w-full flex items-center justify-between px-5 py-4 border-b border-white/10 last:border-b-0 transition ${
                                            active
                                                ? "bg-[#007AFF]/15 hover:bg-[#007AFF]/20"
                                                : "bg-transparent hover:bg-white/5"
                                        }`}
                                    >
                                        <div className="flex items-center gap-4">
                                            <span
                                                className={`w-3 h-3 rounded-none ${
                                                    active ? "bg-[#007AFF]" : "bg-white/15"
                                                }`}
                                            />
                                            <span className="font-chivo uppercase font-bold tracking-tight text-lg">
                                                {l.line}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <span className="text-xs uppercase tracking-widest text-zinc-500">
                                                {l.details.length} steps
                                            </span>
                                            <span className="font-mono-ibm text-sm text-zinc-300">
                                                {totalDetailReq} ppl
                                            </span>
                                        </div>
                                    </button>
                                );
                            })
                        )}
                    </div>
                </section>

                {/* Right: absentees */}
                <section>
                    <SectionTitle index="C" title="Mark Absent" />
                    <div className="border border-white/10 bg-[#111]">
                        <div className="flex items-center gap-3 border-b border-white/10 p-3">
                            <Search className="w-4 h-4 text-zinc-500" />
                            <input
                                type="text"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Search persons…"
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
                        <div className="max-h-[500px] overflow-y-auto">
                            {filteredPersons.map((p) => {
                                const checked = absentIds.has(p.id);
                                return (
                                    <label
                                        key={p.id}
                                        className={`flex items-center gap-3 px-4 py-2.5 border-b border-white/5 cursor-pointer ${
                                            checked ? "bg-red-500/10" : "hover:bg-white/5"
                                        }`}
                                        data-testid={`absent-row-${p.id}`}
                                    >
                                        <Checkbox
                                            checked={checked}
                                            onCheckedChange={() => toggleAbsent(p.id)}
                                            data-testid={`absent-cb-${p.id}`}
                                            className="border-white/20 data-[state=checked]:bg-red-500 data-[state=checked]:border-red-500 rounded-none"
                                        />
                                        <span
                                            className={`flex-1 text-sm ${
                                                checked
                                                    ? "line-through text-red-300"
                                                    : "text-zinc-200"
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
                                <div className="p-8 text-center text-zinc-500 text-sm">
                                    No persons match.
                                </div>
                            )}
                        </div>
                    </div>
                </section>
            </div>

            {/* Action bar */}
            <div className="sticky bottom-0 mt-12 -mx-8 px-8 py-5 bg-[#0a0a0a] border-t border-white/10 flex items-center gap-4 no-print">
                {totalRequired > availableCount && (
                    <div className="flex items-center gap-2 text-amber-400 text-sm">
                        <AlertTriangle className="w-4 h-4" />
                        Required headcount exceeds available staff — expect shortages.
                    </div>
                )}
                <div className="flex-1" />
                <Button
                    onClick={handleGenerate}
                    disabled={generating || selectedLines.size === 0}
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
        accent === "alert"
            ? "text-[#FF3B30]"
            : accent === "ok"
                ? "text-[#34C759]"
                : "text-white";
    return (
        <div className="bg-[#0a0a0a] px-6 py-5">
            <div className="text-[10px] uppercase tracking-[0.25em] text-zinc-500">
                {label}
            </div>
            <div
                className={`font-chivo font-black text-4xl mt-2 ${color}`}
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
            <h3 className="font-chivo font-bold uppercase tracking-tight text-xl">
                {title}
            </h3>
        </div>
    );
}
