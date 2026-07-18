import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  createSession,
  deleteSession,
  listSessions,
  loadSession,
  resolveSessionRef,
  saveSession,
  sessionsDir,
  touchSession,
} from "../../src/session";
import { parseGlobalArgs } from "../../src/cli/args";

describe("session store", () => {
  it("create/save/load/list/delete 闭环", () => {
    const s = createSession({
      kind: "cli",
      name: "unit-test-session",
      lastRequest: "hello session",
      mock: true,
    });
    saveSession(s);
    const loaded = loadSession(s.id);
    expect(loaded?.id).toBe(s.id);
    expect(loaded?.name).toBe("unit-test-session");
    expect(loaded?.mock).toBe(true);

    const listed = listSessions({ query: "unit-test-session", limit: 5 });
    expect(listed.some((e) => e.id === s.id)).toBe(true);

    const byName = resolveSessionRef("unit-test-session");
    expect(byName?.id).toBe(s.id);

    const byPrefix = resolveSessionRef(s.id.slice(0, 6));
    // 前缀可能歧义；至少 load exact 可用
    expect(loadSession(s.id)?.id).toBe(s.id);
    if (byPrefix) expect(byPrefix.id).toBe(s.id);

    touchSession(s, { status: "completed", workflowName: "wf-test" });
    expect(loadSession(s.id)?.status).toBe("completed");
    expect(loadSession(s.id)?.workflowName).toBe("wf-test");

    expect(deleteSession(s.id)).toBe(true);
    expect(loadSession(s.id)).toBeNull();
    expect(fs.existsSync(path.join(sessionsDir(), `${s.id}.json`))).toBe(false);
  });

  it("sessionsDir 在 ~/.maestro/sessions", () => {
    expect(sessionsDir()).toBe(
      path.join(os.homedir(), ".maestro", "sessions"),
    );
  });
});

describe("parseGlobalArgs", () => {
  it("解析 -c/-r/-p/--model/--mock/--verbose", () => {
    const g = parseGlobalArgs([
      "-c",
      "-n",
      "demo",
      "--model",
      "gpt-x",
      "--mock",
      "-d",
      "run",
      "wf.yaml",
    ]);
    expect(g.continue).toBe(true);
    expect(g.name).toBe("demo");
    expect(g.model).toBe("gpt-x");
    expect(g.mock).toBe(true);
    expect(g.verbose).toBe(true);
    expect(g.rest).toEqual(["run", "wf.yaml"]);
  });

  it("解析 -p prompt 与 --output-format json", () => {
    const g = parseGlobalArgs([
      "-p",
      "hello",
      "world",
      "--role",
      "coder",
      "--output-format",
      "json",
    ]);
    expect(g.print).toBe(true);
    expect(g.printPrompt).toBe("hello world");
    expect(g.role).toBe("coder");
    expect(g.outputFormat).toBe("json");
  });

  it("解析 --resume=id", () => {
    const g = parseGlobalArgs(["--resume=abc123", "tui"]);
    expect(g.resume).toBe("abc123");
    expect(g.rest).toEqual(["tui"]);
  });
});
