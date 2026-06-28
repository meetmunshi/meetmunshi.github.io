import { useState, useEffect } from "react";
import { toast } from "sonner";
import { uploadExcel, fetchStats } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { UploadCloud, FileSpreadsheet, CheckCircle2 } from "lucide-react";

export default function UploadPage() {
    const [file, setFile] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [stats, setStats] = useState(null);

    const refresh = () => fetchStats().then(setStats);
    useEffect(() => {
        refresh();
    }, []);

    const handleUpload = async () => {
        if (!file) return;
        setUploading(true);
        try {
            const result = await uploadExcel(file);
            toast.success(`Imported ${result.persons} persons, ${result.details} details`);
            setFile(null);
            refresh();
        } catch (e) {
            toast.error("Upload failed: " + (e.response?.data?.detail || e.message));
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className="p-8 max-w-3xl">
            <header className="mb-8">
                <div className="text-xs tracking-[0.25em] uppercase text-zinc-500 mb-2">
                    Data Management
                </div>
                <h1 className="font-chivo font-black uppercase text-5xl tracking-tight leading-none">
                    Upload Skill Matrix
                </h1>
                <p className="text-zinc-400 mt-3 text-sm max-w-xl">
                    Drop in a new Excel file with the same structure (sheets:{" "}
                    <code className="text-white">person - skill</code> and{" "}
                    <code className="text-white">assembly line</code>). Existing data
                    will be replaced.
                </p>
            </header>

            {stats && (
                <div className="grid grid-cols-4 gap-px bg-white/10 border border-white/10 mb-8">
                    <StatBox label="Persons" value={stats.persons} />
                    <StatBox label="Details" value={stats.details} />
                    <StatBox label="Lines" value={stats.lines} />
                    <StatBox label="Saved Schedules" value={stats.schedules} />
                </div>
            )}

            <label
                htmlFor="excel-file"
                className="block border-2 border-dashed border-white/15 bg-[#111] hover:bg-white/5 transition p-12 text-center cursor-pointer"
                data-testid="upload-dropzone"
            >
                <UploadCloud className="w-12 h-12 mx-auto text-zinc-500 mb-4" />
                <div className="font-chivo font-bold uppercase tracking-tight text-xl">
                    {file ? file.name : "Click to choose .xlsx"}
                </div>
                <div className="text-zinc-500 text-xs uppercase tracking-widest mt-2">
                    Replaces all persons + lines
                </div>
                <input
                    type="file"
                    id="excel-file"
                    data-testid="excel-file-input"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
            </label>

            {file && (
                <div className="border border-white/10 bg-[#111] px-4 py-3 mt-4 flex items-center gap-3">
                    <FileSpreadsheet className="w-5 h-5 text-[#34C759]" />
                    <div className="flex-1">
                        <div className="text-sm font-semibold">{file.name}</div>
                        <div className="text-xs text-zinc-500">
                            {(file.size / 1024).toFixed(1)} KB
                        </div>
                    </div>
                    <Button
                        onClick={handleUpload}
                        disabled={uploading}
                        data-testid="upload-confirm-btn"
                        className="rounded-none bg-[#007AFF] hover:bg-[#007AFF]/85 uppercase tracking-widest"
                    >
                        <CheckCircle2 className="w-4 h-4 mr-2" />
                        {uploading ? "Importing…" : "Import"}
                    </Button>
                </div>
            )}
        </div>
    );
}

function StatBox({ label, value }) {
    return (
        <div className="bg-[#0a0a0a] px-5 py-4">
            <div className="text-[10px] uppercase tracking-[0.25em] text-zinc-500">
                {label}
            </div>
            <div className="font-chivo font-black text-3xl mt-1">{value}</div>
        </div>
    );
}
