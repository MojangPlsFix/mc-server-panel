import { ArrowDownIcon } from "@phosphor-icons/react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

import type { LogEntry, LogLevel } from "@shared/log-line";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const LEVEL_CLASS: Record<LogLevel, string> = {
  trace: "text-muted-foreground/60",
  debug: "text-muted-foreground/60",
  info: "text-muted-foreground",
  warn: "text-warning",
  error: "text-destructive",
  fatal: "text-destructive",
};

function highlight(text: string, query: string): ReactNode {
  if (!query) return text;
  const parts: ReactNode[] = [];
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  let from = 0;
  for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, from)) {
    parts.push(text.slice(from, at));
    parts.push(
      <mark key={at} className="rounded-sm bg-live/25 text-foreground">
        {text.slice(at, at + needle.length)}
      </mark>,
    );
    from = at + needle.length;
  }
  parts.push(text.slice(from));
  return parts;
}

interface LogViewProps {
  entries: LogEntry[];
  /** Keep scrolled to the newest line while the user is at the bottom. */
  follow?: boolean;
  query?: string;
  empty: ReactNode;
  className?: string;
}

export function LogView({ entries, follow = false, query = "", empty, className }: LogViewProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (follow && pinned && el) el.scrollTop = el.scrollHeight;
  }, [entries, follow, pinned]);

  return (
    <div className={cn("relative min-h-0", className)}>
      <div
        ref={scroller}
        data-testid="log-view"
        onScroll={(event) => {
          const el = event.currentTarget;
          setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 48);
        }}
        className="h-full overflow-y-auto bg-terminal py-3 font-mono text-[12.5px] leading-[1.6]"
      >
        {entries.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6 font-sans text-sm text-muted-foreground">
            {empty}
          </div>
        ) : (
          entries.map((entry, index) => (
            <div
              key={index}
              data-testid="log-line"
              data-level={entry.level ?? "none"}
              title={[entry.thread, entry.source].filter(Boolean).join(" · ") || undefined}
              className={cn(
                "grid grid-cols-[4.75rem_3.25rem_minmax(0,1fr)] gap-x-2 px-4 hover:bg-foreground/[0.03]",
                (entry.level === "error" || entry.level === "fatal") && "bg-destructive/[0.06]",
              )}
            >
              <span className="text-muted-foreground/55 tabular-nums">{entry.time ?? ""}</span>
              <span className={cn("text-[11px] font-medium uppercase", entry.level && LEVEL_CLASS[entry.level])}>
                {entry.level ?? ""}
              </span>
              <span className="whitespace-pre-wrap break-words">
                {highlight(entry.message, query)}
                {entry.continuation.length > 0 && (
                  <span className="block text-muted-foreground">
                    {highlight(entry.continuation.join("\n"), query)}
                  </span>
                )}
              </span>
            </div>
          ))
        )}
      </div>
      {follow && !pinned && entries.length > 0 && (
        <Button
          size="sm"
          variant="secondary"
          className="absolute right-4 bottom-4 shadow-lg active:scale-[0.98]"
          onClick={() => setPinned(true)}
        >
          <ArrowDownIcon />
          Jump to latest
        </Button>
      )}
    </div>
  );
}
