import { useEffect, useMemo, useState } from "react";
import { fetchPersons, fetchDetails, personsExportUrl } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Search, ArrowUpDown, Download } from "lucide-react";

export default function PersonsPage() {
    const [persons, setPersons] = useState([]);
    const [details, setDetails] = useState([]);
    const [search, setSearch] = useState("");
    const [loading, setLoading] = useState(true);
    const [sortBy, setSortBy] = useState("name");
    const [sortDir, setSortDir] = useState("asc");
    const [typeFilter, setTypeFilter] = useState("all");

    useEffect(() => {
        Promise.all([fetchPersons(), fetchDetails()])
            .then(([p, d]) => {
                setPersons(p);
                setDetails(d);
            })
            .finally(() => setLoading(false));
    }, []);

    const empTypes = useMemo(() => {
        const s = new Set();
        persons.forEach((p) => p.employee_type && s.add(p.employee_type));
        return Array.from(s).sort();
    }, [persons]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        let list = persons;
        if (typeFilter !== "all") list = list.filter((p) => p.employee_type === typeFilter);
        if (q) list = list.filter((p) =>
            `${p.name} ${p.surname} ${p.qualification}`.toLowerCase().includes(q),
        );
        const skillCount = (p) => Object.values(p.skills || {}).filter(Boolean).length;
        const cmp = {
            name: (a, b) => `${a.name} ${a.surname}`.localeCompare(`${b.name} ${b.surname}`),
            skills: (a, b) => skillCount(a) - skillCount(b),
            type: (a, b) => (a.employee_type || "").localeCompare(b.employee_type || ""),
            qualification: (a, b) => (a.qualification || "").localeCompare(b.qualification || ""),
        }[sortBy];
        const sorted = [...list].sort(cmp);
        return sortDir === "desc" ? sorted.reverse() : sorted;
    }, [persons, search, sortBy, sortDir, typeFilter]);

    return (
        <div className="p-6 md:p-8">
            <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
                <div>
                    <div className="text-xs tracking-[0.25em] uppercase text-zinc-500 mb-2">
                        Workforce Registry
                    </div>
                    <h1 className="font-chivo font-black uppercase text-4xl md:text-5xl tracking-tight leading-none">
                        Persons
                    </h1>
                    <p className="text-zinc-400 mt-3 text-sm">
                        {persons.length} total · {details.length} skill columns
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <a
                        href={personsExportUrl("xlsx")}
                        data-testid="persons-export-xlsx"
                        className="inline-flex items-center gap-1.5 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 uppercase tracking-widest text-[10px] font-bold px-3 py-2"
                    >
                        <Download className="w-3 h-3" /> Excel
                    </a>
                    <a
                        href={personsExportUrl("csv")}
                        data-testid="persons-export-csv"
                        className="inline-flex items-center gap-1.5 border border-white/15 text-white hover:bg-white/10 uppercase tracking-widest text-[10px] font-bold px-3 py-2"
                    >
                        <Download className="w-3 h-3" /> CSV
                    </a>
                </div>
            </header>

            <div className="flex flex-wrap items-center gap-3 mb-6">
                <div className="flex items-center gap-3 border border-white/10 bg-[#111] px-4 py-2 flex-1 min-w-[220px]">
                    <Search className="w-4 h-4 text-zinc-500" />
                    <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search by name or qualification…"
                        data-testid="persons-search-input"
                        className="bg-transparent border-0 text-white p-0 h-auto focus-visible:ring-0"
                    />
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Type</span>
                    <Select value={typeFilter} onValueChange={setTypeFilter}>
                        <SelectTrigger
                            className="rounded-none border-white/10 bg-[#111] w-36 h-9"
                            data-testid="persons-type-filter"
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="rounded-none bg-[#111] border-white/10 text-white">
                            <SelectItem value="all">All types</SelectItem>
                            {empTypes.map((t) => (
                                <SelectItem key={t} value={t}>{t}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Sort</span>
                    <Select value={sortBy} onValueChange={setSortBy}>
                        <SelectTrigger
                            className="rounded-none border-white/10 bg-[#111] w-40 h-9"
                            data-testid="persons-sort-by"
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="rounded-none bg-[#111] border-white/10 text-white">
                            <SelectItem value="name">Name</SelectItem>
                            <SelectItem value="skills">Skill count</SelectItem>
                            <SelectItem value="type">Employee type</SelectItem>
                            <SelectItem value="qualification">Qualification</SelectItem>
                        </SelectContent>
                    </Select>
                    <button
                        onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                        data-testid="persons-sort-dir"
                        title={sortDir === "asc" ? "Ascending" : "Descending"}
                        className="h-9 w-9 border border-white/10 bg-[#111] hover:bg-white/10 flex items-center justify-center"
                    >
                        <ArrowUpDown className={`w-4 h-4 ${sortDir === "desc" ? "rotate-180" : ""} transition-transform`} />
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="text-zinc-500">Loading…</div>
            ) : (
                <div className="border border-white/10">
                    <div className="grid grid-cols-12 px-4 py-3 border-b border-white/10 bg-[#111] text-[10px] uppercase tracking-[0.25em] text-zinc-500">
                        <div className="col-span-1">#</div>
                        <div className="col-span-3">Name</div>
                        <div className="col-span-2">Qualification</div>
                        <div className="col-span-2">Type</div>
                        <div className="col-span-4">Skills</div>
                    </div>
                    {filtered.map((p, idx) => {
                        const trainedSkills = Object.entries(p.skills || {})
                            .filter(([, v]) => v)
                            .map(([k]) => k);
                        const skillCount = trainedSkills.length;
                        return (
                            <div
                                key={p.id}
                                className="grid grid-cols-12 px-4 py-3 border-b border-white/5 text-sm hover:bg-white/5 items-start"
                                data-testid={`person-row-${p.id}`}
                            >
                                <div className="col-span-1 text-zinc-500 font-mono-ibm">
                                    {idx + 1}
                                </div>
                                <div className="col-span-3 font-semibold">
                                    {p.name} {p.surname}
                                </div>
                                <div className="col-span-2 text-zinc-400 text-xs">
                                    {p.qualification || "—"}
                                </div>
                                <div className="col-span-2">
                                    <Badge
                                        variant="outline"
                                        className="rounded-none border-white/15 text-[10px] uppercase tracking-wider"
                                    >
                                        {p.employee_type || "—"}
                                    </Badge>
                                </div>
                                <div className="col-span-4">
                                    <div
                                        className="flex flex-wrap gap-1 mb-1.5"
                                        data-testid={`person-skills-${p.id}`}
                                    >
                                        {trainedSkills.length === 0 && (
                                            <span className="text-[10px] text-zinc-600 italic">No trained skills</span>
                                        )}
                                        {trainedSkills.map((sk) => (
                                            <span
                                                key={sk}
                                                title={sk}
                                                className="inline-block text-[9px] uppercase tracking-wider border border-emerald-500/30 bg-emerald-500/10 text-emerald-200 px-1.5 py-0.5 leading-tight"
                                            >
                                                {sk}
                                            </span>
                                        ))}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="flex-1 h-1 bg-white/10 max-w-[160px]">
                                            <div
                                                className="h-full bg-[#3B6AB8]"
                                                style={{
                                                    width: `${(skillCount / Math.max(details.length, 1)) * 100}%`,
                                                }}
                                            />
                                        </div>
                                        <span className="font-mono-ibm text-[10px] text-zinc-500">
                                            {skillCount}/{details.length}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                    {filtered.length === 0 && (
                        <div className="p-8 text-center text-zinc-500 text-sm">
                            No matches.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
