import { useEffect, useMemo, useState } from "react";
import { fetchPersons, fetchDetails } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search } from "lucide-react";

export default function PersonsPage() {
    const [persons, setPersons] = useState([]);
    const [details, setDetails] = useState([]);
    const [search, setSearch] = useState("");
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        Promise.all([fetchPersons(), fetchDetails()])
            .then(([p, d]) => {
                setPersons(p);
                setDetails(d);
            })
            .finally(() => setLoading(false));
    }, []);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return persons;
        return persons.filter((p) =>
            `${p.name} ${p.surname} ${p.qualification}`.toLowerCase().includes(q),
        );
    }, [persons, search]);

    return (
        <div className="p-8">
            <header className="mb-8">
                <div className="text-xs tracking-[0.25em] uppercase text-zinc-500 mb-2">
                    Workforce Registry
                </div>
                <h1 className="font-chivo font-black uppercase text-5xl tracking-tight leading-none">
                    Persons
                </h1>
                <p className="text-zinc-400 mt-3 text-sm">
                    {persons.length} total · {details.length} skill columns
                </p>
            </header>

            <div className="flex items-center gap-3 border border-white/10 bg-[#111] px-4 py-3 mb-6 max-w-md">
                <Search className="w-4 h-4 text-zinc-500" />
                <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by name or qualification…"
                    data-testid="persons-search-input"
                    className="bg-transparent border-0 text-white p-0 h-auto focus-visible:ring-0"
                />
            </div>

            {loading ? (
                <div className="text-zinc-500">Loading…</div>
            ) : (
                <div className="border border-white/10">
                    <div className="grid grid-cols-12 px-4 py-3 border-b border-white/10 bg-[#111] text-[10px] uppercase tracking-[0.25em] text-zinc-500">
                        <div className="col-span-1">#</div>
                        <div className="col-span-3">Name</div>
                        <div className="col-span-3">Qualification</div>
                        <div className="col-span-2">Type</div>
                        <div className="col-span-3">Skills</div>
                    </div>
                    {filtered.map((p) => {
                        const skillCount = Object.values(p.skills || {}).filter(Boolean)
                            .length;
                        return (
                            <div
                                key={p.id}
                                className="grid grid-cols-12 px-4 py-3 border-b border-white/5 text-sm hover:bg-white/5"
                                data-testid={`person-row-${p.id}`}
                            >
                                <div className="col-span-1 text-zinc-500 font-mono-ibm">
                                    {p.sn}
                                </div>
                                <div className="col-span-3 font-semibold">
                                    {p.name} {p.surname}
                                </div>
                                <div className="col-span-3 text-zinc-400 text-xs">
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
                                <div className="col-span-3 flex items-center gap-2">
                                    <div className="flex-1 h-1.5 bg-white/10">
                                        <div
                                            className="h-full bg-[#007AFF]"
                                            style={{
                                                width: `${(skillCount / Math.max(details.length, 1)) * 100}%`,
                                            }}
                                        />
                                    </div>
                                    <span className="font-mono-ibm text-xs text-zinc-300">
                                        {skillCount}/{details.length}
                                    </span>
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
