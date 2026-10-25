import type { Exec } from "./exec.js";

/** One tmux session, driven through the tmux CLI (no shell involved). */
export class TmuxSession {
  constructor(
    private readonly exec: Exec,
    readonly name: string,
    private readonly socket?: string,
  ) {}

  private run(args: string[]) {
    return this.exec("tmux", this.socket ? ["-S", this.socket, ...args] : args);
  }

  // "=" makes tmux match the session name exactly instead of by prefix.
  private get target() {
    return `=${this.name}`;
  }

  async exists(): Promise<boolean> {
    return (await this.run(["has-session", "-t", this.target])).code === 0;
  }

  async create(directory: string, command: string): Promise<void> {
    const result = await this.run(["new-session", "-d", "-s", this.name, "-c", directory, command]);
    if (result.code !== 0)
      throw new Error(result.stderr.trim() || `tmux new-session exited with ${result.code}`);
  }

  /**
   * Types `text` literally into the session's active pane and presses Enter, as one tmux command:
   * text and Enter sent separately let concurrent senders slip in between and merge lines.
   * "\r" is the byte tmux sends for its Enter key.
   */
  async sendLine(text: string): Promise<void> {
    const result = await this.run(["send-keys", "-t", `${this.target}:`, "-l", "--", `${text}\r`]);
    if (result.code !== 0)
      throw new Error(result.stderr.trim() || `tmux send-keys exited with ${result.code}`);
  }

  /** PID of the process running in the session's first pane. */
  async panePid(): Promise<number | null> {
    const result = await this.run(["list-panes", "-t", this.target, "-F", "#{pane_pid}"]);
    const pid = Number.parseInt(result.stdout.split("\n")[0] ?? "", 10);
    return result.code === 0 && Number.isFinite(pid) ? pid : null;
  }

  async createdAt(): Promise<Date | null> {
    // display-message takes a pane target; the bare "=name" form silently prints nothing.
    const result = await this.run(["display-message", "-p", "-t", `${this.target}:`, "#{session_created}"]);
    const seconds = Number.parseInt(result.stdout.trim(), 10);
    return result.code === 0 && Number.isFinite(seconds) ? new Date(seconds * 1000) : null;
  }

  async kill(): Promise<void> {
    await this.run(["kill-session", "-t", this.target]);
  }
}
