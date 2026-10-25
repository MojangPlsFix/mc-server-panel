import type { ServerState } from "@shared/types";

import { cn } from "@/lib/utils";

export const STATE_META: Record<ServerState, { label: string; dot: string; text: string; pulse: boolean }> = {
  running: { label: "Online", dot: "bg-live", text: "text-live", pulse: true },
  starting: { label: "Starting", dot: "bg-warning", text: "text-warning", pulse: true },
  stopping: { label: "Stopping", dot: "bg-warning", text: "text-warning", pulse: true },
  stopped: { label: "Offline", dot: "bg-muted-foreground/60", text: "text-muted-foreground", pulse: false },
  failed: { label: "Crashed", dot: "bg-destructive", text: "text-destructive", pulse: false },
  unknown: { label: "Unknown", dot: "bg-muted-foreground/40", text: "text-muted-foreground", pulse: false },
};

export function StatusDot({ state, className }: { state: ServerState; className?: string }) {
  const meta = STATE_META[state];
  return (
    <span className={cn("relative inline-flex size-2 shrink-0", className)} aria-hidden>
      {meta.pulse && <span className={cn("absolute inset-0 rounded-full animate-status-pulse", meta.dot)} />}
      <span className={cn("relative inline-flex size-full rounded-full", meta.dot)} />
    </span>
  );
}

export function StatusBadge({ state, className }: { state: ServerState; className?: string }) {
  return (
    <span
      data-testid="server-state"
      data-state={state}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        STATE_META[state].text,
        className,
      )}
    >
      <StatusDot state={state} />
      {STATE_META[state].label}
    </span>
  );
}
