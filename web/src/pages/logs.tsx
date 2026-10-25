import {
  ArrowClockwiseIcon,
  DownloadSimpleIcon,
  FileTextIcon,
  MagnifyingGlassIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { atLeast, groupLogLines, type LogLevel } from "@shared/log-line";
import type { LogContent, LogFileInfo } from "@shared/types";

import { LogView } from "@/components/log-view";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { formatBytes, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

const LINE_LIMITS = [2000, 10_000, 50_000];

export function LogsPage() {
  const [files, setFiles] = useState<LogFileInfo[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<LogContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<LogLevel | "all">("all");
  const [limit, setLimit] = useState(LINE_LIMITS[0] ?? 2000);

  const loadFiles = useCallback(async () => {
    try {
      const list = await api<LogFileInfo[]>("/api/logs");
      setFiles(list);
      setSelected((current) => (current && list.some((f) => f.name === current) ? current : (list[0]?.name ?? null)));
    } catch (err) {
      setError((err as Error).message);
      setFiles([]);
    }
  }, []);

  const loadContent = useCallback(async (name: string, lines: number) => {
    setLoading(true);
    setError(null);
    try {
      setContent(await api<LogContent>(`/api/logs/${encodeURIComponent(name)}?lines=${lines}`));
    } catch (err) {
      setError((err as Error).message);
      setContent(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  useEffect(() => {
    if (selected) void loadContent(selected, limit);
  }, [selected, limit, loadContent]);

  const entries = useMemo(() => {
    const all = groupLogLines(content?.lines ?? []);
    const needle = query.trim().toLowerCase();
    return all.filter(
      (entry) =>
        (level === "all" || atLeast(entry, level)) &&
        (!needle ||
          entry.message.toLowerCase().includes(needle) ||
          entry.continuation.some((line) => line.toLowerCase().includes(needle))),
    );
  }, [content, level, query]);

  return (
    <div className="flex h-full min-h-[520px] flex-col">
      <PageHeader title="Logs" description="Browse the current and archived server logs." />
      <div className="grid min-h-0 flex-1 gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <nav className="min-h-0 overflow-y-auto rounded-xl border lg:max-h-none" aria-label="Log files">
          {files === null ? (
            <div className="flex flex-col gap-2 p-3">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-11" />
              ))}
            </div>
          ) : files.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No log files found.</p>
          ) : (
            <ul className="divide-y">
              {files.map((file) => (
                <li key={file.name}>
                  <button
                    type="button"
                    onClick={() => setSelected(file.name)}
                    data-testid="log-file"
                    aria-current={selected === file.name}
                    className={cn(
                      "flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-accent/50",
                      selected === file.name && "bg-accent",
                    )}
                  >
                    <FileTextIcon size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-mono text-[13px]">{file.name}</span>
                        {file.live && (
                          <span className="rounded-sm bg-live/15 px-1.5 text-[10px] font-medium text-live uppercase">
                            live
                          </span>
                        )}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {formatBytes(file.size)} · {formatRelative(file.modified)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </nav>

        <section className="flex min-h-[420px] min-w-0 flex-col overflow-hidden rounded-xl border">
          <div className="flex flex-wrap items-center gap-2 border-b bg-card p-2">
            <div className="relative min-w-48 flex-1">
              <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search"
                aria-label="Search log"
                className="h-8 pl-8"
              />
            </div>
            <Select value={level} onValueChange={(value) => setLevel(value as LogLevel | "all")}>
              <SelectTrigger size="sm" className="w-32" aria-label="Minimum level">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All levels</SelectItem>
                <SelectItem value="info">Info+</SelectItem>
                <SelectItem value="warn">Warnings+</SelectItem>
                <SelectItem value="error">Errors</SelectItem>
              </SelectContent>
            </Select>
            <Select value={String(limit)} onValueChange={(value) => setLimit(Number(value))}>
              <SelectTrigger size="sm" className="w-44" aria-label="Lines to load">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LINE_LIMITS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    Last {n.toLocaleString()} lines
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Reload"
              disabled={!selected || loading}
              onClick={() => {
                void loadFiles();
                if (selected) void loadContent(selected, limit);
              }}
            >
              <ArrowClockwiseIcon className={cn(loading && "animate-spin")} />
            </Button>
            {selected && (
              <Button variant="ghost" size="icon" className="size-8" aria-label="Download" asChild>
                <a href={`/api/logs/${encodeURIComponent(selected)}/raw`} download>
                  <DownloadSimpleIcon />
                </a>
              </Button>
            )}
          </div>
          {content && (
            <p className="border-b px-4 py-1.5 text-xs text-muted-foreground" data-testid="log-summary">
              {entries.length.toLocaleString()} entries shown
              {content.truncated &&
                ` · last ${content.lines.length.toLocaleString()} of ${content.totalLines.toLocaleString()} lines`}
            </p>
          )}
          {error ? (
            <p role="alert" className="p-4 text-sm text-destructive">
              {error}
            </p>
          ) : loading && !content ? (
            <div className="flex flex-col gap-2 p-4">
              {Array.from({ length: 10 }, (_, i) => (
                <Skeleton key={i} className="h-4" style={{ width: `${55 + ((i * 37) % 40)}%` }} />
              ))}
            </div>
          ) : (
            <LogView
              entries={entries}
              query={query.trim()}
              className="flex-1"
              empty={selected ? "No matching lines." : "Select a log file."}
            />
          )}
        </section>
      </div>
    </div>
  );
}
