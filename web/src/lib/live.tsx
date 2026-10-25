import { createContext, type ReactNode, useContext, useEffect, useState } from "react";

import type { StatusSnapshot, WsMessage } from "@shared/types";

import { api, UNAUTHORIZED_EVENT } from "./api";

const MAX_LINES = 2000;

export interface LiveState {
  connected: boolean;
  status: StatusSnapshot | null;
  /** The most recent lines of the server's live log. */
  lines: string[];
  /** Incremented whenever the server started a new log file. */
  logGeneration: number;
}

const INITIAL: LiveState = { connected: false, status: null, lines: [], logGeneration: 0 };
const LiveContext = createContext<LiveState>(INITIAL);

function apply(state: LiveState, message: WsMessage): LiveState {
  switch (message.type) {
    case "hello":
      return { ...state, connected: true, status: message.status, lines: message.lines.slice(-MAX_LINES) };
    case "status":
      return { ...state, status: message.status };
    case "log":
      return { ...state, lines: [...state.lines, ...message.lines].slice(-MAX_LINES) };
    case "log-reset":
      return { ...state, lines: [], logGeneration: state.logGeneration + 1 };
  }
}

/** Keeps one WebSocket to the panel open (with backoff) and shares status and live log lines. */
export function LiveProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LiveState>(INITIAL);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retryTimer: number | undefined;
    let failures = 0;
    let disposed = false;

    const connect = () => {
      const protocol = location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${protocol}://${location.host}/api/ws`);
      socket.onopen = () => {
        failures = 0;
      };
      socket.onmessage = (event: MessageEvent<string>) => {
        // Messages come from our own backend and follow WsMessage.
        const message = JSON.parse(event.data) as WsMessage;
        setState((current) => apply(current, message));
      };
      socket.onclose = () => {
        setState((current) => ({ ...current, connected: false }));
        if (disposed) return;
        failures++;
        // A refused handshake looks like a plain close; check whether the session expired.
        if (failures >= 2) {
          void api<{ authenticated: boolean }>("/api/auth/session").then((session) => {
            if (!session.authenticated) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
          });
        }
        retryTimer = setTimeout(connect, Math.min(10_000, 500 * 2 ** failures));
      };
    };

    connect();
    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      socket?.close();
    };
  }, []);

  return <LiveContext.Provider value={state}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveState {
  return useContext(LiveContext);
}
