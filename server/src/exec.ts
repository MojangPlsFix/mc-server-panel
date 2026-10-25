import { execFile } from "node:child_process";

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs a program without a shell. Never rejects on a non-zero exit; check `code`. */
export type Exec = (file: string, args: readonly string[]) => Promise<ExecResult>;

export const exec: Exec = (file, args) => {
  const { promise, resolve } = Promise.withResolvers<ExecResult>();
  execFile(file, [...args], { timeout: 15_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
    const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
    resolve({ code, stdout: String(stdout), stderr: String(stderr || (error && !stderr ? error.message : "")) });
  });
  return promise;
};
