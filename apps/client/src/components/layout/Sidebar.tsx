import { NavLink, useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  HardDrive,
  FolderOpen,
  LayoutDashboard,
  Terminal,
  Package,
  Globe,
  Users,
  Settings,
  Plus,
  Server,
  Home,
} from "lucide-react";
import api from "@/lib/api";
import type { ServerConfig } from "@mcservergui/shared";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard", exact: true },
  { to: "console", icon: Terminal, label: "Console" },
  { to: "mods", icon: Package, label: "Mods" },
  { to: "worlds", icon: Globe, label: "Worlds" },
  { to: "files", icon: FolderOpen, label: "Files" },
  { to: "players", icon: Users, label: "Players" },
  { to: "settings", icon: Settings, label: "Settings" },
];

// When a server is selected, Dashboard links to the server dashboard
function getNavTo(item: typeof navItems[0], serverId?: string): string {
  if (item.exact) {
    return serverId ? `/${serverId}` : "/";
  }
  const linkBase = serverId ? `/${serverId}/` : "/";
  return `${linkBase}${item.to}`;
}

export default function Sidebar() {
  const { serverId } = useParams<{ serverId: string }>();
  const navigate = useNavigate();

  const { data: servers } = useQuery<ServerConfig[]>({
    queryKey: ["servers"],
    queryFn: async () => {
      const { data } = await api.get("/servers");
      return data;
    },
  });

  return (
    <aside className="flex h-full w-56 flex-col border-r border-border bg-sidebar-background">
      <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
        <Server className="h-5 w-5 text-sidebar-primary" />
        <span className="font-semibold text-sidebar-foreground">MC Server</span>
      </div>

      {servers && servers.length > 0 && (
        <div className="border-b border-sidebar-border p-2">
          <select
            className="w-full rounded-md border border-sidebar-border bg-sidebar-accent px-2 py-1.5 text-sm text-sidebar-foreground outline-none focus:ring-1 focus:ring-sidebar-ring"
            value={serverId || ""}
            onChange={(e) => {
              if (e.target.value) {
                navigate(`/${e.target.value}`);
              } else {
                navigate("/");
              }
            }}
          >
            <option value="">All Servers</option>
            {servers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="border-t border-sidebar-border p-2">
        <NavLink
          to="/"
          className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
        >
          <Home className="h-4 w-4" />
          Home
        </NavLink>
      </div>

      <nav className="flex flex-1 flex-col gap-1 p-2">
        {navItems.map((item) => {
          const isExact = item.exact;
          const to = getNavTo(item, serverId);
          if (!serverId && !item.exact) return null;

          return (
            <NavLink
              key={item.label}
              to={to}
              end={!!isExact}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? "bg-sidebar-accent text-sidebar-primary"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
                }`
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border p-2 space-y-2">
        <NavLink
          to="/drive"
          className={({ isActive }) =>
            `flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
              isActive
                ? "bg-sidebar-accent text-sidebar-primary"
                : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
            }`
          }
        >
          <HardDrive className="h-4 w-4" />
          Drive Backup
        </NavLink>
        <NavLink
          to="/new"
          className="flex items-center gap-2 rounded-md bg-sidebar-primary px-3 py-2 text-sm font-medium text-sidebar-primary-foreground transition-colors hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          New Server
        </NavLink>
      </div>
    </aside>
  );
}
