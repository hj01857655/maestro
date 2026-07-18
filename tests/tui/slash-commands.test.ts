/**
 * Slash / reducer 纯单元测试（不启动 Ink，避免 Windows 上 Bun+ink 崩溃）
 */

import { describe, expect, it } from "bun:test";
import { reduce, resetLogSeq } from "../../src/tui/reducer";
import { createInitialState } from "../../src/tui/state";
import {
  CommandRegistry,
  parseSlashLine,
  builtinCommands,
} from "../../src/tui/slash";

describe("Slash CommandRegistry", () => {
  it("应该解析 slash 行", () => {
    expect(parseSlashLine("/run demo.yaml --mock")).toEqual({
      name: "run",
      args: ["demo.yaml", "--mock"],
    });
    expect(parseSlashLine("hello")).toBeNull();
  });

  it("应该注册并匹配命令", () => {
    const reg = new CommandRegistry();
    reg.registerAll(builtinCommands);
    expect(reg.get("help")?.name).toBe("help");
    expect(reg.get("?")?.name).toBe("help");
    expect(reg.get("stop")?.name).toBe("stop");
    expect(reg.match("ro").map((c) => c.name)).toContain("roles");
    expect(reg.helpText().some((l) => l.includes("/stop"))).toBe(true);
  });

  it("/run 应产出 effect", () => {
    const reg = new CommandRegistry();
    reg.registerAll(builtinCommands);
    const cmd = reg.get("run")!;
    const result = cmd.run({
      state: createInitialState(),
      args: ["demo.yaml", "--mock"],
      raw: "/run demo.yaml --mock",
    });
    expect(result.kind).toBe("effect");
    if (result.kind === "effect") {
      expect(result.effect).toEqual({
        type: "run-workflow",
        path: "demo.yaml",
        mock: true,
      });
    }
  });

  it("/rerun 应产出 rerun-last effect", () => {
    const reg = new CommandRegistry();
    reg.registerAll(builtinCommands);
    const cmd = reg.get("rerun")!;
    const result = cmd.run({
      state: createInitialState(),
      args: [],
      raw: "/rerun",
    });
    expect(result.kind).toBe("effect");
    if (result.kind === "effect") {
      expect(result.effect).toEqual({ type: "rerun-last" });
    }
  });

  it("应注册 Claude 对齐 slash 命令", () => {
    const reg = new CommandRegistry();
    reg.registerAll(builtinCommands);
    for (const name of [
      "model",
      "version",
      "doctor",
      "cost",
      "sessions",
      "resume",
      "export",
      "rerun",
      "permissions",
      "always",
      "allow",
      "deny",
    ]) {
      expect(reg.get(name)?.name).toBe(name);
    }
    expect(reg.get("retry")?.name).toBe("rerun");
    expect(reg.get("load")?.name).toBe("resume");
    expect(reg.get("perm")?.name).toBe("permissions");
  });

  it("/permissions plan 应 set-mode", () => {
    const reg = new CommandRegistry();
    reg.registerAll(builtinCommands);
    const result = reg.get("permissions")!.run({
      state: createInitialState(),
      args: ["plan"],
      raw: "/permissions plan",
    });
    expect(result.kind).toBe("actions");
    if (result.kind === "actions") {
      expect(
        result.actions.some(
          (a) => a.type === "permission/set-mode" && a.mode === "plan",
        ),
      ).toBe(true);
    }
  });

  it("/allow 在无 pending 时警告", () => {
    const reg = new CommandRegistry();
    reg.registerAll(builtinCommands);
    const result = reg.get("allow")!.run({
      state: createInitialState(),
      args: [],
      raw: "/allow",
    });
    expect(result.kind).toBe("message");
  });

  it("/allow always 在有 pending 时带 remember", () => {
    const reg = new CommandRegistry();
    reg.registerAll(builtinCommands);
    const state = createInitialState();
    state.pendingPermission = {
      id: 1,
      tool: "write_file",
      risk: "write",
      summary: "a.ts",
    };
    const result = reg.get("allow")!.run({
      state,
      args: ["always"],
      raw: "/allow always",
    });
    expect(result.kind).toBe("effect");
    if (result.kind === "effect") {
      expect(result.effect).toEqual({
        type: "permission-answer",
        allow: true,
        remember: "tool",
      });
    }
  });

  it("/always tool 产出 permission-always effect", () => {
    const reg = new CommandRegistry();
    reg.registerAll(builtinCommands);
    const result = reg.get("always")!.run({
      state: createInitialState(),
      args: ["tool", "write_file", "--save"],
      raw: "/always tool write_file --save",
    });
    expect(result.kind).toBe("effect");
    if (result.kind === "effect") {
      expect(result.effect).toEqual({
        type: "permission-always",
        op: "tool",
        values: ["write_file"],
        save: true,
      });
    }
  });

  it("/always list 默认 op=list", () => {
    const reg = new CommandRegistry();
    reg.registerAll(builtinCommands);
    const result = reg.get("always")!.run({
      state: createInitialState(),
      args: [],
      raw: "/always",
    });
    expect(result.kind).toBe("effect");
    if (result.kind === "effect") {
      expect(result.effect).toEqual({
        type: "permission-always",
        op: "list",
        values: [],
        save: false,
      });
    }
  });


  it("/version 应输出版本信息", () => {
    const reg = new CommandRegistry();
    reg.registerAll(builtinCommands);
    const result = reg.get("version")!.run({
      state: createInitialState(),
      args: [],
      raw: "/version",
    });
    expect(result.kind).toBe("actions");
    if (result.kind === "actions") {
      const msgs = result.actions
        .filter((a) => a.type === "logs/push")
        .map((a) => (a.type === "logs/push" ? a.message : ""));
      expect(msgs.some((m) => m.includes("maestro v"))).toBe(true);
    }
  });
});

describe("TUI reducer", () => {
  it("应该处理 step 事件更新状态", () => {
    resetLogSeq();
    let state = createInitialState();
    state = reduce(state, {
      type: "workflow/prepare",
      workflowName: "demo",
      steps: [
        { name: "research", agent: "researcher", status: "pending", attempts: 0 },
      ],
      mock: true,
    });
    state = reduce(state, {
      type: "orchestrator/event",
      event: {
        type: "step:start",
        step: "research",
        agent: "researcher",
        attempt: 1,
      },
    });
    expect(state.steps[0]!.status).toBe("running");
    expect(state.steps[0]!.attempts).toBe(1);

    state = reduce(state, {
      type: "orchestrator/event",
      event: {
        type: "step:complete",
        step: "research",
        status: "success",
        summary: "ok",
        attempt: 1,
      },
    });
    expect(state.steps[0]!.status).toBe("success");
    expect(state.steps[0]!.summary).toBe("ok");
  });

  it("应该维护命令历史", () => {
    resetLogSeq();
    let state = createInitialState();
    state = reduce(state, { type: "history/push", command: "/help" });
    state = reduce(state, { type: "history/push", command: "/roles" });
    state = reduce(state, { type: "history/prev" });
    expect(state.input).toBe("/roles");
    state = reduce(state, { type: "history/prev" });
    expect(state.input).toBe("/help");
  });

  it("session/hydrate 应切换会话元数据", () => {
    resetLogSeq();
    let state = createInitialState();
    state = reduce(state, {
      type: "workflow/prepare",
      workflowName: "old",
      steps: [{ name: "a", agent: "coder", status: "success", attempts: 1 }],
      mock: false,
    });
    state = reduce(state, {
      type: "session/hydrate",
      sessionId: "abc123",
      sessionName: "demo",
      workflowName: "restored",
      mock: true,
      steps: [{ name: "b", agent: "reviewer", status: "pending", attempts: 0 }],
      logs: [{ level: "info", message: "from disk", time: "12:00:00" }],
      commandHistory: ["/plan x"],
    });
    expect(state.sessionId).toBe("abc123");
    expect(state.sessionName).toBe("demo");
    expect(state.workflowName).toBe("restored");
    expect(state.mock).toBe(true);
    expect(state.mode).toBe("idle");
    expect(state.steps[0]?.name).toBe("b");
    expect(state.logs.some((l) => l.message === "from disk")).toBe(true);
    expect(state.commandHistory).toContain("/plan x");
  });

  it("workflow/reset 应清空步骤保留会话", () => {
    resetLogSeq();
    let state = createInitialState({ sessionId: "s1", sessionName: "n" });
    state = reduce(state, {
      type: "workflow/prepare",
      workflowName: "wf",
      steps: [{ name: "a", agent: "coder", status: "pending", attempts: 0 }],
      mock: true,
    });
    state = reduce(state, { type: "workflow/reset" });
    expect(state.mode).toBe("idle");
    expect(state.workflowName).toBe("");
    expect(state.steps).toEqual([]);
    expect(state.sessionId).toBe("s1");
  });

  it("输入 / 应打开下拉", () => {
    let state = createInitialState();
    state = reduce(state, { type: "input/set", value: "/" });
    expect(state.slashOpen).toBe(true);
    expect(state.slashQuery).toBe("");
  });

  it("输入 /he 应设置 query", () => {
    let state = createInitialState();
    state = reduce(state, { type: "input/set", value: "/he" });
    expect(state.slashOpen).toBe(true);
    expect(state.slashQuery).toBe("he");
  });

  it("输入带空格后应关闭下拉", () => {
    let state = createInitialState();
    state = reduce(state, { type: "input/set", value: "/run " });
    expect(state.slashOpen).toBe(false);
  });
});
