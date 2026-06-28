import { NavLink, Outlet } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { Factory, LayoutGrid, Users, Upload, Monitor } from "lucide-react";

const navItems = [
    { to: "/", icon: LayoutGrid, label: "Setup", testid: "nav-setup" },
    { to: "/board", icon: Monitor, label: "Board", testid: "nav-board" },
    { to: "/persons", icon: Users, label: "Persons", testid: "nav-persons" },
    { to: "/upload", icon: Upload, label: "Upload", testid: "nav-upload" },
];

export default function AppLayout() {
    return (
        <div className="min-h-screen bg-[#0a0a0a] text-white flex">
            <aside
                className="w-56 shrink-0 border-r border-white/10 bg-[#0a0a0a] flex flex-col no-print"
                data-testid="app-sidebar"
            >
                <div className="px-6 py-7 border-b border-white/10">
                    <div className="flex items-center gap-3">
                        <Factory className="w-6 h-6 text-[#007AFF]" strokeWidth={2.5} />
                        <div>
                            <div className="font-chivo font-black uppercase tracking-tight text-base leading-none">
                                FFM Ops
                            </div>
                            <div className="text-[10px] tracking-[0.25em] uppercase text-zinc-500 mt-1">
                                Scheduling Board
                            </div>
                        </div>
                    </div>
                </div>
                <nav className="flex-1 py-4">
                    {navItems.map(({ to, icon: Icon, label, testid }) => (
                        <NavLink
                            key={to}
                            to={to}
                            end={to === "/"}
                            data-testid={testid}
                            className={({ isActive }) =>
                                `flex items-center gap-3 px-6 py-3 text-sm font-medium uppercase tracking-wider transition-colors border-l-2 ${
                                    isActive
                                        ? "border-[#007AFF] bg-white/5 text-white"
                                        : "border-transparent text-zinc-400 hover:text-white hover:bg-white/5"
                                }`
                            }
                        >
                            <Icon className="w-4 h-4" strokeWidth={2.25} />
                            {label}
                        </NavLink>
                    ))}
                </nav>
                <div className="px-6 py-4 border-t border-white/10 text-[10px] tracking-[0.2em] uppercase text-zinc-600">
                    v1.0 · Control Room
                </div>
            </aside>
            <main className="flex-1 min-w-0">
                <Outlet />
            </main>
            <Toaster theme="dark" position="top-right" richColors />
        </div>
    );
}
