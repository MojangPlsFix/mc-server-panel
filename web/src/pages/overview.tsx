import { ArrowRightIcon, WarningIcon } from "@phosphor-icons/react";
import { useMemo } from "react";
import { Link } from "react-router";

import { groupLogLines } from "@shared/log-line";
import type { ServerState, StatusSnapshot } from "@shared/types";

import { LogView } from "@/components/log-view";
import { PlayerList } from "@/components/player-list";
import { ServerControls } from "@/components/server-controls";
import { StatusBadge } from "@/components/status";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes, formatDuration } from "@/lib/format";
import { useLive } from "@/lib/live";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

const SUMMARY: Record<ServerState, string> = {
  running: "Accepting players.",
  starting: "Loading mods and worlds. This can take a few minutes.",
  stopping: "Saving the world and shutting down.",
  stopped: "The server is not running.",
  failed: "The server process ended unexpectedly. Check the console or logs.",
  unknown: "The panel cannot read the server state right now.",
};

export function OverviewPage() {
  const { status, lines } = useLive();
  const recent = useMemo(() => groupLogLines(lines).slice(-14), [lines]);

  if (!status) return <OverviewSkeleton />;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)] lg:gap-8">
      <div className="flex min-w-0 flex-col gap-6 lg:gap-8">
        <StatusPanel status={status} />
        <Resources status={status} />
        <section className="overflow-hidden rounded-xl border">
          <div className="flex items-center justify-between border-b bg-card px-4 py-3">
            <h2 className="text-sm font-medium">Recent console</h2>
            <Link
              to="/console"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              Open console <ArrowRightIcon size={14} />
            </Link>
          </div>
          <LogView entries={recent} follow className="h-72" empty="No log output yet." />
        </section>
      </div>
      <aside className="flex min-w-0 flex-col gap-6">
        <section className="rounded-xl border bg-card p-5">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-medium">Players</h2>
            {status.ping && (
              <span className="font-mono text-sm text-muted-foreground" data-testid="player-count">
                {status.ping.playersOnline}/{status.ping.playersMax}
              </span>
            )}
          </div>
          <PlayerList status={status} />
        </section>
        {status.ping?.motd && (
          <section className="rounded-xl border p-5">
            <h2 className="mb-2 text-sm font-medium">Message of the day</h2>
            <p className="text-sm whitespace-pre-line text-muted-foreground">{status.ping.motd}</p>
          </section>
        )}
      </aside>
    </div>
  );
}

function StatusPanel({ status }: { status: StatusSnapshot }) {
  const now = useNow();
  const alive = status.state === "running" || status.state === "starting" || status.state === "stopping";
  const uptime = alive && status.since ? formatDuration(now - Date.parse(status.since)) : null;
  const stats = [
    { label: "Version", value: status.ping?.version ?? "—" },
    {
      label: "Players",
      value: status.ping ? `${status.ping.playersOnline} / ${status.ping.playersMax}` : "—",
    },
    { label: "Ping", value: status.ping ? `${status.ping.latencyMs} ms` : "—" },
    { label: "Uptime", value: uptime ?? "—" },
  ];

  return (
    <section className="rounded-xl border bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <StatusBadge state={status.state} />
          <h1 className="mt-3 truncate text-2xl font-semibold tracking-tight">{status.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{SUMMARY[status.state]}</p>
        </div>
        <ServerControls status={status} />
      </div>
      {status.error && (
        <p
          role="alert"
          className="mt-5 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <WarningIcon size={16} className="mt-0.5 shrink-0" />
          {status.error}
        </p>
      )}
      <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-t pt-5 sm:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{stat.label}</dt>
            <dd className="mt-1 truncate font-mono text-sm">{stat.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Meter({
  label,
  value,
  detail,
  fraction,
}: {
  label: string;
  value: string;
  detail: string;
  fraction: number | null;
}) {
  return (
    <div className="min-w-0 py-4 first:pt-0 last:pb-0 sm:py-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="font-mono text-sm">{value}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full w-full origin-left rounded-full bg-foreground/70 transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]",
            (fraction ?? 0) > 0.9 && "bg-warning",
          )}
          style={{ transform: `scaleX(${Math.min(1, Math.max(0, fraction ?? 0))})` }}
        />
      </div>
      <p className="mt-1.5 truncate text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function Resources({ status }: { status: StatusSnapshot }) {
  const { process, host } = status;
  const cores = host?.cpuCount ?? 1;
  const cpu = process?.cpuPercent ?? null;
  const memTotal = host?.memTotalBytes ?? null;
  const memUsed = host ? host.memTotalBytes - host.memAvailableBytes : null;

  return (
    <section className="grid divide-y rounded-xl border p-5 sm:grid-cols-2 sm:gap-8 sm:divide-y-0">
      <Meter
        label="CPU"
        value={cpu === null ? "—" : `${(cpu / cores).toFixed(0)}%`}
        fraction={cpu === null ? null : cpu / 100 / cores}
        detail={
          cpu === null
            ? process
              ? "Measuring…"
              : "Server not running"
            : `${(cpu / 100).toFixed(1)} of ${cores} cores`
        }
      />
      <Meter
        label="Memory"
        value={process ? formatBytes(process.rssBytes) : "—"}
        fraction={process && memTotal ? process.rssBytes / memTotal : null}
        detail={
          memTotal && memUsed !== null
            ? `${formatBytes(memUsed)} of ${formatBytes(memTotal)} used on this machine`
            : "Memory information unavailable"
        }
      />
    </section>
  );
}

function OverviewSkeleton() {
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-8">
        <Skeleton className="h-52 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}
