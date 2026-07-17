/**
 * 配置 / 校验 / Tools / Planner 单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  validateWorkflowConfig,
  detectCycle,
} from "../../src/core/validate";
import { planFromTemplate, parseWorkflowFromModel } from "../../src/core/planner";
import {
  ToolRegistry,
  parseToolCalls,
  toolsPromptSection,
} from "../../src/tools";
import {
  defaultConfig,
  maskKey,
  configPath,
} from "../../src/config/store";

describe("validateWorkflowConfig", () => {
  it("接受合法工作流", () => {
    const r = validateWorkflowConfig({
      name: "ok",
      steps: [
        { name: "a", agent: "researcher", prompt: "x" },
        { name: "b", agent: "designer", prompt: "y", inputs: ["a"] },
      ],
    });
    expect(r.ok).toBe(true);
    expect(r.config?.steps.length).toBe(2);
  });

  it("拒绝重复 step 名", () => {
    const r = validateWorkflowConfig({
      name: "dup",
      steps: [
        { name: "a", agent: "researcher", prompt: "x" },
        { name: "a", agent: "designer", prompt: "y" },
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.message.includes("重复"))).toBe(true);
  });

  it("拒绝悬空 inputs", () => {
    const r = validateWorkflowConfig({
      name: "miss",
      steps: [
        { name: "a", agent: "researcher", prompt: "x", inputs: ["nope"] },
      ],
    });
    expect(r.ok).toBe(false);
  });

  it("检测循环依赖", () => {
    const r = validateWorkflowConfig({
      name: "cycle",
      steps: [
        { name: "a", agent: "researcher", prompt: "x", inputs: ["b"] },
        { name: "b", agent: "designer", prompt: "y", inputs: ["a"] },
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.message.includes("循环"))).toBe(true);
  });

  it("detectCycle 无环返回 null", () => {
    expect(
      detectCycle({
        name: "lin",
        steps: [
          { name: "a", agent: "researcher", prompt: "x" },
          { name: "b", agent: "designer", prompt: "y", inputs: ["a"] },
        ],
      }),
    ).toBeNull();
  });
});

describe("planFromTemplate", () => {
  it("生成标准流水线", () => {
    const cfg = planFromTemplate({ request: "做登录", test: true });
    expect(cfg.steps.map((s) => s.name)).toEqual([
      "research",
      "design",
      "code",
      "test",
      "review",
    ]);
    expect(cfg.steps.find((s) => s.name === "code")?.inputs).toContain("design");
  });

  it("可跳过 research", () => {
    const cfg = planFromTemplate({ request: "x", research: false });
    expect(cfg.steps[0].name).toBe("design");
  });

  it("parseWorkflowFromModel 解析 JSON", () => {
    const text = `这是计划：
\`\`\`json
{"name":"n","steps":[{"name":"a","agent":"coder","prompt":"p"}]}
\`\`\``;
    const cfg = parseWorkflowFromModel(text);
    expect(cfg?.name).toBe("n");
    expect(cfg?.steps[0].agent).toBe("coder");
  });
});

describe("tools", () => {
  const tmp = path.join(os.tmpdir(), `maestro-tools-${Date.now()}`);

  beforeEach(() => {
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(path.join(tmp, "hello.txt"), "hello world", "utf-8");
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("parseToolCalls 解析 tool 块", () => {
    const text = `先读文件
\`\`\`tool
{"name":"read_file","arguments":{"path":"hello.txt"}}
\`\`\`
`;
    const calls = parseToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("read_file");
    expect(calls[0].arguments.path).toBe("hello.txt");
  });

  it("read_file / write_file / list_dir", async () => {
    const reg = new ToolRegistry();
    const ctx = { cwd: tmp, workspaceRoot: tmp };

    const read = await reg.execute(
      { name: "read_file", arguments: { path: "hello.txt" } },
      ctx,
    );
    expect(read.ok).toBe(true);
    expect(read.content).toContain("hello");

    const write = await reg.execute(
      {
        name: "write_file",
        arguments: { path: "out.txt", content: "ok" },
      },
      ctx,
    );
    expect(write.ok).toBe(true);
    expect(fs.readFileSync(path.join(tmp, "out.txt"), "utf-8")).toBe("ok");

    const list = await reg.execute(
      { name: "list_dir", arguments: { path: "." } },
      ctx,
    );
    expect(list.ok).toBe(true);
    expect(list.content).toContain("hello.txt");
  });

  it("拒绝 workspace 外路径", async () => {
    const reg = new ToolRegistry();
    const r = await reg.execute(
      { name: "read_file", arguments: { path: "../outside" } },
      { cwd: tmp, workspaceRoot: tmp },
    );
    expect(r.ok).toBe(false);
  });

  it("toolsPromptSection 非空", () => {
    const reg = new ToolRegistry();
    const s = toolsPromptSection(reg.list());
    expect(s).toContain("read_file");
    expect(s).toContain("```tool");
  });
});

describe("config store", () => {
  it("maskKey 隐藏密钥", () => {
    expect(maskKey("sk-abcdefghij")).toContain("…");
    expect(maskKey(undefined)).toBe("(未设置)");
  });

  it("defaultConfig 结构正确", () => {
    const c = defaultConfig();
    expect(c.version).toBe(1);
    expect(c.providers).toEqual({});
  });

  it("configPath 指向 ~/.maestro", () => {
    expect(configPath()).toContain(".maestro");
    expect(configPath()).toContain("config.json");
  });
});

describe("stream providers", () => {
  it("MockProvider invokeStream 产出文本", async () => {
    const { MockProvider } = await import("../../src/testing/MockProvider");
    const p = new MockProvider({ model: "m" }, { delayMs: 0 });
    const stream = await p.invokeStream([
      { role: "user", content: "hi" },
    ]);
    let acc = "";
    for await (const chunk of stream) acc += chunk;
    expect(acc).toContain("Mock");
  });
});

describe("TUI inspect reducer", () => {
  it("inspect/open 与 close", async () => {
    const { reduce } = await import("../../src/tui/reducer");
    const { createInitialState } = await import("../../src/tui/state");
    let s = createInitialState();
    s = {
      ...s,
      steps: [
        {
          name: "code",
          agent: "coder",
          status: "success",
          attempts: 1,
          content: "full output here",
        },
      ],
    };
    s = reduce(s, { type: "inspect/open", step: "code" });
    expect(s.inspectStep).toBe("code");
    s = reduce(s, { type: "inspect/close" });
    expect(s.inspectStep).toBeNull();
  });

  it("step:complete 写入 content", async () => {
    const { reduce } = await import("../../src/tui/reducer");
    const { createInitialState } = await import("../../src/tui/state");
    let s = createInitialState();
    s = {
      ...s,
      steps: [
        { name: "a", agent: "coder", status: "running", attempts: 1 },
      ],
    };
    s = reduce(s, {
      type: "orchestrator/event",
      event: {
        type: "step:complete",
        step: "a",
        status: "success",
        summary: "sum",
        content: "BODY",
        attempt: 1,
      },
    });
    expect(s.steps[0].content).toBe("BODY");
  });
});
