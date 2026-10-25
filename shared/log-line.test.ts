import { describe, expect, it } from "vitest";

import { atLeast, groupLogLines, parseLogLine } from "./log-line.js";

describe("parseLogLine", () => {
  it("parses Forge/NeoForge lines with logger name", () => {
    expect(
      parseLogLine(
        '[25Oct2026 08:22:19.464] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer/]: Done (0.873s)! For help, type "help"',
      ),
    ).toEqual({
      time: "08:22:19",
      thread: "Server thread",
      level: "info",
      source: "net.minecraft.server.dedicated.DedicatedServer",
      message: 'Done (0.873s)! For help, type "help"',
    });
  });

  it("parses vanilla/Paper lines", () => {
    expect(parseLogLine("[12:01:02] [Server thread/WARN]: Can't keep up!")).toEqual({
      time: "12:01:02",
      thread: "Server thread",
      level: "warn",
      source: null,
      message: "Can't keep up!",
    });
  });

  it("keeps thread names that contain slashes or numbers", () => {
    expect(parseLogLine("[25Oct2026 08:00:01.000] [Worker-Main-12/ERROR] [mixin/]: boom")?.thread).toBe(
      "Worker-Main-12",
    );
  });

  it("returns null for continuation lines", () => {
    expect(parseLogLine("\tat net.minecraft.Foo.bar(Foo.java:1)")).toBeNull();
    expect(parseLogLine("")).toBeNull();
  });
});

describe("groupLogLines", () => {
  it("attaches stack traces to the entry before them", () => {
    const entries = groupLogLines([
      "[25Oct2026 08:00:00.000] [main/ERROR] [x/]: failed",
      "java.lang.IllegalStateException: nope",
      "\tat a.b.C.d(C.java:1)",
      "[25Oct2026 08:00:01.000] [main/INFO] [x/]: next",
    ]);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.continuation).toEqual([
      "java.lang.IllegalStateException: nope",
      "\tat a.b.C.d(C.java:1)",
    ]);
    expect(entries[1]?.message).toBe("next");
  });

  it("keeps leading header-less lines as their own entry", () => {
    const [entry] = groupLogLines(["no header here"]);
    expect(entry).toMatchObject({ level: null, message: "no header here", continuation: [] });
  });
});

describe("atLeast", () => {
  it("compares severities", () => {
    expect(atLeast({ level: "error" }, "warn")).toBe(true);
    expect(atLeast({ level: "warn" }, "warn")).toBe(true);
    expect(atLeast({ level: "info" }, "warn")).toBe(false);
    expect(atLeast({ level: null }, "trace")).toBe(false);
  });
});
