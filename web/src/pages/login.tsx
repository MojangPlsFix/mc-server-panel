import { CircleNotchIcon, LockKeyIcon } from "@phosphor-icons/react";
import { type FormEvent, useState } from "react";

import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";

export function LoginPage({ name, onLoggedIn }: { name: string; onLoggedIn: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api("/api/auth/login", { method: "POST", body: { password } });
      onLoggedIn();
    } catch (err) {
      setError((err as Error).message);
      setPassword("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid min-h-[100dvh] lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <div className="relative hidden overflow-hidden border-r border-sidebar-border bg-sidebar lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.35] [background-image:linear-gradient(var(--border)_1px,transparent_1px),linear-gradient(90deg,var(--border)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(ellipse_at_30%_40%,black,transparent_70%)]"
        />
        <div className="relative flex items-center gap-3">
          <Logo className="size-9" />
          <span className="text-sm font-medium text-muted-foreground">Server panel</span>
        </div>
        <div className="relative max-w-md">
          <h1 className="text-4xl leading-none font-semibold tracking-tighter">{name}</h1>
          <p className="mt-4 max-w-[46ch] text-base leading-relaxed text-muted-foreground">
            Start and stop the server, follow the console, read the logs and see who is online.
          </p>
        </div>
      </div>

      <div className="flex items-center px-6 py-12 sm:px-12">
        <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-6">
          <div className="flex items-center gap-3 lg:hidden">
            <Logo className="size-9" />
            <span className="truncate text-lg font-semibold">{name}</span>
          </div>
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Sign in</h2>
            <p className="mt-1 text-sm text-muted-foreground">Enter the panel password to continue.</p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              autoFocus
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "password-error" : "password-help"}
            />
            {error ? (
              <p id="password-error" role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : (
              <p id="password-help" className="text-xs text-muted-foreground">
                Set on the server with <code className="font-mono">node server.js set-password</code>.
              </p>
            )}
          </div>
          <Button type="submit" disabled={submitting || !password} className="active:scale-[0.98]">
            {submitting ? <CircleNotchIcon className="animate-spin" /> : <LockKeyIcon />}
            Sign in
          </Button>
        </form>
      </div>
    </div>
  );
}
