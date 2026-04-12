import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  ArrowLeftRight,
  Eye,
  Brain,
  FlaskConical,
  Landmark,
  FileText,
  Settings,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/trades", label: "Trades", icon: ArrowLeftRight },
  { to: "/watchlist", label: "Watchlist", icon: Eye },
  { to: "/strategies", label: "Strategies", icon: Brain },
  { to: "/backtest", label: "Backtest", icon: FlaskConical },
  { to: "/capitol-trades", label: "Capitol Trades", icon: Landmark },
  { to: "/transcripts", label: "Transcripts", icon: FileText },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function Sidebar() {
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;

  return (
    <aside className="flex h-screen w-60 flex-col border-r bg-card">
      <div className="flex h-14 items-center border-b px-4">
        <ArrowLeftRight className="mr-2 h-5 w-5 text-emerald-400" />
        <span className="text-lg font-bold tracking-tight">Scalper</span>
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {/* Extended Hours Gaps - primary pre-market action */}
        <Link
          to="/gap-scanner"
          className={cn(
            "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-semibold transition-colors",
            currentPath.startsWith("/gap-scanner")
              ? "bg-emerald-500/15 text-emerald-400"
              : "text-emerald-400/80 hover:bg-emerald-500/10 hover:text-emerald-400"
          )}
        >
          <TrendingUp className="h-4.5 w-4.5" />
          Extended Hours Gaps
        </Link>
        <div className="my-2 border-t border-border/50" />
        {navItems.map((item) => {
          const isActive =
            item.to === "/"
              ? currentPath === "/"
              : currentPath.startsWith(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t p-4">
        <p className="text-xs text-muted-foreground">Paper Trading Mode</p>
      </div>
    </aside>
  );
}
