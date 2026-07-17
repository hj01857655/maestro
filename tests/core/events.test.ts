/**
 * Orchestrator 结构化事件测试
 */
import { describe, it, expect } from "bun:test";
import { Orchestrator } from "../../src/core/orchestrator";
import { Workflow } from "../../src/core/workflow";
import { MockProvider } from "../../src/testing/MockProvider";
import type { OrchestratorEvent } from "../../src/core/events";

function createOrch() {
  const orch = new Orchestrator({ maxGlobalRetries: 0 });
  orch.registerProvider("claude", new MockProvider({ name: "mock-claude", model: "mock" }, { delayMs: 30 }));
  orch.registerProvider("openai", new MockProvider({ name: "mock-openai", model: "mock" }, { delayMs: 30 }));
  orch.registerAgent({
    name: "researcher",
    role: "researcher",
    provider: "claude",
    model: "mock",
    systemPrompt: "r",
  });
  orch.registerAgent({
    name: "coder",
    role: "coder",
    provider: "openai",
    model: "mock",
    systemPrompt: "c",
  });
  return orch;
}

describe("Orchestrator 结构化事件", () => {
  it("应该按顺序发出 step/workflow 事件", async () => {
    const orch = createOrch();
    const events: OrchestratorEvent[] = [];
    orch.on((e) => events.push(e));

    const wf = new Workflow({
      name: "event-demo",
      steps: [
        { name: "research", agent: "researcher", prompt: "搜" },
        { name: "code", agent: "coder", prompt: "写", inputs: ["research"] },
      ],
    });

    const result = await orch.run(wf, { request: "x" }, { mock: true });
    expect(result.status).toBe("completed");

    const types = events.map((e) => e.type);
    expect(types).toContain("workflow:start");
    expect(types).toContain("step:start");
    expect(types).toContain("step:complete");
    expect(types).toContain("workflow:complete");

    const starts = events.filter((e) => e.type === "step:start") as Array<
      Extract<OrchestratorEvent, { type: "step:start" }>
    >;
    expect(starts.map((s) => s.step)).toEqual(["research", "code"]);
  });

  it("cancel 应发出 workflow:cancelled", async () => {
    const orch = createOrch();
    const events: OrchestratorEvent[] = [];
    orch.on((e) => events.push(e));

    const wf = new Workflow({
      name: "cancel-demo",
      steps: [
        { name: "research", agent: "researcher", prompt: "搜" },
        { name: "code", agent: "coder", prompt: "写", inputs: ["research"] },
      ],
    });

    const runPromise = orch.run(wf);
    // 立刻取消
    orch.cancel();
    const result = await runPromise;

    expect(result.error).toBe("cancelled");
    expect(events.some((e) => e.type === "workflow:cancelled")).toBe(true);
  });
});
