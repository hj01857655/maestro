/**
 * 权限模式单元测试
 */

import { describe, expect, it } from "bun:test";
import {
  PermissionPolicy,
  decidePermission,
  mergePermissionRules,
  normalizePermissionMode,
  parsePermissionMode,
  pathMatchesRule,
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

  it("pathMatchesRule prefix", () => {
    expect(pathMatchesRule("src/a.ts", "src")).toBe(true);
    expect(pathMatchesRule("src/a.ts", "src/")).toBe(true);
    expect(pathMatchesRule("src/a.ts", "src/*")).toBe(true);
    expect(pathMatchesRule("lib/a.ts", "src")).toBe(false);
  });

  it("mergePermissionRules uniq", () => {
    const m = mergePermissionRules(
      { alwaysAllowTools: ["write_file"] },
      { alwaysAllowTools: ["Write_File", "run_cmd"] },
    );
    expect(m.alwaysAllowTools).toEqual(["write_file", "run_cmd"]);
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

  it("always tool skips ask under default", async () => {
    const p = new PermissionPolicy({
      mode: "default",
      rules: { alwaysAllowTools: ["write_file"] },
    });
    const r = await p.check("write_file", { path: "a.ts", content: "x" });
    expect(r.allowed).toBe(true);
    expect(r.matched).toMatch(/always-tool/);
  });

  it("always path skips ask", async () => {
    const p = new PermissionPolicy({
      mode: "default",
      rules: { alwaysAllowPaths: ["src/"] },
    });
    const r = await p.check("write_file", {
      path: "src/foo.ts",
      content: "x",
    });
    expect(r.allowed).toBe(true);
    expect(r.matched).toMatch(/always-path/);
  });

  it("always command skips ask under accept-edits", async () => {
    const p = new PermissionPolicy({
      mode: "accept-edits",
      rules: { alwaysAllowCommands: ["bun"] },
    });
    const r = await p.check("run_cmd", { command: "bun", args: "test" });
    expect(r.allowed).toBe(true);
    expect(r.matched).toMatch(/always-cmd/);
  });

  it("plan still denies write even with always tool", async () => {
    const p = new PermissionPolicy({
      mode: "plan",
      rules: { alwaysAllowTools: ["write_file"] },
    });
    const r = await p.check("write_file", { path: "a.ts", content: "x" });
    expect(r.allowed).toBe(false);
    expect(r.decision).toBe("deny");
  });

  it("denied path hard-blocks even in auto", async () => {
    const p = new PermissionPolicy({
      mode: "auto",
      rules: { deniedPaths: [".env", "secrets/"] },
    });
    const r = await p.check("read_file", { path: "secrets/key.txt" });
    expect(r.allowed).toBe(false);
    expect(r.matched).toMatch(/deny-path/);
  });

  it("denied command hard-blocks even in auto", async () => {
    const p = new PermissionPolicy({
      mode: "auto",
      rules: { deniedCommands: ["rm"] },
    });
    const r = await p.check("run_cmd", { command: "rm", args: "-rf /" });
    expect(r.allowed).toBe(false);
    expect(r.matched).toMatch(/deny-cmd/);
  });

  it("session rememberTool after ask always", async () => {
    let asks = 0;
    const p = new PermissionPolicy({
      mode: "default",
      ask: async () => {
        asks++;
        return { allow: true, remember: "tool" };
      },
    });
    const r1 = await p.check("write_file", { path: "a.ts", content: "1" });
    expect(r1.allowed).toBe(true);
    expect(asks).toBe(1);
    const r2 = await p.check("write_file", { path: "b.ts", content: "2" });
    expect(r2.allowed).toBe(true);
    expect(r2.matched).toMatch(/always-tool/);
    expect(asks).toBe(1);
  });

  it("session rememberPath after ask", async () => {
    let asks = 0;
    const p = new PermissionPolicy({
      mode: "default",
      ask: async () => {
        asks++;
        return { allow: true, remember: "path" };
      },
    });
    await p.check("write_file", { path: "src/a.ts", content: "1" });
    expect(asks).toBe(1);
    const r2 = await p.check("write_file", {
      path: "src/b.ts",
      content: "2",
    });
    // path remember stores exact path src/a.ts, not prefix — second different path still asks
    // unless path is same prefix match: rememberPath uses exact path rule which matches children only if prefix
    // src/a.ts as rule: pathMatchesRule("src/b.ts", "src/a.ts") is false
    expect(r2.allowed).toBe(true); // will ask again
    expect(asks).toBe(2);

    // same path auto
    const r3 = await p.check("write_file", {
      path: "src/a.ts",
      content: "3",
    });
    expect(r3.allowed).toBe(true);
    expect(asks).toBe(2);
    expect(r3.matched).toMatch(/always-path/);
  });

  it("clearSessionRules drops always", async () => {
    let asks = 0;
    const p = new PermissionPolicy({
      mode: "default",
      ask: async () => {
        asks++;
        return { allow: true, remember: "tool" };
      },
    });
    await p.check("write_file", { path: "a.ts", content: "x" });
    expect(asks).toBe(1);
    // 第二次应走 always，不再 ask
    await p.check("write_file", { path: "b.ts", content: "y" });
    expect(asks).toBe(1);
    p.clearSessionRules();
    await p.check("write_file", { path: "c.ts", content: "z" });
    expect(asks).toBe(2);
  });


  it("rememberCommand API", async () => {
    const p = new PermissionPolicy({ mode: "default" });
    p.rememberCommand("bun.exe");
    const r = await p.check("run_cmd", { command: "bun", args: "test" });
    expect(r.allowed).toBe(true);
    expect(r.matched).toMatch(/always-cmd/);
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

  it("denied path blocks under auto", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-perm-"));
    fs.writeFileSync(path.join(tmp, "secret.txt"), "s", "utf-8");
    const reg = new ToolRegistry(true);
    const policy = new PermissionPolicy({
      mode: "auto",
      rules: { deniedPaths: ["secret.txt"] },
    });
    const result = await reg.execute(
      { name: "read_file", arguments: { path: "secret.txt" } },
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
  });
});
