/**
 * 权限模式单元测试
 */

import { describe, expect, it } from "bun:test";
import {
  PermissionPolicy,
  decidePermission,
  normalizePermissionMode,
  parsePermissionMode,
  toolRisk,
} from "../../src/permissions";
import { ToolRegistry } from "../../src/tools";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("permission policy pure", () => {
  it("parse aliases", () => {
    expect(parsePermissionMode("plan")).toBe("plan");
    expect(parsePermissionMode("accept-edits")).toBe("accept-edits");
    expect(parsePermissionMode("acceptEdits")).toBe("accept-edits");
    expect(parsePermissionMode("bypass")).toBe("auto");
    expect(parsePermissionMode("nope")).toBeUndefined();
    expect(normalizePermissionMode("nope", "default")).toBe("default");
  });

  it("tool risk map", () => {
    expect(toolRisk("read_file")).toBe("read");
    expect(toolRisk("list_dir")).toBe("read");
    expect(toolRisk("write_file")).toBe("write");
    expect(toolRisk("run_cmd")).toBe("exec");
    expect(toolRisk("unknown_x")).toBe("exec");
  });

  it("decidePermission matrix", () => {
    expect(decidePermission("plan", "read")).toBe("allow");
    expect(decidePermission("plan", "write")).toBe("deny");
    expect(decidePermission("plan", "exec")).toBe("deny");

    expect(decidePermission("default", "read")).toBe("allow");
    expect(decidePermission("default", "write")).toBe("ask");
    expect(decidePermission("default", "exec")).toBe("ask");

    expect(decidePermission("accept-edits", "write")).toBe("allow");
    expect(decidePermission("accept-edits", "exec")).toBe("ask");

    expect(decidePermission("auto", "exec")).toBe("allow");
  });
});

describe("PermissionPolicy.check", () => {
  it("plan denies write", async () => {
    const p = new PermissionPolicy({ mode: "plan" });
    const r = await p.check("write_file", { path: "a.ts", content: "x" });
    expect(r.allowed).toBe(false);
    expect(r.decision).toBe("deny");
  });

  it("default without ask denies write", async () => {
    const p = new PermissionPolicy({ mode: "default" });
    const r = await p.check("write_file", { path: "a.ts", content: "x" });
    expect(r.allowed).toBe(false);
    expect(r.decision).toBe("ask");
  });

  it("default with ask allow", async () => {
    const p = new PermissionPolicy({
      mode: "default",
      ask: async () => true,
    });
    const r = await p.check("write_file", { path: "a.ts", content: "x" });
    expect(r.allowed).toBe(true);
  });

  it("auto allows exec", async () => {
    const p = new PermissionPolicy({ mode: "auto" });
    const r = await p.check("run_cmd", { command: "echo", args: "hi" });
    expect(r.allowed).toBe(true);
  });
});

describe("ToolRegistry permission gate", () => {
  it("blocks write_file under plan", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-perm-"));
    const reg = new ToolRegistry(true);
    const policy = new PermissionPolicy({ mode: "plan" });
    const result = await reg.execute(
      {
        name: "write_file",
        arguments: { path: "x.txt", content: "nope" },
      },
      {
        cwd: tmp,
        workspaceRoot: tmp,
        permissions: {
          check: (tool, args) => policy.check(tool, args),
        },
      },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/权限拒绝/);
    expect(fs.existsSync(path.join(tmp, "x.txt"))).toBe(false);
  });

  it("allows read_file under plan", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-perm-"));
    fs.writeFileSync(path.join(tmp, "r.txt"), "hello", "utf-8");
    const reg = new ToolRegistry(true);
    const policy = new PermissionPolicy({ mode: "plan" });
    const result = await reg.execute(
      { name: "read_file", arguments: { path: "r.txt" } },
      {
        cwd: tmp,
        workspaceRoot: tmp,
        permissions: {
          check: (tool, args) => policy.check(tool, args),
        },
      },
    );
    expect(result.ok).toBe(true);
    expect(result.content).toBe("hello");
  });
});
