import { PaperPlaneRightIcon } from "@phosphor-icons/react";
import { type FormEvent, type KeyboardEvent, useMemo, useState } from "react";
import { toast } from "sonner";

import { atLeast, groupLogLines, type LogLevel } from "@shared/log-line";

import { LogView } from "@/components/log-view";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useLive } from "@/lib/live";
import { cn } from "@/lib/utils";

const HISTORY_KEY = "panel-console-history";
const HISTORY_SIZE = 50;
const FILTERS: { value: LogLevel | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "warn", label: "Warnings" },
  { value: "error", label: "Errors" },
];

function loadHistory(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    return Array.isArray(stored) ? stored.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function ConsolePage() {
  const { status, lines } = useLive();
  const [filter, setFilter] = useState<LogLevel | "all">("all");
  const [command, setCommand] = useState("");
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState(loadHistory);
  const [cursor, setCursor] = useState<number | null>(null);
  const accepting = status?.state === "running" || status?.state === "starting";

  const entries = useMemo(() => {
    const all = groupLogLines(lines);
    return filter === "all" ? all : all.filter((entry) => atLeast(entry, filter));
  }, [lines, filter]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = command.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await api("/api/console", { method: "POST", body: { command: text } });
      const next = [...history.filter((item) => item !== text), text].slice(-HISTORY_SIZE);
      setHistory(next);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      setCommand("");
      setCursor(null);
    } catch (err) {
      toast.error("Command not sent", { description: (err as Error).message });
    } finally {
      setSending(false);
    }
  }

  function browseHistory(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    if (history.length === 0) return;
    event.preventDefault();
    const up = event.key === "ArrowUp";
    const current = cursor ?? history.length;
    const next = Math.min(history.length, Math.max(0, current + (up ? -1 : 1)));
    setCursor(next === history.length ? null : next);
    setCommand(next === history.length ? "" : (history[next] ?? ""));
  }

  return (
    <div className="flex h-full min-h-[480px] flex-col">
      <PageHeader
        title="Console"
        description="Live server output. Commands run as the server console (no leading slash needed)."
        actions={
          <div className="flex rounded-lg border p-0.5" role="group" aria-label="Filter by level">
            {FILTERS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={filter === option.value}
                onClick={() => setFilter(option.value)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs transition-colors",
                  filter === option.value
                    ? "bg-accent font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border">
        <LogView
          entries={entries}
          follow
          className="flex-1"
          empty={
            filter === "all"
              ? "No output yet. Start the server to see its log here."
              : "Nothing at this level."
          }
        />
        <form onSubmit={submit} className="flex items-center gap-2 border-t bg-card p-2">
          <span className="pl-2 font-mono text-sm text-live select-none" aria-hidden>
            &gt;
          </span>
          <Input
            value={command}
            onChange={(event) => {
              setCommand(event.target.value);
              setCursor(null);
            }}
            onKeyDown={browseHistory}
            disabled={!accepting}
            placeholder={accepting ? "Type a command, e.g. list" : "The server is not running"}
            aria-label="Console command"
            autoComplete="off"
            spellCheck={false}
            maxLength={1000}
            className="border-0 bg-transparent font-mono shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <Button type="submit" size="sm" disabled={!accepting || sending || !command.trim()}>
            <PaperPlaneRightIcon />
            Send
          </Button>
        </form>
      </div>
    </div>
  );
}
