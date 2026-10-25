import {
  MoonIcon,
  ScrollIcon,
  SignOutIcon,
  SquaresFourIcon,
  SunIcon,
  TerminalWindowIcon,
} from "@phosphor-icons/react";
import { NavLink, Outlet } from "react-router";

import { Logo } from "@/components/logo";
import { StatusBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { useLive } from "@/lib/live";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Overview", icon: SquaresFourIcon },
  { to: "/console", label: "Console", icon: TerminalWindowIcon },
  { to: "/logs", label: "Logs", icon: ScrollIcon },
];

export function AppShell({ name, onLogout }: { name: string; onLogout: () => void }) {
  const { status, connected } = useLive();
  const { theme, toggle } = useTheme();
  const state = status?.state ?? "unknown";

  const navLinks = (compact: boolean) =>
    NAV.map(({ to, label, icon: Icon }) => (
      <NavLink
        key={to}
        to={to}
        end={to === "/"}
        className={({ isActive }) =>
          cn(
            "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
            isActive
              ? "bg-accent font-medium text-foreground"
              : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            compact && "shrink-0",
          )
        }
      >
        <Icon size={17} />
        {label}
      </NavLink>
    ));

  return (
    <div className="h-[100dvh] md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="hidden h-[100dvh] flex-col border-r border-sidebar-border bg-sidebar px-3 py-4 md:flex">
        <div className="flex items-center gap-2.5 px-2 pb-6">
          <Logo className="size-8" />
          <div className="min-w-0">
            <p className="truncate text-sm leading-tight font-semibold">{name}</p>
            <p className="text-xs text-muted-foreground">Server panel</p>
          </div>
        </div>
        <nav className="flex flex-col gap-0.5">{navLinks(false)}</nav>
        <div className="mt-auto flex flex-col gap-1 border-t border-sidebar-border pt-3">
          <div className="flex items-center justify-between px-2.5 py-1.5">
            <StatusBadge state={state} />
            <span
              className={cn("text-[11px]", connected ? "text-muted-foreground" : "text-warning")}
              data-testid="connection"
            >
              {connected ? "Live" : "Reconnecting…"}
            </span>
          </div>
          <Button variant="ghost" size="sm" className="justify-start text-muted-foreground" onClick={toggle}>
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="justify-start text-muted-foreground"
            onClick={onLogout}
          >
            <SignOutIcon />
            Log out
          </Button>
        </div>
      </aside>

      <div className="flex h-[100dvh] min-w-0 flex-col">
        <header className="flex flex-col gap-3 border-b px-4 pt-3 pb-2 md:hidden">
          <div className="flex items-center gap-2.5">
            <Logo className="size-7" />
            <p className="min-w-0 flex-1 truncate text-sm font-semibold">{name}</p>
            <StatusBadge state={state} />
            <Button variant="ghost" size="icon" aria-label="Toggle theme" onClick={toggle}>
              {theme === "dark" ? <SunIcon /> : <MoonIcon />}
            </Button>
            <Button variant="ghost" size="icon" aria-label="Log out" onClick={onLogout}>
              <SignOutIcon />
            </Button>
          </div>
          <nav className="-mx-1 flex gap-1 overflow-x-auto">{navLinks(true)}</nav>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex h-full w-full max-w-[1400px] flex-col px-4 py-6 md:px-8 md:py-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
