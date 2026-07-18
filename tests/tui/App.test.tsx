/**
 * Maestro TUI 交互测试（Ink）
 *
 * 注：Windows 上 Bun + ink-testing-library 可能 panic；
 * 纯逻辑见 slash-commands.test.ts。
 */

import React from "react";
import { afterEach, describe, expect, it } from "bun:test";
import { render } from "ink-testing-library";
import { App } from "../../src/tui/App";
import { reduce, resetLogSeq } from "../../src/tui/reducer";
import { createInitialState } from "../../src/tui/state";
import { CommandRegistry, parseSlashLine, builtinCommands } from "../../src/tui/slash";

const instances: Array<ReturnType<typeof render>> = [];

function renderApp() {
  const instance = render(<App />);
  instances.push(instance);
  return instance;
}

async function waitForFrame(
  instance: ReturnType<typeof render>,
  predicate: (frame: string) => boolean,
  timeoutMs = 2_000,
): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const frame = instance.lastFrame() ?? "";
    if (predicate(frame)) return frame;
    await Bun.sleep(20);
  }
  throw new Error(`等待 TUI 更新超时。最后一帧：\n${instance.lastFrame() ?? ""}`);
}

afterEach(() => {
  for (const instance of instances.splice(0)) {
    instance.unmount();
  }
  resetLogSeq();
});

describe("Maestro TUI", () => {
  it("应该渲染指挥台首屏", () => {
    const instance = renderApp();
    const frame = instance.lastFrame() ?? "";

    expect(frame).toContain("Maestro");
    expect(frame).toContain("Workflow");
    expect(frame).toContain("Roles");
    expect(frame).toContain("Logs");
    expect(frame).toContain("IDLE");
    expect(frame).toContain("researcher");
    expect(frame).toContain("designer");
  });

  it("应该响应 /help 命令", async () => {
    const instance = renderApp();

    instance.stdin.write("/help");
    await waitForFrame(instance, (output) => output.includes("> /help"));
    instance.stdin.write("\r");

    // 帮助面板含 usage 行；下拉只有 description，不含完整 usage
    const frame = await waitForFrame(
      instance,
      (output) => output.includes("/run <workflow.yaml> [--mock]"),
    );
    expect(frame).toContain("/roles");
    expect(frame).toContain("/stop");
    expect(frame).toContain("/quit");
  });

  it("应该通过 Mock 模式跑完整工作流", async () => {
    const instance = renderApp();

    instance.stdin.write("/run src/examples/demo-mock.yaml --mock");
    await waitForFrame(
      instance,
      (output) => output.includes("> /run src/examples/demo-mock.yaml --mock"),
    );
    instance.stdin.write("\r");

    const frame = await waitForFrame(
      instance,
      (output) => output.includes("DONE") && output.includes("review"),
      5_000,
    );

    expect(frame).toContain("演示工作流（Mock 模式）");
    expect(frame).toContain("research");
    expect(frame).toContain("design");
    expect(frame).toContain("code");
    expect(frame).toContain("review");
    expect(frame).toContain("completed");
  });
});

describe("TUI reducer", () => {
  it("应该处理 step 事件更新状态", () => {
    let state = createInitialState();
    state = reduce(state, {
      type: "workflow/prepare",
      workflowName: "demo",
      steps: [{ name: "research", agent: "researcher", status: "pending", attempts: 0 }],
      mock: true,
    });
    state = reduce(state, {
      type: "orchestrator/event",
      event: { type: "step:start", step: "research", agent: "researcher", attempt: 1 },
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
    let state = createInitialState();
    state = reduce(state, { type: "history/push", command: "/help" });
    state = reduce(state, { type: "history/push", command: "/roles" });
    state = reduce(state, { type: "history/prev" });
    expect(state.input).toBe("/roles");
    state = reduce(state, { type: "history/prev" });
    expect(state.input).toBe("/help");
  });
});

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
});

describe("Slash 下拉状态", () => {
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

  it("TUI 输入 / 应渲染 Slash 下拉", async () => {
    const instance = renderApp();
    instance.stdin.write("/");
    // 等输入框真正显示 "/"，且下拉出现（含 description，不匹配 placeholder）
    const frame = await waitForFrame(
      instance,
      (output) => output.includes("> /") && output.includes("显示帮助"),
    );
    expect(frame).toContain("/help");
    expect(frame).toContain("/run");
    expect(frame).toContain("Esc 关闭");
  });
});
