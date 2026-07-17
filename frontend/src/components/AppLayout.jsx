import { NavLink, Outlet, useSearchParams } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import {
    LayoutGrid,
    Users,
    Upload,
    Monitor,
    BarChart3,
    CalendarDays,
    Flame,
} from "lucide-react";

const navItems = [
    { to: "/", icon: LayoutGrid, label: "Setup", testid: "nav-setup" },
    { to: "/board", icon: Monitor, label: "Board", testid: "nav-board" },
    { to: "/history", icon: CalendarDays, label: "History", testid: "nav-history" },
    { to: "/analytics", icon: BarChart3, label: "Analytics", testid: "nav-analytics" },
    { to: "/heatmap", icon: Flame, label: "Heatmap", testid: "nav-heatmap" },
    { to: "/persons", icon: Users, label: "Persons", testid: "nav-persons" },
    { to: "/upload", icon: Upload, label: "Upload", testid: "nav-upload" },
];

export default function AppLayout() {
    const [params] = useSearchParams();
    const tv = params.get("tv") === "1";
    return (
        <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col md:flex-row">
            {!tv && (
            <aside
                className="w-full md:w-56 md:shrink-0 border-b md:border-b-0 md:border-r border-white/10 bg-[#0a0a0a] flex md:flex-col no-print overflow-x-auto md:overflow-visible"
                data-testid="app-sidebar"
            >
                <div className="px-5 py-4 md:py-5 border-r md:border-r-0 md:border-b border-white/10 shrink-0 bg-gradient-to-b from-[#0a2a5e] to-[#0a1a3e]">
                    <div className="flex items-center gap-3">
                        <img
                            src="/logo/ffm-logo.png"
                            alt="Fast & Fluid"
                            className="h-10 w-auto"
                            data-testid="brand-logo"
                        />
                        <div className="hidden md:block">
                            <div className="text-[10px] tracking-[0.25em] uppercase text-white/70">
                                Scheduling
                            </div>
                            <div className="text-[9px] tracking-[0.2em] uppercase text-white/40 mt-0.5">
                                Control Room v2
                            </div>
                        </div>
                    </div>
                </div>
                <nav className="flex md:flex-col md:py-4 md:flex-1">
                    {navItems.map(({ to, icon: Icon, label, testid }) => (
                        <NavLink
                            key={to}
                            to={to}
                            end={to === "/"}
                            data-testid={testid}
                            className={({ isActive }) =>
                                `flex items-center gap-3 px-6 py-3 text-sm font-medium uppercase tracking-wider transition-colors md:border-l-2 border-b-2 md:border-b-0 whitespace-nowrap ${
                                    isActive
                                        ? "md:border-l-[#3B6AB8] border-b-[#3B6AB8] bg-white/5 text-white"
                                        : "md:border-l-transparent border-b-transparent text-zinc-400 hover:text-white hover:bg-white/5"
                                }`
                            }
                        >
                            <Icon className="w-4 h-4" strokeWidth={2.25} />
                            {label}
                        </NavLink>
                    ))}
                </nav>
                <div className="hidden md:block px-6 py-4 border-t border-white/10 text-[10px] tracking-[0.2em] uppercase text-zinc-600">
                    v2.0 · Control Room
                </div>
            </aside>
            )}
            <main className="flex-1 min-w-0">
                <Outlet />
            </main>
            <Toaster theme="dark" position="top-right" richColors />
        </div>
    );
}
