/**
 * 条件表达式 + 产物落盘 + 条件跳过 测试
 */
import { describe, expect, it, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { evaluateWhen, evaluateConditions } from "../../src/core/condition";
import { ArtifactStore } from "../../src/core/artifacts";
import { Orchestrator } from "../../src/core/orchestrator";
import { Workflow } from "../../src/core/workflow";
import { MockProvider } from "../../src/testing/MockProvider";

describe("evaluateWhen", () => {
  it("exists / true / false", () => {
    expect(evaluateWhen("true", { value: null, context: {} })).toBe(true);
    expect(evaluateWhen("false", { value: "x", context: {} })).toBe(false);
    expect(evaluateWhen("exists", { value: "x", context: {} })).toBe(true);
    expect(evaluateWhen("exists", { value: "", context: {} })).toBe(false);
  });

  it("status / contains / equals / not", () => {
    expect(
      evaluateWhen("status:success", {
        value: "ok",
        status: "success",
        context: {},
      }),
    ).toBe(true);
    expect(
      evaluateWhen("contains:hello", {
        value: "say hello world",
        context: {},
      }),
    ).toBe(true);
    expect(
      evaluateWhen("equals:exact", { value: "exact", context: {} }),
    ).toBe(true);
    expect(
      evaluateWhen("not:contains:bad", {
        value: "all good",
        context: {},
      }),
    ).toBe(true);
  });

  it("未知表达式 fail-closed", () => {
    expect(evaluateWhen("eval(1)", { value: 1, context: {} })).toBe(false);
  });
});

describe("evaluateConditions", () => {
  it("status 条件", () => {
    const r = evaluateConditions(
      [{ sourceStep: "a", status: "success" }],
      {
        context: { a: "x" },
        stepStatus: { a: "failed" },
      },
    );
    expect(r.ok).toBe(false);
  });

  it("when contains", () => {
    const r = evaluateConditions(
      [{ sourceStep: "a", when: "contains:APPROVE" }],
      {
        context: { a: "LGTM APPROVE" },
        stepStatus: { a: "success" },
      },
    );
    expect(r.ok).toBe(true);
  });
});

describe("ArtifactStore", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("应写入 md / code / manifest", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-art-"));
    dirs.push(root);
    const store = new ArtifactStore({
      outputDir: root,
      workflowName: "demo",
      runId: "run-1",
    });
    store.writeStep({
      step: "code",
      agent: "coder",
      status: "success",
      content: [
        "实现如下：",
        "```ts",
        "// hello.ts",
        "export const x = 1;",
        "```",
      ].join("\n"),
      attempts: 1,
    });
    store.writeContext({ code: "..." });
    const result = store.finalize("completed");

    expect(fs.existsSync(path.join(result.dir, "manifest.json"))).toBe(true);
    expect(fs.existsSync(path.join(result.dir, "code.md"))).toBe(true);
    expect(fs.existsSync(path.join(result.dir, "context.json"))).toBe(true);
    const codeDir = path.join(result.dir, "code");
    const codeFiles = fs.readdirSync(codeDir);
    expect(codeFiles.length).toBeGreaterThan(0);
    expect(codeFiles.some((f) => f.endsWith(".ts"))).toBe(true);
  });
});

describe("条件跳过 + step 重试 + 产物", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  function baseOrch(opts?: ConstructorParameters<typeof Orchestrator>[0]) {
    const orch = new Orchestrator({ maxGlobalRetries: 0, ...opts });
    orch.registerProvider(
      "claude",
      new MockProvider({ name: "c", model: "m" }, { delayMs: 5 }),
    );
    orch.registerProvider(
      "openai",
      new MockProvider({ name: "o", model: "m" }, { delayMs: 5 }),
    );
    orch.registerAgent({
      name: "researcher",
      role: "researcher",
      provider: "claude",
      model: "m",
      systemPrompt: "r",
    });
    orch.registerAgent({
      name: "coder",
      role: "coder",
      provider: "openai",
      model: "m",
      systemPrompt: "c",
    });
    orch.registerAgent({
      name: "reviewer",
      role: "reviewer",
      provider: "claude",
      model: "m",
      systemPrompt: "v",
    });
    return orch;
  }

  it("when 不满足应跳过 step", async () => {
    const orch = baseOrch();
    const wf = new Workflow({
      name: "cond",
      steps: [
        { name: "research", agent: "researcher", prompt: "搜" },
        {
          name: "fix",
          agent: "coder",
          prompt: "修",
          inputs: ["research"],
          conditions: [
            { sourceStep: "research", when: "contains:__NEVER_MATCH__" },
          ],
        },
        {
          name: "done",
          agent: "reviewer",
          prompt: "收尾 {{ research }}",
          inputs: ["research"],
        },
      ],
    });

    const result = await orch.run(wf, { request: "x" });
    expect(result.status).toBe("completed");
    expect(result.stepStates.get("research")?.status).toBe("success");
    expect(result.stepStates.get("fix")?.status).toBe("skipped");
    expect(result.stepStates.get("done")?.status).toBe("success");
  });

  it("step maxRetries 应在 step 内重试", async () => {
    let calls = 0;
    const orch = new Orchestrator({ maxGlobalRetries: 0 });
    orch.registerProvider(
      "claude",
      new MockProvider(
        { name: "c", model: "m" },
        {
          delayMs: 5,
          failOn: () => {
            calls++;
            return calls < 3; // 前两次失败，第三次成功
          },
        },
      ),
    );
    orch.registerAgent({
      name: "researcher",
      role: "researcher",
      provider: "claude",
      model: "m",
      systemPrompt: "r",
    });

    const wf = new Workflow({
      name: "retry-step",
      steps: [
        {
          name: "research",
          agent: "researcher",
          prompt: "搜",
          maxRetries: 3,
        },
      ],
    });

    const result = await orch.run(wf);
    expect(result.status).toBe("completed");
    expect(result.stepStates.get("research")?.status).toBe("success");
    expect(result.stepStates.get("research")?.attempts).toBe(3);
    expect(calls).toBe(3);
  });

  it("outputDir 应落盘产物", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-run-"));
    dirs.push(root);
    const orch = baseOrch({ outputDir: root });
    const wf = new Workflow({
      name: "artifacts-demo",
      outputDir: root,
      steps: [
        {
          name: "code",
          agent: "coder",
          prompt: "写代码",
        },
      ],
    });

    // 用自定义 mock 返回带 fence 的内容
    orch.registerProvider(
      "openai",
      new MockProvider({ name: "o", model: "m" }, { delayMs: 5 }),
    );

    const result = await orch.run(wf);
    expect(result.status).toBe("completed");
    expect(orch.artifactDir).toBeTruthy();
    const dir = orch.artifactDir!;
    expect(fs.existsSync(path.join(dir, "manifest.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "code.md"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "context.json"))).toBe(true);
  });
});
