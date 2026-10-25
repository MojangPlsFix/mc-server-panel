import { ArrowClockwiseIcon, CircleNotchIcon, PlayIcon, StopIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";

import type { ServerAction, StatusSnapshot } from "@shared/types";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

const PENDING_LABEL: Record<ServerAction, string> = {
  start: "Starting…",
  stop: "Stopping…",
  restart: "Restarting…",
};

const CONFIRM: Record<"stop" | "restart", { title: string; body: string; action: string }> = {
  stop: {
    title: "Stop the server?",
    body: "Players are disconnected. The server saves the world and shuts down.",
    action: "Stop server",
  },
  restart: {
    title: "Restart the server?",
    body: "Players are disconnected while the server stops and starts again.",
    action: "Restart",
  },
};

export function ServerControls({ status }: { status: StatusSnapshot | null }) {
  const [sending, setSending] = useState<ServerAction | null>(null);
  const state = status?.state ?? "unknown";
  const busy = sending ?? status?.pending ?? null;

  async function run(action: ServerAction) {
    setSending(action);
    try {
      await api(`/api/server/${action}`, { method: "POST" });
    } catch (err) {
      toast.error(`Could not ${action} the server`, { description: (err as Error).message });
    } finally {
      setSending(null);
    }
  }

  if (busy) {
    return (
      <Button disabled variant="outline" className="min-w-36">
        <CircleNotchIcon className="animate-spin" />
        {PENDING_LABEL[busy]}
      </Button>
    );
  }

  if (state === "stopped" || state === "failed") {
    return (
      <Button onClick={() => run("start")} className="min-w-36 active:scale-[0.98]">
        <PlayIcon weight="fill" />
        Start server
      </Button>
    );
  }

  if (state !== "running" && state !== "starting") return null;

  return (
    <div className="flex flex-wrap gap-2">
      {(["restart", "stop"] as const).map((action) => (
        <AlertDialog key={action}>
          <AlertDialogTrigger asChild>
            <Button
              variant={action === "stop" ? "destructive" : "outline"}
              className="min-w-28 active:scale-[0.98]"
            >
              {action === "stop" ? <StopIcon weight="fill" /> : <ArrowClockwiseIcon />}
              {action === "stop" ? "Stop" : "Restart"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{CONFIRM[action].title}</AlertDialogTitle>
              <AlertDialogDescription>{CONFIRM[action].body}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => run(action)}
                variant={action === "stop" ? "destructive" : "default"}
              >
                {CONFIRM[action].action}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ))}
    </div>
  );
}
