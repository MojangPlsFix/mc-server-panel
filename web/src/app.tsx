import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";

import { AppShell } from "@/components/app-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { api, UNAUTHORIZED_EVENT } from "@/lib/api";
import { LiveProvider } from "@/lib/live";
import { ThemeProvider } from "@/lib/theme";
import { ConsolePage } from "@/pages/console";
import { LoginPage } from "@/pages/login";
import { LogsPage } from "@/pages/logs";
import { OverviewPage } from "@/pages/overview";

type Session = { state: "loading" } | { state: "signed-in" | "signed-out"; name: string };

export function App() {
  const [session, setSession] = useState<Session>({ state: "loading" });

  useEffect(() => {
    api<{ authenticated: boolean; name: string }>("/api/auth/session")
      .then(({ authenticated, name }) => setSession({ state: authenticated ? "signed-in" : "signed-out", name }))
      .catch(() => setSession({ state: "signed-out", name: "Minecraft" }));
    const onUnauthorized = () =>
      setSession((current) => ({ state: "signed-out", name: "name" in current ? current.name : "Minecraft" }));
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  useEffect(() => {
    if (session.state !== "loading") document.title = `${session.name} · Server panel`;
  }, [session]);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setSession((current) => ({ state: "signed-out", name: "name" in current ? current.name : "Minecraft" }));
  }

  return (
    <ThemeProvider>
      <TooltipProvider>
        {session.state === "loading" ? (
          <div className="grid min-h-[100dvh] md:grid-cols-[15rem_1fr]">
            <Skeleton className="hidden rounded-none md:block" />
            <div className="p-8">
              <Skeleton className="h-52 max-w-3xl rounded-xl" />
            </div>
          </div>
        ) : session.state === "signed-out" ? (
          <LoginPage name={session.name} onLoggedIn={() => setSession({ state: "signed-in", name: session.name })} />
        ) : (
          <LiveProvider>
            <BrowserRouter>
              <Routes>
                <Route element={<AppShell name={session.name} onLogout={logout} />}>
                  <Route index element={<OverviewPage />} />
                  <Route path="console" element={<ConsolePage />} />
                  <Route path="logs" element={<LogsPage />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Route>
              </Routes>
            </BrowserRouter>
          </LiveProvider>
        )}
        <Toaster position="bottom-right" />
      </TooltipProvider>
    </ThemeProvider>
  );
}
